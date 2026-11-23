import type { WindowMode, WindowRect } from './geometry'

export interface CompositorEntry {
  id: string
  order: number
  mode: WindowMode
  rect: WindowRect
  minimized: boolean
  flying: boolean
}

export type GlassTier = 'full' | 'lite'

export interface CompositorPlan {
  /** Windows completely covered by one or more non-gesturing windows above them. */
  occludedIds: Set<string>
  /** GPU backdrop-filter budget assignment per visible window (capped to prevent Chromium Skia flicker). */
  glassTierById: Map<string, GlassTier>
  /** Count of genuinely visible (non-minimized, non-occluded) windows currently on stage. */
  visibleCount: number
}

/**
 * Maximum simultaneous windows allowed to hold live GPU Gaussian `backdrop-filter` passes over
 * the animated WebGL background. Additional visible floating windows smoothly fall back to a
 * lightweight translucent surface (`lite`) so rapid stress-opening never exhausts VRAM or flickers.
 */
export const MAX_FULL_GLASS_WINDOWS = 3

/** Returns true when `outer` completely encloses `inner` within `epsilon` px tolerance. */
function rectContains(outer: WindowRect, inner: WindowRect, epsilon = 2): boolean {
  return (
    outer.x <= inner.x + epsilon &&
    outer.y <= inner.y + epsilon &&
    outer.x + outer.width >= inner.x + inner.width - epsilon &&
    outer.y + outer.height >= inner.y + inner.height - epsilon
  )
}

/**
 * 2D Window Manager Occlusion Culling + GPU Backdrop-Filter Layer Budgeting:
 * 1. Walks non-minimized windows front-to-back (descending z-order).
 * 2. Culls windows completely hidden behind a resting maximized or enclosing upper window
 *    (zero paint, zero GPU blur, while preserving full React state and scroll position).
 * 3. Never treats a currently dragged/gesturing (transparent) or mid-flight window as an occluder,
 *    so underlying windows appear seamlessly when lifting or animating a top window.
 * 4. Caps full `backdrop-filter` layers to the topmost `MAX_FULL_GLASS_WINDOWS` visible windows.
 */
export function computeWindowCompositor(
  entries: readonly CompositorEntry[],
  gesturingId: string | null,
): CompositorPlan {
  const occludedIds = new Set<string>()
  const glassTierById = new Map<string, GlassTier>()

  const frontToBack = entries
    .filter((entry) => !entry.minimized)
    .sort((a, b) => b.order - a.order)

  const occluders: WindowRect[] = []
  let fullGlassUsed = 0
  let visibleCount = 0

  for (const entry of frontToBack) {
    const isGesturing = entry.id === gesturingId
    const isCovered =
      !entry.flying &&
      !isGesturing &&
      occluders.some((cover) => rectContains(cover, entry.rect))

    if (isCovered) {
      occludedIds.add(entry.id)
      glassTierById.set(entry.id, 'lite')
      continue
    }

    visibleCount += 1

    if (isGesturing || fullGlassUsed < MAX_FULL_GLASS_WINDOWS) {
      glassTierById.set(entry.id, 'full')
      fullGlassUsed += 1
    } else {
      glassTierById.set(entry.id, 'lite')
    }

    // Resting non-flying windows occlude any window completely behind their bounds.
    if (!entry.flying && !isGesturing && entry.rect.width > 0 && entry.rect.height > 0) {
      occluders.push(entry.rect)
    }
  }

  return { occludedIds, glassTierById, visibleCount }
}
