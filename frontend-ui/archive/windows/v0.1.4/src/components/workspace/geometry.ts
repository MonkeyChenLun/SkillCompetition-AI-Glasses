export type WindowRect = { x: number; y: number; width: number; height: number }
export type WorkBounds = { width: number; height: number }
export type SnapQuadrant = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
export type WindowMode = 'floating' | 'maximized' | SnapQuadrant
export const resizeEdges = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const
export type ResizeEdge = typeof resizeEdges[number]

const inset = 12
const gap = 12
const minWidth = 440
const minHeight = 300
// The floating workspace Dock sits above the ordinary bottom inset.
const dockClearance = 64

function edges(bounds: WorkBounds) {
  const x = bounds.width >= 320 ? inset : 0
  const y = bounds.height >= 280 ? inset : 0
  return { x, y, width: Math.max(0, bounds.width - 2 * x), height: Math.max(0, bounds.height - 2 * y) }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function canSplitWorkspace(bounds: WorkBounds) {
  const available = edges(bounds)
  return available.width >= 2 * minWidth + gap && available.height >= minHeight
}

function quadrantArea(bounds: WorkBounds) {
  const available = edges(bounds)
  return { ...available, height: Math.max(0, available.height - dockClearance) }
}

export function canSnapToQuadrant(bounds: WorkBounds) {
  const available = quadrantArea(bounds)
  return available.width >= 2 * minWidth + gap && available.height >= 2 * minHeight + gap
}

export function clampWindowRect(rect: WindowRect, bounds: WorkBounds): WindowRect {
  const available = edges(bounds)
  const width = clamp(rect.width, Math.min(minWidth, available.width), available.width)
  const height = clamp(rect.height, Math.min(minHeight, available.height), available.height)
  return {
    x: clamp(rect.x, available.x, available.x + available.width - width),
    y: clamp(rect.y, available.y, available.y + available.height - height),
    width, height,
  }
}

export function initialWindowRect(bounds: WorkBounds, index: number): WindowRect {
  const available = edges(bounds)
  const width = clamp(available.width * .71, Math.min(minWidth, available.width), Math.min(860, available.width))
  const height = clamp(available.height * .82, Math.min(minHeight, available.height), Math.min(660, available.height))
  const step = (index % 5) * 22
  return clampWindowRect({
    x: Math.round(available.x + (available.width - width) * .46 + step),
    y: Math.round(available.y + (available.height - height) * .36 + step),
    width: Math.round(width),
    height: Math.round(height),
  }, bounds)
}

export function getQuadrantRect(quadrant: SnapQuadrant, bounds: WorkBounds): WindowRect {
  const available = quadrantArea(bounds)
  const width = Math.max(0, (available.width - gap) / 2)
  const height = Math.max(0, (available.height - gap) / 2)
  return {
    x: available.x + (quadrant.endsWith('right') ? width + gap : 0),
    y: available.y + (quadrant.startsWith('bottom') ? height + gap : 0),
    width,
    height,
  }
}

export function getWindowRect(mode: WindowMode, floating: WindowRect, bounds: WorkBounds): WindowRect {
  if (!canSplitWorkspace(bounds) || mode === 'maximized') return edges(bounds)
  if (mode === 'floating' || !canSnapToQuadrant(bounds)) return clampWindowRect(floating, bounds)
  return getQuadrantRect(mode, bounds)
}

export function getResizeRect(start: WindowRect, deltaX: number, deltaY: number, bounds: WorkBounds, edge: ResizeEdge): WindowRect {
  const available = edges(bounds)
  const next = { ...start }
  const right = start.x + start.width
  const bottom = start.y + start.height
  const minX = Math.min(minWidth, start.width)
  const minY = Math.min(minHeight, start.height)

  if (edge.includes('w')) {
    next.x = clamp(start.x + deltaX, available.x, right - minX)
    next.width = right - next.x
  } else if (edge.includes('e')) {
    next.width = clamp(start.width + deltaX, minX, available.x + available.width - start.x)
  }
  if (edge.includes('n')) {
    next.y = clamp(start.y + deltaY, available.y, bottom - minY)
    next.height = bottom - next.y
  } else if (edge.includes('s')) {
    next.height = clamp(start.height + deltaY, minY, available.y + available.height - start.y)
  }
  return next
}

export function getWindowScaleLimits(rect: WindowRect, bounds: WorkBounds) {
  const available = edges(bounds)
  if (!rect.width || !rect.height) return { min: 100, max: 100 }
  // Fix the top-right corner so the control does not move under the pointer.
  const maxWidth = rect.x + rect.width - available.x
  const maxHeight = available.y + available.height - rect.y
  return {
    min: Math.min(100, Math.ceil(100 * Math.max(minWidth / rect.width, minHeight / rect.height))),
    max: Math.max(100, Math.floor(100 * Math.min(maxWidth / rect.width, maxHeight / rect.height) + .00001)),
  }
}

export function scaleWindowRect(rect: WindowRect, percent: number): WindowRect {
  const width = rect.width * percent / 100
  return { ...rect, x: rect.x + rect.width - width, width, height: rect.height * percent / 100 }
}
