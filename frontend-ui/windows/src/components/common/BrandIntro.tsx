import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useThemePreference } from '../../services/theme'
import { FLUID_UNICURSAL_STAR_PATH, NOAH_ARK_OLIVE_WREATH_PATH } from './BrandMark'
import './brand-intro.css'

const introKey = 'aig-ui-brand-intro-v6'
const INTRO_DURATION_MS = 3950
const DISSOLVE_AT_MS = 3300
const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
export const REPLAY_INTRO_EVENT = 'noah:replay-intro'

/** Trigger the NoahVision startup cinema on demand (e.g., for live competition demos). */
export function replayBrandIntro() {
  window.dispatchEvent(new CustomEvent(REPLAY_INTRO_EVENT))
}

function shouldPlayIntro() {
  if (window.matchMedia(reducedMotionQuery).matches || document.visibilityState === 'hidden') return false
  try {
    return sessionStorage.getItem(introKey) !== 'seen'
  } catch {
    return true
  }
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutQuart = (t: number) => 1 - (1 - t) ** 4
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)

export default function BrandIntro({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useThemePreference()
  const [introTheme, setIntroTheme] = useState(resolvedTheme)
  const [active, setActive] = useState(shouldPlayIntro)
  const [dissolving, setDissolving] = useState(false)
  const [runId, setRunId] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wreathRef = useRef<SVGPathElement>(null)
  const starRef = useRef<SVGPathElement>(null)
  const wreathTipRef = useRef<SVGCircleElement>(null)
  const starTipRef = useRef<SVGCircleElement>(null)
  const uid = useId().replace(/:/g, '')

  const finish = useCallback(() => {
    setDissolving(false)
    setActive(false)
  }, [])

  useEffect(() => {
    function onReplay() {
      if (window.matchMedia(reducedMotionQuery).matches) return
      setIntroTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
      setDissolving(false)
      setActive(true)
      setRunId(n => n + 1)
    }
    window.addEventListener(REPLAY_INTRO_EVENT, onReplay)
    return () => window.removeEventListener(REPLAY_INTRO_EVENT, onReplay)
  }, [])

  useEffect(() => {
    if (!active) return
    try {
      sessionStorage.setItem(introKey, 'seen')
    } catch {
      // Intro still works without storage.
    }

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const wreathEl = wreathRef.current
    const starEl = starRef.current
    const wreathTip = wreathTipRef.current
    const starTip = starTipRef.current

    const wreathLen = wreathEl?.getTotalLength?.() || 1
    const starLen = starEl?.getTotalLength?.() || 1

    const isLight = introTheme === 'light'
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    type Mote = { angle: number; radius: number; speed: number; radialSpeed: number; size: number; alpha: number; hue: number }
    const motes: Mote[] = Array.from({ length: 76 }, (_, i) => ({
      angle: (i * 2.39996) % (Math.PI * 2),
      radius: 40 + (i % 19) * 18 + Math.random() * 25,
      speed: (0.28 + (i % 5) * 0.12) * (i % 2 === 0 ? 1 : -1),
      radialSpeed: -14 - (i % 7) * 3,
      size: 1.1 + (i % 4) * 0.55,
      alpha: 0.35 + (i % 5) * 0.12,
      hue: i % 3,
    }))

    function resize() {
      if (!canvas) return
      canvas.width = Math.round(innerWidth * dpr)
      canvas.height = Math.round(innerHeight * dpr)
    }
    resize()

    let raf = 0
    const start = performance.now()
    let startedDissolve = false

    function tick(now: number) {
      const elapsed = now - start
      if (elapsed >= DISSOLVE_AT_MS && !startedDissolve) {
        startedDissolve = true
        setDissolving(true)
      }
      if (elapsed >= INTRO_DURATION_MS) {
        finish()
        return
      }

      // 1. Update single-stroke SVG paths & live comet-light drawing tips
      const pWreath = easeInOutCubic(clamp01((elapsed - 160) / 1880))
      const pStar = easeInOutCubic(clamp01((elapsed - 680) / 1520))
      const pFill = easeOutQuart(clamp01((elapsed - 1750) / 850))

      if (wreathEl) {
        wreathEl.style.strokeDashoffset = String(1 - pWreath)
        wreathEl.style.fillOpacity = String(pFill)
      }
      if (starEl) {
        starEl.style.strokeDashoffset = String(1 - pStar)
        starEl.style.fillOpacity = String(pFill)
      }
      if (wreathTip && wreathEl) {
        if (pWreath > 0.01 && pWreath < 0.995) {
          const pt = wreathEl.getPointAtLength(pWreath * wreathLen)
          wreathTip.setAttribute('cx', pt.x.toFixed(1))
          wreathTip.setAttribute('cy', pt.y.toFixed(1))
          wreathTip.style.opacity = '1'
        } else {
          wreathTip.style.opacity = '0'
        }
      }
      if (starTip && starEl) {
        if (pStar > 0.01 && pStar < 0.995) {
          const pt = starEl.getPointAtLength(pStar * starLen)
          starTip.setAttribute('cx', pt.x.toFixed(1))
          starTip.setAttribute('cy', pt.y.toFixed(1))
          starTip.style.opacity = '1'
        } else {
          starTip.style.opacity = '0'
        }
      }

      // 2. Render concentric water ripples, caustic shockwave and orbital bioluminescent particles on canvas
      if (ctx && canvas) {
        const w = canvas.width
        const h = canvas.height
        const cx = w * 0.5
        const cy = h * 0.44
        const tSec = elapsed / 1000
        ctx.clearRect(0, 0, w, h)

        // Concentric water ripple rings radiating from the totem center
        const ringTimes = [0.05, 0.55, 1.15, 1.85]
        for (const rt of ringTimes) {
          const age = tSec - rt
          if (age <= 0 || age > 2.4) continue
          const progress = age / 2.4
          const radius = (28 + easeOutQuart(progress) * 340) * dpr
          const alpha = (1 - progress) * (1 - progress) * (isLight ? 0.24 : 0.32)
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.strokeStyle = isLight ? `rgba(37, 99, 235, ${alpha})` : `rgba(125, 211, 252, ${alpha})`
          ctx.lineWidth = (2.2 - progress * 1.4) * dpr
          ctx.stroke()
        }

        // Orbital glowing water particles swirling gently around the Noah Ark & Star
        const moteColors = isLight
          ? ['37, 99, 235', '14, 148, 196', '79, 70, 229']
          : ['125, 211, 252', '94, 234, 212', '165, 180, 252']

        for (const m of motes) {
          const a = m.angle + tSec * m.speed
          const r = Math.max(36, m.radius + Math.sin(tSec * 1.4 + m.angle) * 18) * dpr
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r * 0.88
          const pulse = 0.55 + 0.45 * Math.sin(tSec * 3.2 + m.angle * 2)
          const alpha = m.alpha * pulse * clamp01(tSec / 0.4)
          const rad = m.size * dpr * 2.8

          const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
          g.addColorStop(0, isLight ? `rgba(255,255,255,${alpha})` : `rgba(255,255,255,${alpha})`)
          g.addColorStop(0.35, `rgba(${moteColors[m.hue]},${alpha * 0.85})`)
          g.addColorStop(1, `rgba(${moteColors[m.hue]},0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(x, y, rad, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      raf = requestAnimationFrame(tick)
    }

    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' || event.key === ' ') {
        event.preventDefault()
        finish()
      }
    }

    const motionPreference = window.matchMedia(reducedMotionQuery)
    function handleReducedMotion() {
      if (motionPreference.matches) finish()
    }

    raf = requestAnimationFrame(tick)
    window.addEventListener('resize', resize)
    window.addEventListener('keydown', handleKey)
    motionPreference.addEventListener('change', handleReducedMotion)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', handleKey)
      motionPreference.removeEventListener('change', handleReducedMotion)
    }
  }, [active, introTheme, runId, finish])

  return (
    <>
      {children}
      {active && (
        <div
          className={`brand-intro${dissolving ? ' brand-intro--dissolving' : ''}`}
          data-intro-theme={introTheme}
          role="dialog"
          aria-label="NoahVision 启动动画"
          onClick={finish}
        >
          <canvas ref={canvasRef} className="brand-intro-canvas" aria-hidden="true" />
          <div className="brand-intro-center">
            <div className="brand-intro-totem">
              <div className="brand-intro-halo" aria-hidden="true" />
              <svg viewBox="0 0 120 120" className="brand-intro-svg" fill="none" aria-hidden="true">
                <defs>
                  <linearGradient id={`${uid}-stroke`} x1="14" y1="98" x2="106" y2="18" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={introTheme === 'light' ? '#1e3a8a' : '#60a5fa'} />
                    <stop offset="50%" stopColor={introTheme === 'light' ? '#2563eb' : '#ffffff'} />
                    <stop offset="100%" stopColor={introTheme === 'light' ? '#0d9488' : '#5eead4'} />
                  </linearGradient>
                  <linearGradient id={`${uid}-fill`} x1="16" y1="20" x2="104" y2="100" gradientUnits="userSpaceOnUse">
                    <stop
                      offset="0%"
                      stopColor={introTheme === 'light' ? '#2563eb' : '#7dd3fc'}
                      stopOpacity={introTheme === 'light' ? '0.24' : '0.28'}
                    />
                    <stop
                      offset="100%"
                      stopColor={introTheme === 'light' ? '#0d9488' : '#38bdf8'}
                      stopOpacity={introTheme === 'light' ? '0.14' : '0.16'}
                    />
                  </linearGradient>
                  <linearGradient id={`${uid}-star`} x1="42" y1="30" x2="78" y2="70" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={introTheme === 'light' ? '#1e3a8a' : '#ffffff'} />
                    <stop offset="55%" stopColor={introTheme === 'light' ? '#2563eb' : '#7dd3fc'} />
                    <stop offset="100%" stopColor={introTheme === 'light' ? '#0d9488' : '#5eead4'} />
                  </linearGradient>
                  <radialGradient id={`${uid}-spark`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="45%" stopColor={introTheme === 'light' ? '#3b82f6' : '#7dd3fc'} stopOpacity="0.9" />
                    <stop offset="100%" stopColor={introTheme === 'light' ? '#2563eb' : '#38bdf8'} stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Single-stroke Noah Ark + UN Paired Olive Wreath */}
                <path
                  ref={wreathRef}
                  pathLength={1}
                  d={NOAH_ARK_OLIVE_WREATH_PATH}
                  fill={`url(#${uid}-fill)`}
                  stroke={`url(#${uid}-stroke)`}
                  strokeWidth="3.1"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="brand-intro-path"
                />

                {/* Single-stroke Fluid Ribbon 5-Pointed Star (1B-②) */}
                <path
                  ref={starRef}
                  pathLength={1}
                  d={FLUID_UNICURSAL_STAR_PATH}
                  fill={`url(#${uid}-fill)`}
                  stroke={`url(#${uid}-star)`}
                  strokeWidth="3.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="brand-intro-path"
                />

                {/* Live glowing comet sparks riding the tips of the single-stroke lines */}
                <circle ref={wreathTipRef} r="5.5" fill={`url(#${uid}-spark)`} style={{ opacity: 0 }} />
                <circle ref={starTipRef} r="6.2" fill={`url(#${uid}-spark)`} style={{ opacity: 0 }} />
              </svg>
            </div>

            <div className="brand-intro-lockup">
              <div className="brand-intro-title">NOAH VISION</div>
              <div className="brand-intro-subtitle">
                <span>SEE BEYOND</span>
                <span className="brand-intro-dot" aria-hidden="true" />
                <span>诺亚视界 · 智见无界</span>
              </div>
            </div>
          </div>

          <button type="button" className="brand-intro-skip" onClick={finish}>
            跳过开场 <kbd>Esc</kbd>
          </button>
        </div>
      )}
    </>
  )
}
