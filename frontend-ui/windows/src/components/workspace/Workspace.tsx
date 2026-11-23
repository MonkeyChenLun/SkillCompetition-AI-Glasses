import { memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { LayoutGrid, ShieldAlert, X } from 'lucide-react'
import { useAuth } from '../../services/auth'
import Shell from '../layout/Shell'
import { WorkspaceDock, WorkspaceFrame } from './WorkspaceFrame'
import { computeWindowCompositor } from './compositor'
import type { GlassTier } from './compositor'
import { canSnapToQuadrant, canSplitWorkspace, clampWindowRect, getQuadrantRect, getWindowRect, initialWindowRect } from './geometry'
import type { SnapQuadrant, WindowMode, WindowRect, WorkBounds } from './geometry'
import { playDockGenie } from './dockGenie'
import { WindowContext, WorkspaceContext, WorkspaceLink } from './workspaceContext'
import { EMPTY_WORKSPACE, hrefForWindow, parseWindowRoute, WindowPageContent } from './workspaceRoutes'
import type { WindowRoute } from './workspaceRoutes'
import './workspace.css'
import './workspace-glass.css'

type Flight = 'in' | 'out'
type UnmaximizedMode = Exclude<WindowMode, 'maximized'>

interface OpenWindow {
  route: WindowRoute
  mode: WindowMode
  restoreMode: UnmaximizedMode
  floating: WindowRect
  order: number
  minimized: boolean
  flight: Flight | null
}

interface WorkspaceState {
  windows: OpenWindow[]
  activeId: string | null
}

function foremost(windows: OpenWindow[]) {
  return windows.reduce<OpenWindow | undefined>((top, item) =>
    !item.minimized && (!top || item.order > top.order) ? item : top, undefined)
}

function amend(state: WorkspaceState, id: string, update: (item: OpenWindow) => OpenWindow) {
  return { ...state, windows: state.windows.map(item => item.route.id === id ? update(item) : item) }
}

const WindowView = memo(function WindowView({
  item, active, visible, occluded, glassTier, compact, canSnap, bounds,
  onFocus, onGestureChange, onSearch, onGeometry, onSnap, onPreview, onMaximize, onMinimize, onClose,
}: {
  item: OpenWindow
  active: boolean
  visible: boolean
  occluded: boolean
  glassTier: GlassTier
  compact: boolean
  canSnap: boolean
  bounds: WorkBounds
  onFocus: (id: string) => void
  onGestureChange: (id: string, gesturing: boolean) => void
  onSearch: (id: string, params: URLSearchParams) => void
  onGeometry: (id: string, rect: WindowRect) => void
  onSnap: (id: string, quadrant: SnapQuadrant) => void
  onPreview: (quadrant: SnapQuadrant | null) => void
  onMaximize: (id: string) => void
  onMinimize: (id: string) => void
  onClose: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const id = item.route.id
  const mode = compact ? 'maximized' : !canSnap && item.mode !== 'maximized' ? 'floating' : item.mode
  const rect = getWindowRect(mode, item.floating, bounds)

  const handleFocus = useCallback(() => onFocus(id), [onFocus, id])
  const handleGestureChange = useCallback((gesturing: boolean) => onGestureChange(id, gesturing), [onGestureChange, id])
  const handleSearch = useCallback((params: URLSearchParams) => onSearch(id, params), [onSearch, id])
  const handleGeometry = useCallback((next: WindowRect) => onGeometry(id, next), [onGeometry, id])
  const handleSnap = useCallback((quadrant: SnapQuadrant) => onSnap(id, quadrant), [onSnap, id])
  const handleMaximize = useCallback(() => onMaximize(id), [onMaximize, id])
  const handleMinimize = useCallback(() => onMinimize(id), [onMinimize, id])
  const handleClose = useCallback(() => onClose(id), [onClose, id])

  const contextValue = useMemo(
    () => ({ search: item.route.search, setSearch: handleSearch, scrollRef, visible: visible && !occluded && !item.flight }),
    [item.route.search, handleSearch, visible, occluded, item.flight],
  )

  return <WorkspaceFrame id={id} title={item.route.title} active={active} visible={visible}
    occluded={occluded} glassTier={glassTier}
    flight={item.flight} mode={mode} stackOrder={item.order} rect={rect}
    floatingRect={item.floating} bounds={bounds} canFloat={!compact} canSnap={canSnap} scrollRef={scrollRef}
    onFocus={handleFocus} onGestureChange={handleGestureChange} onGeometry={handleGeometry} onSnap={handleSnap} onPreview={onPreview}
    onMaximize={handleMaximize} onMinimize={handleMinimize} onClose={handleClose}>
    <WindowContext.Provider value={contextValue}>
      <Suspense fallback={<p role="status" className="workspace-loading muted">正在加载窗口…</p>}>
        <WindowPageContent route={item.route} />
      </Suspense>
    </WindowContext.Provider>
  </WorkspaceFrame>
})

const permissionMessage = '当前账号没有访问该页面的权限。'

export default function Workspace() {
  const { can } = useAuth()
  const location = useLocation()
  const movement = useNavigationType()
  const navigate = useNavigate()
  const currentHref = location.pathname + location.search + location.hash
  const stage = useRef<HTMLElement>(null)
  const [bounds, setBounds] = useState<WorkBounds>({ width: 0, height: 0 })
  const [state, setState] = useState<WorkspaceState>({ windows: [], activeId: null })
  const latest = useRef(state)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds
  const nextOrder = useRef(0)
  const [preview, setPreview] = useState<SnapQuadrant | null>(null)
  const [gesturingId, setGesturingId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const running = useRef(new Map<string, { flight: Flight; cancel: () => void }>())
  const lastFlightAt = useRef(0)
  const pendingHref = useRef<string | null>(null)
  const lastLocation = useRef<string | null>(null)
  const pendingFocus = useRef<string | null>(null)
  const compact = !canSplitWorkspace(bounds)
  const canSnap = canSnapToQuadrant(bounds)
  const compactRef = useRef(compact)
  compactRef.current = compact
  const canSnapRef = useRef(canSnap)
  canSnapRef.current = canSnap
  const [dockCollapsed, setDockCollapsed] = useState(false)
  const scrollMemory = useRef(new WeakMap<EventTarget, number>())

  /** iOS-style tab bar: the dock sinks while reading down a window and comes back on scroll up. */
  function trackScroll(event: UIEvent<HTMLElement>) {
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains('workspace-pane')) return
    const top = target.scrollTop
    const before = scrollMemory.current.get(target) ?? top
    scrollMemory.current.set(target, top)
    const delta = top - before
    if (top < 24 || delta < -6) setDockCollapsed(false)
    else if (delta > 6) setDockCollapsed(true)
  }

  const allowed = useCallback((route: WindowRoute) => !route.permission || can(route.permission), [can])
  const windows = useMemo(() => state.windows.filter(item => allowed(item.route)), [state.windows, allowed])
  const active = windows.find(item => item.route.id === state.activeId && !item.minimized)
  const compactVisibleId = active?.route.id ?? foremost(windows)?.route.id
  const anyVisible = windows.some(item => !item.minimized && (!compact || compactVisibleId === item.route.id))
  const compositor = useMemo(() => computeWindowCompositor(
    windows.map((item) => {
      const mode = compact ? 'maximized' : !canSnap && item.mode !== 'maximized' ? 'floating' : item.mode
      return {
        id: item.route.id,
        order: item.order,
        mode,
        rect: getWindowRect(mode, item.floating, bounds),
        minimized: item.minimized || (compact && compactVisibleId !== item.route.id),
        flying: item.flight !== null,
      }
    }),
    gesturingId,
  ), [windows, bounds, compact, canSnap, compactVisibleId, gesturingId])

  // Switching windows always brings the dock back.
  useEffect(() => setDockCollapsed(false), [active?.route.id])

  const commit = useCallback((next: WorkspaceState) => {
    latest.current = next
    setState(next)
  }, [])

  const writeAddress = useCallback((href: string, replace: boolean) => {
    if (pendingHref.current === href || (!pendingHref.current && href === currentHref)) return
    pendingHref.current = href
    void navigate(href, { replace, preventScrollReset: true })
  }, [currentHref, navigate])

  function frameElement(id: string) {
    return stage.current?.querySelector<HTMLElement>(`[data-workspace-window="${CSS.escape(id)}"]`)
  }

  function dockElement(id: string) {
    return document.querySelector<HTMLElement>(`[data-workspace-dock-item="${CSS.escape(id)}"]`)
  }

  function focusFrame(id: string) {
    pendingFocus.current = id
    requestAnimationFrame(restoreFrameFocus)
  }

  function restoreFrameFocus() {
    const id = pendingFocus.current
    if (!id) return
    if (latest.current.activeId !== id) {
      pendingFocus.current = null
      return
    }
    const node = frameElement(id)
    if (!node || node.inert) return
    pendingFocus.current = null
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true })
  }

  // A motion can finish before React has committed removal of `inert`.
  useLayoutEffect(restoreFrameFocus)

  function promote(base: WorkspaceState, route: WindowRoute): WorkspaceState {
    const existing = base.windows.find(item => item.route.id === route.id)
    if (existing && !existing.minimized && base.activeId === route.id && hrefForWindow(existing.route) === hrefForWindow(route)) return base
    const raised = ++nextOrder.current
    if (existing) {
      return { ...amend(base, route.id, item => ({
        ...item, route, order: raised, minimized: false, flight: item.minimized ? 'out' : item.flight,
      })), activeId: route.id }
    }
    const measured = { width: stage.current?.clientWidth || boundsRef.current.width, height: stage.current?.clientHeight || boundsRef.current.height }
    return { windows: [...base.windows, {
      // Open every module full-size, like a page; floating and split views stay one click away.
      route, mode: 'maximized', restoreMode: 'floating',
      floating: initialWindowRect(measured, base.windows.length), order: raised, minimized: false, flight: 'out',
    }], activeId: route.id }
  }

  useLayoutEffect(() => {
    const canvas = stage.current
    if (!canvas) return
    function measure() {
      if (!canvas) return
      const next = { width: canvas.clientWidth, height: canvas.clientHeight }
      setBounds(previous => previous.width === next.width && previous.height === next.height ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const before = latest.current
    const permitted = before.windows.filter(item => allowed(item.route))
    const pruned = permitted.length < before.windows.length
    const base = pruned ? { windows: permitted, activeId: permitted.some(item => item.route.id === before.activeId) ? before.activeId : null } : before
    if (pruned) {
      commit(base)
      setNotice('权限已更新，已关闭无法继续访问的窗口。')
    }
    if (pendingHref.current && currentHref !== pendingHref.current && lastLocation.current === location.key && movement !== 'POP') return
    pendingHref.current = null
    lastLocation.current = location.key

    const route = parseWindowRoute(currentHref)
    if (!route) {
      // Browser Back may revisit a desktop URL after other windows have opened.
      if (base.activeId !== null) commit({ ...base, activeId: null })
      return
    }
    if (!allowed(route)) {
      const fallback = foremost(base.windows)?.route ?? parseWindowRoute('/')!
      commit(promote(base, fallback))
      setNotice(pruned ? '权限已更新，已关闭无法继续访问的窗口。' : permissionMessage)
      writeAddress(hrefForWindow(fallback), true)
      return
    }
    const next = promote(base, route)
    if (next !== base) {
      commit(next)
      if (movement === 'POP' && !next.windows.find(item => item.route.id === route.id)?.flight) focusFrame(route.id)
    }
  }, [currentHref, location.key, movement, can])

  const finishFlight = useCallback((id: string, flight: Flight) => {
    if (running.current.get(id)?.flight === flight) running.current.delete(id)
    if (!latest.current.windows.some(item => item.route.id === id && item.flight === flight)) return
    commit(amend(latest.current, id, item => ({ ...item, flight: null })))
    if (flight === 'out') focusFrame(id)
  }, [commit])

  useLayoutEffect(() => {
    const flights = running.current
    for (const [id, travel] of flights) {
      if (!windows.some(item => item.route.id === id && item.flight === travel.flight)) {
        travel.cancel()
        flights.delete(id)
      }
    }
    if (!bounds.width || !bounds.height) return

    const pendingOuts = windows.filter((item) => item.flight === 'out' && !flights.has(item.route.id))
    let hadActiveOut = false
    // Under rapid-fire clicking / stress tests, cancel older overlapping 'out' genie ghosts so at most 1 runs.
    if (pendingOuts.length > 0) {
      for (const [id, travel] of Array.from(flights)) {
        if (travel.flight === 'out') {
          hadActiveOut = true
          travel.cancel()
          finishFlight(id, 'out')
        }
      }
    }

    const now = performance.now()
    const rapidBurst = hadActiveOut || (pendingOuts.length > 0 && now - lastFlightAt.current < 320)

    for (const item of windows) {
      const id = item.route.id
      const flight = item.flight
      if (!flight || flights.has(id)) continue
      const frame = frameElement(id)
      const dock = dockElement(id)
      // Skip heavy 16-slice genie ghosts under rapid-fire clicks or multi-window stress (prevents strobe flicker).
      const skipHeavyGenie =
        compositor.visibleCount >= 4 ||
        (flight === 'out' && (rapidBurst || id !== state.activeId))
      if (!frame || !dock || skipHeavyGenie || (flight === 'out' && compact && state.activeId !== id)) {
        finishFlight(id, flight)
        continue
      }
      dock.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const from = frame.getBoundingClientRect()
      const to = dock.getBoundingClientRect()
      let finished = false
      const cancel = playDockGenie({
        source: flight === 'in' ? from : to,
        target: flight === 'in' ? to : from,
        direction: flight,
        frame,
        onFinish: () => { finished = true; finishFlight(id, flight) },
      })
      if (!finished) {
        flights.set(id, { flight, cancel })
        if (flight === 'out') lastFlightAt.current = now
      }
    }
  }, [windows, bounds.width, bounds.height, compact, state.activeId, compositor.visibleCount, finishFlight])

  useLayoutEffect(() => {
    function settle() {
      for (const [id, motion] of Array.from(running.current)) {
        motion.cancel()
        finishFlight(id, motion.flight)
      }
      setPreview(null)
    }
    window.addEventListener('resize', settle)
    const flights = running.current
    return () => {
      window.removeEventListener('resize', settle)
      for (const motion of flights.values()) motion.cancel()
      flights.clear()
    }
  }, [finishFlight])

  const openWindow = useCallback((to: string) => {
    const route = parseWindowRoute(to)
    if (!route) return
    if (!allowed(route)) { setNotice(permissionMessage); return }
    setNotice('')
    const existing = latest.current.windows.find(item => item.route.id === route.id)
    const destination = existing && !route.search && !route.hash ? existing.route : route
    const next = promote(latest.current, destination)
    if (next !== latest.current) commit(next)
    writeAddress(hrefForWindow(destination), false)
    if (!next.windows.find(item => item.route.id === destination.id)?.flight) focusFrame(destination.id)
  }, [allowed, commit, writeAddress])

  const focusWindow = useCallback((id: string, fromDock = false) => {
    const item = latest.current.windows.find(window => window.route.id === id)
    if (!item || !allowed(item.route) || (!fromDock && (item.minimized || item.flight))) return
    const next = promote(latest.current, item.route)
    if (next !== latest.current) commit(next)
    writeAddress(hrefForWindow(item.route), true)
    if (fromDock && !next.windows.find(window => window.route.id === id)?.flight) focusFrame(id)
  }, [allowed, commit, writeAddress])

  const hideWindow = useCallback((id: string, keep: boolean) => {
    const previous = latest.current
    if (!previous.windows.some(item => item.route.id === id)) return
    const changed = keep ? amend(previous, id, item => ({ ...item, minimized: true, flight: 'in' })) :
      { ...previous, windows: previous.windows.filter(item => item.route.id !== id) }
    if (previous.activeId === id || previous.activeId === null) {
      const replacement = foremost(changed.windows)
      changed.activeId = replacement?.route.id ?? null
      writeAddress(replacement ? hrefForWindow(replacement.route) : EMPTY_WORKSPACE, true)
      if (!keep && replacement) focusFrame(replacement.route.id)
      if (!keep && !replacement) requestAnimationFrame(() => stage.current?.focus({ preventScroll: true }))
    }
    commit(changed)
    if (keep) requestAnimationFrame(() => {
      if (latest.current.windows.some(item => item.route.id === id && item.minimized)) dockElement(id)?.focus({ preventScroll: true })
    })
  }, [commit, writeAddress])

  const changeSearch = useCallback((id: string, params: URLSearchParams) => {
    const before = latest.current
    const item = before.windows.find(window => window.route.id === id)
    if (!item || !allowed(item.route)) return
    const query = params.toString()
    const route = { ...item.route, search: query ? `?${query}` : '' }
    if (hrefForWindow(route) === hrefForWindow(item.route)) return
    commit(amend(before, id, window => ({ ...window, route })))
    if (before.activeId === id) writeAddress(hrefForWindow(route), true)
  }, [allowed, commit, writeAddress])

  const snap = useCallback((id: string, quadrant: SnapQuadrant) => {
    if (!canSnapRef.current) return
    const base = latest.current
    commit({
      ...base,
      windows: base.windows.map(item => item.route.id === id
        ? { ...item, mode: quadrant, restoreMode: quadrant }
        : item.mode === quadrant ? { ...item, mode: 'floating', restoreMode: 'floating' } : item),
    })
    setPreview(null)
  }, [commit])

  const handleFocusWindow = useCallback((id: string) => focusWindow(id, false), [focusWindow])
  const handleGestureChange = useCallback((id: string, activeGesture: boolean) => {
    setGesturingId((previous) => activeGesture ? id : previous === id ? null : previous)
  }, [])
  const handleGeometry = useCallback((id: string, rect: WindowRect) => {
    commit(amend(latest.current, id, value => ({
      ...value,
      mode: 'floating',
      restoreMode: 'floating',
      floating: clampWindowRect(rect, boundsRef.current),
    })))
  }, [commit])
  const handleMaximize = useCallback((id: string) => {
    if (compactRef.current) return
    const item = latest.current.windows.find((w) => w.route.id === id)
    if (!item) return
    if (canSnapRef.current && item.mode === 'maximized' && item.restoreMode !== 'floating') {
      snap(id, item.restoreMode)
      return
    }
    commit(amend(latest.current, id, value => value.mode === 'maximized'
      ? { ...value, mode: value.restoreMode }
      : { ...value, mode: 'maximized', restoreMode: value.mode }))
  }, [commit, snap])
  const handleMinimize = useCallback((id: string) => hideWindow(id, true), [hideWindow])
  const handleClose = useCallback((id: string) => hideWindow(id, false), [hideWindow])
  const handleDockSelect = useCallback((id: string) => focusWindow(id, true), [focusWindow])
  const workspaceContextValue = useMemo(() => ({ openWindow }), [openWindow])

  const snapBounds = preview && canSnap ? getQuadrantRect(preview, bounds) : null
  const dockHidden = windows.length === 0 || (windows.length === 1 && !windows[0].minimized && !windows[0].flight)
  return <WorkspaceContext.Provider value={workspaceContextValue}>
    <Shell activeTo={active?.route.navPath} title={active?.route.title} dock={
      <WorkspaceDock hidden={dockHidden} collapsed={dockCollapsed} items={windows.map(item => ({
        id: item.route.id, title: item.route.title, icon: item.route.icon,
        active: active === item, minimized: item.minimized,
      }))} onSelect={handleDockSelect} />
    }>
      <main className="workspace-stage" id="main-content" ref={stage} tabIndex={-1} aria-label="窗口工作区" onScrollCapture={trackScroll}>
        {!anyVisible && <div className="workspace-stage-message">
          <LayoutGrid size={25} aria-hidden="true" />
          <strong>{windows.length ? '窗口已收起' : '工作台'}</strong>
          <p>{windows.length ? '点击底部 Dock 恢复窗口，或从侧栏打开其他模块。' : <>从左侧导航打开模块。{canSnap && '把窗口拖到工作区四角可分屏查看。'}</>}</p>
          {!windows.length && <WorkspaceLink to="/" className="button">打开实时监控</WorkspaceLink>}
        </div>}
        {snapBounds && <div className="workspace-snap-preview" data-quadrant={preview ?? undefined} style={{ left: snapBounds.x, top: snapBounds.y, width: snapBounds.width, height: snapBounds.height }} aria-hidden="true" />}
        {windows.map(item => {
          const id = item.route.id
          const visible = !item.minimized && (!compact || compactVisibleId === id)
          const occluded = compositor.occludedIds.has(id)
          const glassTier = compositor.glassTierById.get(id) ?? 'lite'
          return <WindowView key={id} item={item} active={active === item} visible={visible}
            occluded={occluded} glassTier={glassTier}
            compact={compact} canSnap={canSnap} bounds={bounds}
            onFocus={handleFocusWindow} onGestureChange={handleGestureChange} onSearch={changeSearch}
            onGeometry={handleGeometry} onSnap={snap} onPreview={setPreview}
            onMaximize={handleMaximize} onMinimize={handleMinimize} onClose={handleClose} />
        })}
        {notice && <div className="shell-access-notice workspace-notice" role="status">
          <ShieldAlert size={16} aria-hidden="true" />{notice}
          <button className="icon-button" type="button" aria-label="关闭提示" onClick={() => setNotice('')}><X size={14} aria-hidden="true" /></button>
        </div>}
      </main>
    </Shell>
  </WorkspaceContext.Provider>
}
