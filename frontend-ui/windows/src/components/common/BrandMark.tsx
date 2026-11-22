import { useId } from 'react'
import { useThemePreference } from '../../services/theme'

const fmt = (n: number) => Number(n).toFixed(1)

/**
 * Parametric generator for the UN-style paired olive branch rising from the Noah Ark crescent base.
 * Climbs the outer stem folding out 4 pointed olive leaves, forms the terminal tip leaf,
 * and descends the inner stem folding out 4 paired inner olive leaves in one continuous stroke.
 */
function buildBranchSubpath(side: 1 | -1) {
  const cx = 60
  const cy = 54
  const R = 36
  const tiers = [36, 64, 92, 118]
  const topDeg = 140
  const leafLen = 14.5
  const leafSpread = 10

  const pt = (deg: number, radialOffset = 0): [number, number] => {
    const rad = (deg * Math.PI) / 180
    const r = R + radialOffset
    return [cx - side * r * Math.sin(rad), cy + r * Math.cos(rad)]
  }
  const vec = (deg: number, along: number, out: number): [number, number] => {
    const rad = (deg * Math.PI) / 180
    const tx = -side * Math.cos(rad)
    const ty = -Math.sin(rad)
    const nx = -side * Math.sin(rad)
    const ny = Math.cos(rad)
    return [tx * along + nx * out, ty * along + ny * out]
  }
  const add = (p: [number, number], v: [number, number]): [number, number] => [p[0] + v[0], p[1] + v[1]]

  const cmds: string[] = []
  for (let i = 0; i < tiers.length; i++) {
    const deg = tiers[i]
    const scale = 1 - i * 0.08
    const L = leafLen * scale
    const W = leafSpread * scale
    const base = pt(deg, 0)
    cmds.push(`L ${fmt(base[0])} ${fmt(base[1])}`)

    const c1 = add(base, vec(deg, L * 0.18, W * 0.92))
    const c2 = add(base, vec(deg, L * 0.68, W * 1.05))
    const tip = add(base, vec(deg, L * 1.04, W * 0.84))
    const rejoin = pt(deg + 7, 0)
    const c3 = add(base, vec(deg, L * 0.72, W * 0.22))
    const c4 = add(rejoin, vec(deg + 7, L * 0.12, W * 0.08))
    cmds.push(`C ${fmt(c1[0])} ${fmt(c1[1])} ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(tip[0])} ${fmt(tip[1])}`)
    cmds.push(`C ${fmt(c3[0])} ${fmt(c3[1])} ${fmt(c4[0])} ${fmt(c4[1])} ${fmt(rejoin[0])} ${fmt(rejoin[1])}`)
  }

  const topBase = pt(topDeg - 4, 0)
  cmds.push(`L ${fmt(topBase[0])} ${fmt(topBase[1])}`)
  const tL = leafLen * 0.78
  const tW = leafSpread * 0.55
  const tc1 = add(topBase, vec(topDeg, tL * 0.35, tW * 0.7))
  const tTip = add(topBase, vec(topDeg, tL * 1.05, tW * 0.15))
  const tc2 = add(topBase, vec(topDeg, tL * 0.45, -tW * 0.65))
  const topIn = pt(topDeg - 5, -0.5)
  cmds.push(`C ${fmt(tc1[0])} ${fmt(tc1[1])} ${fmt(tTip[0])} ${fmt(tTip[1])} ${fmt(tTip[0])} ${fmt(tTip[1])}`)
  cmds.push(`C ${fmt(tc2[0])} ${fmt(tc2[1])} ${fmt(topIn[0])} ${fmt(topIn[1])} ${fmt(topIn[0])} ${fmt(topIn[1])}`)

  for (let i = tiers.length - 1; i >= 0; i--) {
    const deg = tiers[i] + 3
    const scale = (1 - i * 0.08) * 0.84
    const L = leafLen * scale
    const W = -leafSpread * scale * 0.88
    const rejoinHigh = pt(deg + 6, -0.4)
    cmds.push(`L ${fmt(rejoinHigh[0])} ${fmt(rejoinHigh[1])}`)

    const base = pt(deg, -0.4)
    const c3 = add(base, vec(deg, L * 0.70, W * 0.25))
    const tip = add(base, vec(deg, L * 1.02, W * 0.82))
    const c2 = add(base, vec(deg, L * 0.66, W * 1.04))
    const c1 = add(base, vec(deg, L * 0.18, W * 0.90))
    cmds.push(`C ${fmt(c3[0])} ${fmt(c3[1])} ${fmt(tip[0])} ${fmt(tip[1])} ${fmt(tip[0])} ${fmt(tip[1])}`)
    cmds.push(`C ${fmt(c2[0])} ${fmt(c2[1])} ${fmt(c1[0])} ${fmt(c1[1])} ${fmt(base[0])} ${fmt(base[1])}`)
  }

  return cmds.join(' ')
}

