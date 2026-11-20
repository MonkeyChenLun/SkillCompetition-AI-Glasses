import { Clock3, Glasses, House, Settings2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

export const tabs = [
  { route: 'home', label: '首页', icon: House },
  { route: 'device', label: '设备', icon: Glasses },
  { route: 'history', label: '记录', icon: Clock3 },
  { route: 'settings', label: '设置', icon: Settings2 },
] as const

export type Tab = typeof tabs[number]['route']

type Press = {
  pointerId: number
  itemBounds: DOMRect
  x: number
  y: number
  timer: number
  drag?: Drag
}

type TabPosition = { route: Tab; center: number }

type Drag = {
  positions: TabPosition[]
  origin: number
  minY: number
  maxY: number
  width: number
  grabOffset: number
  candidate: Tab
}

const holdDelay = 450
const movementTolerance = 12
const verticalTolerance = 28

function movedBeforeHold(event: ReactPointerEvent<HTMLElement>, press: Press) {
  const { clientX, clientY } = event
  const bounds = press.itemBounds
  return Math.hypot(clientX - press.x, clientY - press.y) > movementTolerance ||
    clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom
}

function locateDrag(drag: Drag, x: number, y: number) {
  if (y < drag.minY || y > drag.maxY) return null
  const first = drag.positions[0]
  const last = drag.positions[drag.positions.length - 1]
  const center = Math.min(last.center, Math.max(first.center, x - drag.grabOffset))
  const nearest = drag.positions.reduce((closest, position) =>
    Math.abs(position.center - center) < Math.abs(closest.center - center) ? position : closest,
  )
  return { left: center - drag.origin - drag.width / 2, route: nearest.route }
}

export function BottomNav({ currentTab }: { currentTab: Tab }) {
  const [candidateTab, setCandidateTab] = useState<Tab | null>(null)
  const nav = useRef<HTMLElement>(null)
  const press = useRef<Press | null>(null)
  const suppressClick = useRef(false)

  const clearPress = useCallback(() => {
    const active = press.current
    if (!active) return
    window.clearTimeout(active.timer)
    press.current = null
    setCandidateTab(null)
  }, [])

  const cancelPress = useCallback(() => {
    if (!press.current) return
    suppressClick.current = true
    clearPress()
  }, [clearPress])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) cancelPress()
    }
    window.addEventListener('blur', cancelPress)
    window.addEventListener('hashchange', cancelPress)
    window.addEventListener('resize', cancelPress)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', cancelPress)
      window.removeEventListener('hashchange', cancelPress)
      window.removeEventListener('resize', cancelPress)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (press.current) window.clearTimeout(press.current.timer)
    }
  }, [cancelPress])

  function startPress(event: ReactPointerEvent<HTMLAnchorElement>, tab: Tab) {
    if (!event.isPrimary || event.button !== 0) return
    cancelPress()
    suppressClick.current = false
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return

    // Keep the original link as the pointer target so short taps still activate it.
    event.currentTarget.setPointerCapture(event.pointerId)
    const active: Press = {
      pointerId: event.pointerId,
      itemBounds: event.currentTarget.getBoundingClientRect(),
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(() => {
        const bar = nav.current
        if (press.current !== active || !bar) return
        const items = [...bar.querySelectorAll<HTMLAnchorElement>('.nav-item')]
        const positions = tabs.map(({ route }, index) => {
          const rect = items[index].getBoundingClientRect()
          return { route, center: rect.left + rect.width / 2 }
        })
        const bounds = bar.getBoundingClientRect()
        const itemCenter = active.itemBounds.left + active.itemBounds.width / 2
        const width = active.itemBounds.width + 10
        active.drag = {
          positions,
          origin: bounds.left + bar.clientLeft,
          minY: bounds.top - verticalTolerance,
          maxY: bounds.bottom + verticalTolerance,
          width,
          grabOffset: active.x - itemCenter,
          candidate: tab,
        }
        bar.style.setProperty('--nav-press-width', `${width}px`)
        bar.style.setProperty('--nav-press-left', `${itemCenter - active.drag.origin - width / 2}px`)
        setCandidateTab(tab)
      }, holdDelay),
    }
    press.current = active
  }

  function cancelPointer(event: ReactPointerEvent<HTMLElement>) {
    if (press.current?.pointerId === event.pointerId) cancelPress()
  }

  function movePress(event: ReactPointerEvent<HTMLElement>) {
    const active = press.current
    if (!active || active.pointerId !== event.pointerId) return
    if (!active.drag) {
      if (movedBeforeHold(event, active)) cancelPress()
      return
    }
    const position = locateDrag(active.drag, event.clientX, event.clientY)
    if (!position) {
      cancelPress()
      return
    }
    event.currentTarget.style.setProperty('--nav-press-left', `${position.left}px`)
    if (active.drag.candidate !== position.route) {
      active.drag.candidate = position.route
      setCandidateTab(position.route)
    }
  }

  function finishPress(event: ReactPointerEvent<HTMLElement>) {
    const active = press.current
    if (!active || active.pointerId !== event.pointerId) return
    if (!active.drag) {
      if (movedBeforeHold(event, active)) cancelPress()
      else clearPress()
      return
    }

    const position = locateDrag(active.drag, event.clientX, event.clientY)
    suppressClick.current = true
    clearPress()
    if (position) window.location.hash = `#/${position.route}`
  }

  return (
    <nav
      className="app-nav"
      aria-label="主导航"
      ref={nav}
      onPointerMove={movePress}
      onPointerCancel={cancelPointer}
      onLostPointerCapture={cancelPointer}
      onPointerUp={finishPress}
      onClickCapture={(event) => {
        if (event.detail === 0 || !suppressClick.current) return
        event.preventDefault()
        suppressClick.current = false
      }}
    >
      {candidateTab && <span className="nav-press-bubble" aria-hidden="true" />}
      {tabs.map(({ route, label, icon: Icon }) => {
        const destination = `#/${route}`
        return (
          <a
            className="nav-item"
            key={route}
            href={destination}
            data-long-pressed={candidateTab === route || undefined}
            aria-current={currentTab === route ? 'page' : undefined}
            onPointerDown={(event) => startPress(event, route)}
            onContextMenu={(event) => {
              if (press.current || (event.nativeEvent instanceof PointerEvent && event.nativeEvent.pointerType === 'touch')) {
                event.preventDefault()
              }
            }}
            onDragStart={(event) => event.preventDefault()}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </a>
        )
      })}
    </nav>
  )
}
