import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useThemePreference } from '../../services/theme'
import { COCHLEAR_PUPIL, COCHLEAR_SPIRAL_PATH, COCHLEAR_STROKE_WIDTH } from './BrandMark'
import './brand-intro.css'

const introKey = 'aig-ui-brand-intro-v7'
const INTRO_DURATION_MS = 3850
const DISSOLVE_AT_MS = 3220
const reducedMotionQuery = '(prefers-reduced-motion: reduce)'
export const REPLAY_INTRO_EVENT = 'noah:replay-intro'

/** Trigger the NoahVision "Cochlear Eye · 耳蜗之眼" startup cinema on demand. */
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

/** Subtle spring pop for the focal pupil ignition ("中间一点瞳孔代表「看」"). */
function easeOutBack(t: number) {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

export default function BrandIntro({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useThemePreference()
  const [introTheme, setIntroTheme] = useState(resolvedTheme)
  const [active, setActive] = useState(shouldPlayIntro)
  const [dissolving, setDissolving] = useState(false)
  const [runId, setRunId] = useState(0)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spiralRef = useRef<SVGPathElement>(null)
  const spiralTipRef = useRef<SVGCircleElement>(null)
  const pupilRef = useRef<SVGCircleElement>(null)
  const pupilHaloRef = useRef<SVGCircleElement>(null)
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
      setRunId((n) => n + 1)
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
    const spiralEl = spiralRef.current
    const spiralTip = spiralTipRef.current
    const pupilEl = pupilRef.current
    const pupilHaloEl = pupilHaloRef.current

    const spiralLen = spiralEl?.getTotalLength?.() || 1
    const isLight = introTheme === 'light'
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    type SoundMote = {
      baseAngle: number
      startRadius: number
      endRadius: number
      speed: number
      size: number
      alpha: number
      isTeal: boolean
    }
    // Acoustic particles spiraling inward like sound waves entering the cochlea.
    const motes: SoundMote[] = Array.from({ length: 64 }, (_, i) => ({
      baseAngle: (i * 2.39996) % (Math.PI * 2),
      startRadius: 90 + (i % 16) * 16,
      endRadius: 34 + (i % 9) * 8,
      speed: 0.72 + (i % 5) * 0.16,
      size: 1.2 + (i % 4) * 0.55,
      alpha: 0.32 + (i % 5) * 0.11,
      isTeal: i % 2 === 0,
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

      // Phase 1 ("听"): Single-stroke cochlear spiral sweeps clockwise from outer tail inward (120ms -> 1680ms)
      const pSpiral = easeInOutCubic(clamp01((elapsed - 120) / 1560))
      // Phase 2 ("看"): Focal pupil dot ignites at the center right as the spiral curls home (1320ms -> 1960ms)
      const pPupilRaw = clamp01((elapsed - 1320) / 640)
      const pupilScale = pPupilRaw <= 0 ? 0 : Math.max(0, easeOutBack(pPupilRaw))

      if (spiralEl) {
        spiralEl.style.strokeDashoffset = String(1 - pSpiral)
      }
      if (spiralTip && spiralEl) {
        if (pSpiral > 0.01 && pSpiral < 0.992) {
          const pt = spiralEl.getPointAtLength(pSpiral * spiralLen)
          spiralTip.setAttribute('cx', pt.x.toFixed(2))
          spiralTip.setAttribute('cy', pt.y.toFixed(2))
          spiralTip.style.opacity = '1'
        } else {
          spiralTip.style.opacity = '0'
        }
      }
      if (pupilEl) {
        pupilEl.setAttribute('r', (COCHLEAR_PUPIL.r * pupilScale).toFixed(2))
        pupilEl.style.opacity = pPupilRaw > 0.01 ? '1' : '0'
      }
      if (pupilHaloEl) {
        const haloProgress = clamp01((elapsed - 1340) / 1100)
        const haloR = COCHLEAR_PUPIL.r * (1 + easeOutQuart(haloProgress) * 2.4)
        const haloAlpha = haloProgress > 0 ? (1 - haloProgress) * 0.55 : 0
        pupilHaloEl.setAttribute('r', haloR.toFixed(2))
        pupilHaloEl.style.opacity = haloAlpha.toFixed(3)
      }

      // Render acoustic cochlear soundwave rings + pupil ignition flash + spiraling sound motes
      if (ctx && canvas) {
        const w = canvas.width
        const h = canvas.height
        const cx = w * 0.5
        const cy = h * 0.435
        const tSec = elapsed / 1000
        ctx.clearRect(0, 0, w, h)

        const blueRGB = isLight ? '29, 78, 216' : '59, 130, 246'
        const tealRGB = isLight ? '20, 184, 166' : '45, 212, 191'

        // Acoustic wave rings (outer sound -> inner hearing, plus the 1.34s pupil "light awakening" ripple)
        const ringSpecs = [
          { at: 0.08, maxR: 280, color: blueRGB, weight: 1.8 },
          { at: 0.58, maxR: 310, color: tealRGB, weight: 1.8 },
          { at: 1.34, maxR: 380, color: tealRGB, weight: 2.6 },
        ]
        for (const ring of ringSpecs) {
          const age = tSec - ring.at
          if (age <= 0 || age > 2.2) continue
          const p = age / 2.2
          const radius = (22 + easeOutQuart(p) * ring.maxR) * dpr
          const alpha = (1 - p) * (1 - p) * (isLight ? 0.22 : 0.30)
          ctx.beginPath()
          ctx.arc(cx, cy, radius, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${ring.color}, ${alpha})`
          ctx.lineWidth = Math.max(0.6, (ring.weight - p * 1.2) * dpr)
          ctx.stroke()
        }

        // Spiraling sound-and-light particles converging gently around the Cochlear Eye
        const converge = easeOutQuart(clamp01(tSec / 2.2))
        for (const m of motes) {
          const a = m.baseAngle + tSec * m.speed
          const r = (m.startRadius + (m.endRadius - m.startRadius) * converge + Math.sin(tSec * 1.8 + m.baseAngle) * 10) * dpr
          const x = cx + Math.cos(a) * r
          const y = cy + Math.sin(a) * r * 0.92
          const pulse = 0.6 + 0.4 * Math.sin(tSec * 3.0 + m.baseAngle * 2)
          const alpha = m.alpha * pulse * clamp01(tSec / 0.35)
          const rad = m.size * dpr * 2.6
          const rgb = m.isTeal ? tealRGB : blueRGB

          const g = ctx.createRadialGradient(x, y, 0, x, y, rad)
          g.addColorStop(0, `rgba(255, 255, 255, ${alpha})`)
          g.addColorStop(0.4, `rgba(${rgb}, ${alpha * 0.88})`)
          g.addColorStop(1, `rgba(${rgb}, 0)`)
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

  const isLight = introTheme === 'light'
  const blueHex = isLight ? '#1D4ED8' : '#3B82F6'
  const tealHex = isLight ? '#14B8A6' : '#2DD4BF'
  const cardBg = isLight ? '#FFFFFF' : '#0E1A33'
  const cardBorder = isLight ? 'rgba(29, 78, 216, 0.14)' : 'rgba(59, 130, 246, 0.28)'

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
                  <linearGradient id={`${uid}-spiral`} x1="34" y1="94" x2="88" y2="26" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={blueHex} />
                    <stop offset="100%" stopColor={tealHex} />
                  </linearGradient>
                  <linearGradient id={`${uid}-pupil`} x1="56" y1="72" x2="72" y2="56" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor={blueHex} />
                    <stop offset="100%" stopColor={tealHex} />
                  </linearGradient>
                  <radialGradient id={`${uid}-spark`} cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="45%" stopColor={tealHex} stopOpacity="0.92" />
                    <stop offset="100%" stopColor={blueHex} stopOpacity="0" />
                  </radialGradient>
                </defs>

                {/* Squircle icon card matching Scheme A (light) / Scheme B (dark) */}
                <rect width="120" height="120" rx="28" fill={cardBg} className="brand-intro-card" />
                <rect x="1" y="1" width="118" height="118" rx="27" stroke={cardBorder} strokeWidth="2" className="brand-intro-card" />

                {/* Outer single-stroke cochlear spiral ("外面一笔耳蜗代表「听」") */}
                <path
                  ref={spiralRef}
                  pathLength={1}
                  d={COCHLEAR_SPIRAL_PATH}
                  stroke={`url(#${uid}-spiral)`}
                  strokeWidth={COCHLEAR_STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="brand-intro-path"
                />

                {/* Expanding iris pulse ring when the pupil ignites */}
                <circle
                  ref={pupilHaloRef}
                  cx={COCHLEAR_PUPIL.cx}
                  cy={COCHLEAR_PUPIL.cy}
                  r={COCHLEAR_PUPIL.r}
                  stroke={tealHex}
                  strokeWidth="2.4"
                  style={{ opacity: 0 }}
                />

                {/* Center pupil focal dot ("中间一点瞳孔代表「看」") */}
                <circle
                  ref={pupilRef}
                  cx={COCHLEAR_PUPIL.cx}
                  cy={COCHLEAR_PUPIL.cy}
                  r={0}
                  fill={`url(#${uid}-pupil)`}
                  style={{ opacity: 0 }}
                />

                {/* Live glowing comet spark riding the cochlear stroke tip */}
                <circle ref={spiralTipRef} r="8.5" fill={`url(#${uid}-spark)`} style={{ opacity: 0 }} />
              </svg>
            </div>

            <div className="brand-intro-lockup">
              <div className="brand-intro-title">NoahVision</div>
              <div className="brand-intro-subtitle">
                <span>耳蜗之眼 · 听见万象</span>
                <span className="brand-intro-dot" aria-hidden="true" />
                <span>看见光芒</span>
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