/** Build the single-stroke Fluid Ribbon 5-Pointed Star (1B-②: 流光弧线一笔星). */
function buildFluidUnicursalStarPath() {
  const cx = 60
  const cy = 51.5
  const R = 20
  const v = Array.from({ length: 5 }, (_, k): [number, number] => {
    const a = ((-90 + k * 72) * Math.PI) / 180
    return [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  })
  const order = [0, 2, 4, 1, 3, 0]
  const segs = [`M ${fmt(v[0][0])} ${fmt(v[0][1])}`]
  for (let i = 0; i < 5; i++) {
    const pA = v[order[i]]
    const pB = v[order[i + 1]]
    const mx = (pA[0] + pB[0]) * 0.5
    const my = (pA[1] + pB[1]) * 0.5
    const qx = mx + (cx - mx) * 0.32
    const qy = my + (cy - my) * 0.32
    segs.push(`Q ${fmt(qx)} ${fmt(qy)} ${fmt(pB[0])} ${fmt(pB[1])}`)
  }
  return segs.join(' ') + ' Z'
}

export const NOAH_ARK_OLIVE_WREATH_PATH =
  `M 60 99 C 44 99 31 92 24 80 ${buildBranchSubpath(1)} ` +
  `C 34 86 46 90 60 90 C 74 90 86 86 96 80 ${buildBranchSubpath(-1)} ` +
  `C 89 92 76 99 60 99 Z`

export const FLUID_UNICURSAL_STAR_PATH = buildFluidUnicursalStarPath()

export default function BrandMark({
  alt = 'NoahVision',
  size = 40,
  themeOverride,
}: {
  alt?: string
  size?: number
  themeOverride?: 'light' | 'dark'
}) {
  const { resolvedTheme } = useThemePreference()
  const theme = themeOverride ?? resolvedTheme
  const isLight = theme === 'light'
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
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="120" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isLight ? '#ffffff' : '#0f1830'} />
          <stop offset="100%" stopColor={isLight ? '#e4effd' : '#091b29'} />
        </linearGradient>
        <linearGradient id={`${uid}-stroke`} x1="14" y1="98" x2="106" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isLight ? '#1e3a8a' : '#60a5fa'} />
          <stop offset="50%" stopColor={isLight ? '#2563eb' : '#ffffff'} />
          <stop offset="100%" stopColor={isLight ? '#0d9488' : '#5eead4'} />
        </linearGradient>
        <linearGradient id={`${uid}-fill`} x1="16" y1="20" x2="104" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isLight ? '#2563eb' : '#7dd3fc'} stopOpacity={isLight ? '0.24' : '0.28'} />
          <stop offset="100%" stopColor={isLight ? '#0d9488' : '#38bdf8'} stopOpacity={isLight ? '0.14' : '0.16'} />
        </linearGradient>
        <linearGradient id={`${uid}-star`} x1="42" y1="30" x2="78" y2="70" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={isLight ? '#1e3a8a' : '#ffffff'} />
          <stop offset="55%" stopColor={isLight ? '#2563eb' : '#7dd3fc'} />
          <stop offset="100%" stopColor={isLight ? '#0d9488' : '#5eead4'} />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill={`url(#${uid}-bg)`} />
      <rect
        x="1.5"
        y="1.5"
        width="117"
        height="117"
        rx="26.5"
        stroke={isLight ? 'rgba(37, 99, 235, 0.22)' : 'rgba(125, 211, 252, 0.28)'}
        strokeWidth="3"
      />
      <path
        d={NOAH_ARK_OLIVE_WREATH_PATH}
        fill={`url(#${uid}-fill)`}
        stroke={`url(#${uid}-stroke)`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={FLUID_UNICURSAL_STAR_PATH}
        fill={`url(#${uid}-fill)`}
        stroke={`url(#${uid}-star)`}
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
