/*
 * Liquid window hydrodynamics:
 * - The window hangs from the grab point while its lower body lags behind the pointer, skewing sideways
 *   and squashing/stretching vertically with speed.
 * - Like a lens planing across water, it pitches and banks in 3D perspective (`rotateX`, `rotateY`)
 *   and its corners flex under surface tension (`border-radius` morphing) with a gentle capillary wave.
 * - On release, an under-damped spring lets it wobble back to rest like a drop of thick liquid settling.
 * Writes `transform` and `borderRadius` directly on the frame (no React renders) and clears them at rest.
 */

type Axis = { value: number; velocity: number; target: number }

const STIFFNESS = 230
const DAMPING = 10.5
const MAX_SHIFT_PX = 40
const MAX_STRETCH = 0.08
const MAX_BANK_DEG = 5.5
const MAX_PITCH_DEG = 4.5
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function createLiquidDrag(element: HTMLElement) {
  const skew: Axis = { value: 0, velocity: 0, target: 0 }
  const stretch: Axis = { value: 0, velocity: 0, target: 0 }
  const bank: Axis = { value: 0, velocity: 0, target: 0 }
  const pitch: Axis = { value: 0, velocity: 0, target: 0 }
  let frame = 0
  let previous = 0
  let lastFeed = 0
  let wavePhase = 0
  let held = false

  function settle(axis: Axis, dt: number) {
    const force = -STIFFNESS * (axis.value - axis.target) - DAMPING * axis.velocity
    axis.velocity += force * dt
    axis.value += axis.velocity * dt
  }

  function paint() {
    const height = element.offsetHeight || 1
    const maxAngle = (Math.atan(MAX_SHIFT_PX / height) * 180) / Math.PI
    const energy = Math.min(1, Math.hypot(skew.value, stretch.value))
    const ripple = Math.sin(wavePhase) * energy * 0.14

    const skewDeg = Math.max(-maxAngle * 1.6, Math.min(maxAngle * 1.6, (skew.value + ripple) * maxAngle))
    const sy = 1 + (stretch.value - ripple * 0.35) * MAX_STRETCH
    const sx = 1 / Math.sqrt(Math.max(0.5, sy)) + Math.abs(skew.value) * 0.014
    const rotY = bank.value * MAX_BANK_DEG
    const rotX = pitch.value * MAX_PITCH_DEG

    element.style.transform =
      `perspective(1150px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) ` +
      `skewX(${skewDeg.toFixed(3)}deg) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`

    // Surface-tension corner morphing while the window is in motion.
    const bx = Math.round(skew.value * 8 + Math.sin(wavePhase) * energy * 4)
    const by = Math.round(stretch.value * 7 + Math.cos(wavePhase) * energy * 4)
    const rTL = Math.max(18, Math.min(38, 26 - bx - by))
    const rTR = Math.max(18, Math.min(38, 26 + bx - by))
    const rBR = Math.max(18, Math.min(38, 26 + bx + by))
    const rBL = Math.max(18, Math.min(38, 26 - bx + by))
    element.style.borderRadius = `${rTL}px ${rTR}px ${rBR}px ${rBL}px`
  }

  function clear() {
    element.style.transform = ''
    element.style.transformOrigin = ''
    element.style.borderRadius = ''
    delete element.dataset.liquid
  }

  function tick(now: number) {
    const dt = Math.min(1 / 30, (now - previous) / 1000 || 1 / 60)
    previous = now
    wavePhase += dt * 15
    if (held && now - lastFeed > 60) {
      skew.target *= 0.8
      stretch.target *= 0.8
      bank.target *= 0.8
      pitch.target *= 0.8
    }
    for (let i = 0; i < 2; i++) {
      const hdt = dt / 2
      settle(skew, hdt)
      settle(stretch, hdt)
      settle(bank, hdt)
      settle(pitch, hdt)
    }
    const resting =
      !held &&
      [skew, stretch, bank, pitch].every(axis => Math.abs(axis.value) < 0.002 && Math.abs(axis.velocity) < 0.02)
    if (resting) {
      frame = 0
      clear()
      return
    }
    paint()
    frame = requestAnimationFrame(tick)
  }

  function run() {
    if (frame) return
    previous = performance.now()
    frame = requestAnimationFrame(tick)
  }

  return {
    /** Start a drag; origin is the grab point relative to the element's top-left corner. */
    begin(originX: number, originY: number) {
      if (reducedMotion()) return
      held = true
      element.dataset.liquid = ''
      element.style.transformOrigin = `${originX}px ${originY}px`
    },
    /** Pointer velocity in px/ms. */
    feed(vx: number, vy: number) {
      if (!held) return
      lastFeed = performance.now()
      skew.target = Math.max(-1, Math.min(1, -vx / 2.1))
      stretch.target = Math.max(-1, Math.min(1, -vy / 2.3))
      bank.target = Math.max(-1, Math.min(1, vx / 1.9))
      pitch.target = Math.max(-1, Math.min(1, -vy / 2.0))
      run()
    },
    release() {
      if (!held) return
      held = false
      skew.target = 0
      stretch.target = 0
      bank.target = 0
      pitch.target = 0
      run()
    },
    dispose() {
      held = false
      cancelAnimationFrame(frame)
      frame = 0
      clear()
    },
  }
}

export type LiquidDrag = ReturnType<typeof createLiquidDrag>
