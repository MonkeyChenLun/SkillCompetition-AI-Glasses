import { useId } from 'react'
import { useThemePreference } from '../../services/theme'

const fmt = (n: number) => Number(n.toFixed(2))

/**
 * Cochlear Eye ("耳蜗之眼") geometric specification in a 120×120 viewBox:
 * - Outer single-stroke Archimedean cochlear spiral represents "Hearing (听)":
 *   starts at the outer-left tail (190°, r = 38.5) and winds clockwise 398° inward to (588°, r = 20.5).
 * - Center focal pupil dot represents "Seeing (看)" at (63.5, 64.1), r = 7.5.
 */
export const COCHLEAR_PUPIL = { cx: 63.5, cy: 64.1, r: 7.5 } as const
export const COCHLEAR_STROKE_WIDTH = 12

function buildCochlearSpiralPath(): string {
  const { cx, cy } = COCHLEAR_PUPIL
  const startDeg = 190
  const spanDeg = 398
  const rStart = 38.5
  const rEnd = 20.5
  const steps = 72
  const pts: [number, number][] = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const deg = startDeg + spanDeg * t
    const rad = (deg * Math.PI) / 180
    const r = rStart + (rEnd - rStart) * t
    pts.push([cx + r * Math.cos(rad), cy + r * Math.sin(rad)])
  }

  // Convert dense smooth sample points into a C1 Catmull-Rom -> Cubic Bézier spline.
  const cmds = [`M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6
    const c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6
    const c2y = p2[1] - (p3[1] - p1[1]) / 6
    cmds.push(`C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`)
  }
  return cmds.join(' ')
}

export const COCHLEAR_SPIRAL_PATH = buildCochlearSpiralPath()

export type BrandPaletteVariant = 'light' | 'dark' | 'navy' | 'amber'

const PALETTES: Record<BrandPaletteVariant, {
  cardBg: string
  cardBorder: string
  spiralStart: string
  spiralEnd: string
  pupilStart: string
  pupilEnd: string
}> = {
  // Scheme A · 蓝到青 (Light Console Theme)
  light: {
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(29, 78, 216, 0.12)',
    spiralStart: '#1D4ED8',
    spiralEnd: '#14B8A6',
    pupilStart: '#1D4ED8',
    pupilEnd: '#14B8A6',
  },
  // Scheme B · 夜里的蓝青 (Dark Console Theme)
  dark: {
    cardBg: '#0E1A33',
    cardBorder: 'rgba(59, 130, 246, 0.26)',
    spiralStart: '#3B82F6',
    spiralEnd: '#2DD4BF',
    pupilStart: '#3B82F6',
    pupilEnd: '#2DD4BF',
  },
  // Scheme C · 深蓝 + 一点青
  navy: {
    cardBg: '#FFFFFF',
    cardBorder: 'rgba(19, 38, 92, 0.12)',
    spiralStart: '#13265C',
    spiralEnd: '#13265C',
    pupilStart: '#14B8A6',
    pupilEnd: '#14B8A6',
  },
  // Scheme D · 暖黑 + 琥珀
  amber: {
    cardBg: '#1F1B16',
    cardBorder: 'rgba(247, 235, 211, 0.16)',
    spiralStart: '#F7EBD3',
    spiralEnd: '#F7EBD3',
    pupilStart: '#F0A23B',
    pupilEnd: '#F0A23B',
  },
}

export default function BrandMark({
  alt = 'NoahVision',
  size = 40,
  themeOverride,
}: {
  alt?: string
  size?: number
  themeOverride?: BrandPaletteVariant
}) {
  const { resolvedTheme } = useThemePreference()
  const variant: BrandPaletteVariant = themeOverride ?? resolvedTheme
  const pal = PALETTES[variant]
  const uid = useId().replace(/:/g, '')

  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
    >
      <defs>
        <linearGradient id={`${uid}-spiral`} x1="34" y1="94" x2="88" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={pal.spiralStart} />
          <stop offset="100%" stopColor={pal.spiralEnd} />
        </linearGradient>
        <linearGradient id={`${uid}-pupil`} x1="56" y1="72" x2="72" y2="56" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={pal.pupilStart} />
          <stop offset="100%" stopColor={pal.pupilEnd} />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill={pal.cardBg} />
      <rect x="1" y="1" width="118" height="118" rx="27" stroke={pal.cardBorder} strokeWidth="2" />
      <path
        d={COCHLEAR_SPIRAL_PATH}
        stroke={`url(#${uid}-spiral)`}
        strokeWidth={COCHLEAR_STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={COCHLEAR_PUPIL.cx}
        cy={COCHLEAR_PUPIL.cy}
        r={COCHLEAR_PUPIL.r}
        fill={`url(#${uid}-pupil)`}
      />
    </svg>
  )
}
