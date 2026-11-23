import { useEffect, useRef } from 'react'
import './living-background.css'

/*
 * Interactive 2D shallow-water surface + high-density regular bioluminescent particle lattice + soft optical veil.
 *
 * Physics:
 * - Isotropic 8-neighbour 2D wave equation solver on a fine Float32 heightfield (h0, h1) at 60 fps.
 * - Delicate fingertip Kelvin wakes (radius 8–15 px) and fine water-droplet ripples (radius 10 px).
 * - ~2,000–2,400 glowing micro-particles arranged in a precision optical lattice floating on the water:
 *   at rest they undulate gently with the water surface; as the cursor glides across, particles along the
 *   path part symmetrically to the left and right banks and flare with bioluminescent light, carving a
 *   crystal-clear, persistent trajectory channel through the matrix before smoothly flowing back into formation.
 */

export const STIR_EVENT = 'aig:stir'
export type StirDetail = {
  x: number
  y: number
  vx: number
  vy: number
  rect?: { x: number; y: number; width: number; height: number }
}

/** Push the water surface, particle lattice and underlying colour fluid at a viewport point or window hull. */
export function stirBackground(detail: StirDetail) {
  window.dispatchEvent(new CustomEvent<StirDetail>(STIR_EVENT, { detail }))
}

type RGB = [number, number, number]
type Palette = {
  base: [RGB, RGB, RGB]
  blobs: RGB[]
  alphas: number[]
  cursor: RGB
  cursorAlpha: number
  causticTint: RGB
  focusColor: RGB
  specColor: RGB
  filmCrest: RGB
  filmTrough: RGB
  filmCaustic: RGB
  filmStrength: number
}

const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    base: [[226, 236, 251], [233, 240, 249], [229, 243, 244]],
    blobs: [[112, 160, 252], [106, 206, 228], [186, 208, 252], [174, 230, 222], [168, 154, 248], [122, 188, 252]],
    alphas: [0.88, 0.82, 0.85, 0.85, 0.40, 0.48],
    cursor: [238, 246, 255],
    cursorAlpha: 0.14,
    causticTint: [225, 240, 255],
    focusColor: [160, 214, 252],
    specColor: [248, 252, 255],
    filmCrest: [255, 255, 255],
    filmTrough: [38, 96, 196],
    filmCaustic: [90, 174, 250],
    filmStrength: 0.56,
  },
  dark: {
    base: [[9, 15, 29], [8, 12, 23], [8, 17, 22]],
    blobs: [[34, 86, 202], [16, 114, 140], [30, 52, 106], [12, 84, 94], [82, 56, 182], [24, 110, 206]],
    alphas: [0.86, 0.82, 0.85, 0.80, 0.42, 0.40],
    cursor: [80, 138, 238],
    cursorAlpha: 0.22,
    causticTint: [62, 146, 214],
    focusColor: [78, 176, 240],
    specColor: [184, 222, 255],
    filmCrest: [196, 228, 255],
    filmTrough: [6, 16, 36],
    filmCaustic: [72, 176, 244],
    filmStrength: 0.62,
  },
}

const blobs = [
  { ax: -0.02, ay: 0.02, rx: 0.10, ry: 0.12, sx: 0.071, sy: 0.053, phase: 0.0, size: 0.62 },
  { ax: 0.02, ay: 0.84, rx: 0.08, ry: 0.10, sx: 0.059, sy: 0.081, phase: 1.7, size: 0.50 },
  { ax: 1.00, ay: -0.04, rx: 0.10, ry: 0.08, sx: 0.047, sy: 0.067, phase: 3.1, size: 0.55 },
  { ax: 0.96, ay: 1.04, rx: 0.12, ry: 0.08, sx: 0.063, sy: 0.049, phase: 4.6, size: 0.60 },
  { ax: 0.50, ay: 0.45, rx: 0.32, ry: 0.26, sx: 0.037, sy: 0.043, phase: 2.2, size: 0.42 },
  { ax: 0.62, ay: 0.70, rx: 0.26, ry: 0.20, sx: 0.051, sy: 0.029, phase: 5.3, size: 0.34 },
].map(blob => ({ ...blob, ox: 0, oy: 0, vx: 0, vy: 0 }))

type LatticeParticle = {
  /** Regular lattice home coordinate in viewport px */
  hx: number
  hy: number
  /** Displacement from lattice home caused by finger wake / water wave */
  ox: number
  oy: number
  /** Current velocity in px/s */
  vx: number
  vy: number
  /** Spatial phase for gentle wave breathing */
  phase: number
  /** Sprite colour variant (0: resting/cyan, 1: azure, 2: active wake highlight) */
  variant: number
  /** Wake luminescence flare (0..1), decays slowly so the mouse trail stays clearly visible */
  flare: number
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v)
const themeOf = () => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

function clonePalette(p: Palette): Palette {
  return {
    base: p.base.map(c => [...c]) as Palette['base'],
    blobs: p.blobs.map(c => [...c] as RGB),
    alphas: [...p.alphas],
    cursor: [...p.cursor],
    cursorAlpha: p.cursorAlpha,
    causticTint: [...p.causticTint],
    focusColor: [...p.focusColor],
    specColor: [...p.specColor],
    filmCrest: [...p.filmCrest],
    filmTrough: [...p.filmTrough],
    filmCaustic: [...p.filmCaustic],
    filmStrength: p.filmStrength,
  }
}

function approach(current: Palette, target: Palette, t: number) {
  const lerpRGB = (a: RGB, b: RGB) => { for (let i = 0; i < 3; i++) a[i] = mix(a[i], b[i], t) }
  current.base.forEach((c, i) => lerpRGB(c, target.base[i]))
  current.blobs.forEach((c, i) => lerpRGB(c, target.blobs[i]))
  current.alphas.forEach((a, i) => { current.alphas[i] = mix(a, target.alphas[i], t) })
  lerpRGB(current.cursor, target.cursor)
  current.cursorAlpha = mix(current.cursorAlpha, target.cursorAlpha, t)
  lerpRGB(current.causticTint, target.causticTint)
  lerpRGB(current.focusColor, target.focusColor)
  lerpRGB(current.specColor, target.specColor)
  lerpRGB(current.filmCrest, target.filmCrest)
  lerpRGB(current.filmTrough, target.filmTrough)
  lerpRGB(current.filmCaustic, target.filmCaustic)
  current.filmStrength = mix(current.filmStrength, target.filmStrength, t)
}

/** Pre-render glowing particle sprites per theme (0 & 1: crisp lattice dots, 2: bright wake-crest flare sprite). */
function buildParticleSprites(theme: 'light' | 'dark'): HTMLCanvasElement[] {
  const specs =
    theme === 'dark'
      ? [
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(155, 238, 255, 0.95)', mid: 'rgba(64, 198, 255, 0.62)', outer: 'rgba(28, 136, 248, 0)' },
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(175, 215, 255, 0.95)', mid: 'rgba(104, 166, 255, 0.60)', outer: 'rgba(58, 112, 240, 0)' },
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(220, 252, 255, 1)', mid: 'rgba(88, 236, 255, 0.92)', outer: 'rgba(36, 168, 255, 0)' },
        ]
      : [
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(32, 112, 232, 0.92)', mid: 'rgba(42, 136, 242, 0.52)', outer: 'rgba(42, 136, 242, 0)' },
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(14, 148, 196, 0.90)', mid: 'rgba(22, 168, 212, 0.50)', outer: 'rgba(22, 168, 212, 0)' },
          { pin: 'rgba(255, 255, 255, 1)', core: 'rgba(18, 96, 236, 1)', mid: 'rgba(32, 144, 255, 0.85)', outer: 'rgba(32, 144, 255, 0)' },
        ]

  return specs.map(({ pin, core, mid, outer }) => {
    const size = 48
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    if (!ctx) return c
    const half = size / 2
    const g = ctx.createRadialGradient(half, half, 0, half, half, half)
    g.addColorStop(0, pin)
    g.addColorStop(0.16, core)
    g.addColorStop(0.36, core)
    g.addColorStop(0.62, mid)
    g.addColorStop(1, outer)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, size, size)
    return c
  })
}

const VERT_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const BASE_FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_wave;
uniform vec2 u_texel;
uniform float u_aspect;
uniform float u_time;
uniform vec2 u_pointer;
uniform float u_lensRadius;
uniform float u_lensPower;
uniform vec3 u_base0;
uniform vec3 u_base1;
uniform vec3 u_base2;
uniform vec4 u_blobs[6];
uniform vec3 u_blobColors[6];
uniform vec4 u_cursor;
uniform vec3 u_causticTint;
uniform vec3 u_focusColor;
uniform vec3 u_specColor;
uniform float u_isDark;

vec4 sampleWave(vec2 uv) {
  vec4 c = texture2D(u_wave, uv) * 0.40;
  c += texture2D(u_wave, uv + vec2(u_texel.x, 0.0)) * 0.15;
  c += texture2D(u_wave, uv - vec2(u_texel.x, 0.0)) * 0.15;
  c += texture2D(u_wave, uv + vec2(0.0, u_texel.y)) * 0.15;
  c += texture2D(u_wave, uv - vec2(0.0, u_texel.y)) * 0.15;
  return (c - 128.0 / 255.0) * 2.0;
}

vec3 evalField(vec2 uv) {
  float diag = clamp((uv.x + uv.y) * 0.5, 0.0, 1.0);
  vec3 col = diag < 0.6
    ? mix(u_base0, u_base1, diag / 0.6)
    : mix(u_base1, u_base2, (diag - 0.6) / 0.4);

  vec2 metric = vec2(u_aspect, 1.0);
  float longEdge = max(u_aspect, 1.0);
  for (int i = 0; i < 6; i++) {
    vec4 b = u_blobs[i];
    float d = length((uv - b.xy) * metric) / (b.z * longEdge);
    if (d < 1.0) {
      float falloff = smoothstep(1.0, 0.0, d);
      float a = b.w * falloff * falloff;
      col = mix(col, u_blobColors[i], a);
    }
  }

  vec2 p = uv * metric * 7.5;
  float c1 = sin(p.x * 1.35 + u_time * 0.42 + sin(p.y * 1.45 - u_time * 0.32));
  float c2 = cos(p.y * 1.50 - u_time * 0.38 + sin(p.x * 1.25 + u_time * 0.28));
  float net = pow(max(0.0, 1.0 - abs(c1 + c2) * 0.54), 3.4);
  col = mix(col, u_causticTint, net * (u_isDark > 0.5 ? 0.045 : 0.052));
  return col;
}

void main() {
  vec4 w = sampleWave(v_uv);
  vec2 n = w.xy;
  float h = w.z;
  float lap = w.w;
  float slope = length(n);
  n *= smoothstep(0.004, 0.026, slope);

  vec3 normal = normalize(vec3(n.x * 2.4, n.y * 2.4, 1.0));
  vec2 shift = normal.xy * 0.028;

  // Convex optical magnifying glass refraction synced to the particle loupe.
  vec2 metric = vec2(u_aspect, 1.0);
  vec2 lensVec = v_uv - u_pointer;
  float lensU = length(lensVec * metric) / max(0.001, u_lensRadius);
  vec2 lensShift = vec2(0.0);
  float lensRim = 0.0;
  float lensDomeGlow = 0.0;
  if (u_lensPower > 0.001 && lensU < 1.0) {
    float oneMinusU2 = 1.0 - lensU * lensU;
    float dome = oneMinusU2 * oneMinusU2;
    lensShift = -lensVec * (0.24 * u_lensPower * dome);
    lensRim = smoothstep(0.74, 0.96, lensU) * (1.0 - smoothstep(0.96, 1.0, lensU)) * u_lensPower;
    lensDomeGlow = (1.0 - lensU * lensU) * u_lensPower * u_cursor.w * 0.45;
  }

  float r = evalField(v_uv + shift * 0.88 + lensShift * 0.93).r;
  float g = evalField(v_uv + shift * 1.00 + lensShift * 1.00).g;
  float b = evalField(v_uv + shift * 1.12 + lensShift * 1.07).b;
  vec3 col = vec3(r, g, b);

  col += h * (u_isDark > 0.5 ? vec3(0.018, 0.04, 0.07) : vec3(-0.02, 0.005, 0.03));
  float focus = clamp(pow(max(0.0, -lap), 1.2) * 0.28, 0.0, 0.24);
  col = mix(col, u_focusColor, focus);

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(-0.46, -0.62, 0.63));
  vec3 L2 = normalize(vec3(0.54, 0.38, 0.75));
  float spec1 = pow(max(0.0, dot(normal, normalize(L1 + V))), 60.0);
  float spec2 = pow(max(0.0, dot(normal, normalize(L2 + V))), 24.0);
  float fresnel = pow(1.0 - normal.z, 2.0);
  float specMix = clamp(spec1 * 0.42 + spec2 * 0.14 + fresnel * 0.12, 0.0, 0.34);
  col = mix(col, u_specColor, specMix);

  if (lensRim > 0.001 || lensDomeGlow > 0.001) {
    col = mix(col, u_cursor.rgb, clamp(lensDomeGlow, 0.0, 0.12));
    col = mix(col, u_specColor, clamp(lensRim * (u_isDark > 0.5 ? 0.20 : 0.28), 0.0, 0.32));
  }

  gl_FragColor = vec4(col, 1.0);
}
`

const FILM_FRAG_SRC = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_wave;
uniform vec2 u_texel;
uniform vec3 u_crestColor;
uniform vec3 u_troughColor;
uniform vec3 u_causticColor;
uniform float u_strength;

vec4 sampleWave(vec2 uv) {
  vec4 c = texture2D(u_wave, uv) * 0.36;
  c += texture2D(u_wave, uv + vec2(u_texel.x, 0.0)) * 0.16;
  c += texture2D(u_wave, uv - vec2(u_texel.x, 0.0)) * 0.16;
  c += texture2D(u_wave, uv + vec2(0.0, u_texel.y)) * 0.16;
  c += texture2D(u_wave, uv - vec2(0.0, u_texel.y)) * 0.16;
  return (c - 128.0 / 255.0) * 2.0;
}

void main() {
  vec4 w = sampleWave(v_uv);
  vec2 n = w.xy;
  float lap = w.w;
  float slope = length(n);
  float mask = smoothstep(0.010, 0.046, slope);
  if (mask <= 0.001) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 consoleCenter = (v_uv - vec2(0.57, 0.53)) / vec2(0.41, 0.44);
  float consoleCalm = mix(0.35, 1.0, smoothstep(0.25, 1.05, length(consoleCenter)));
  float weight = mask * u_strength * consoleCalm;

  vec3 normal = normalize(vec3(n.x * 2.8, n.y * 2.8, 1.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L1 = normalize(vec3(-0.46, -0.62, 0.63));
  vec3 L2 = normalize(vec3(0.54, 0.38, 0.75));

  float directional = dot(normal.xy, vec2(-0.56, -0.82));
  float crest = max(0.0, directional);
  float trough = max(0.0, -directional);

  float spec1 = pow(max(0.0, dot(normal, normalize(L1 + V))), 48.0);
  float spec2 = pow(max(0.0, dot(normal, normalize(L2 + V))), 20.0);
  float focus = pow(max(0.0, -lap), 1.2);

  float aCrest = clamp((crest * 0.14 + spec1 * 0.38 + spec2 * 0.12) * weight, 0.0, 0.20);
  float aTrough = clamp(trough * 0.12 * weight, 0.0, 0.10);
  float aCaustic = clamp(focus * 0.20 * weight, 0.0, 0.13);

  vec3 premul = u_crestColor * aCrest + u_causticColor * aCaustic + u_troughColor * aTrough;
  float alpha = clamp(aCrest + aCaustic + aTrough, 0.0, 0.24);
  gl_FragColor = vec4(premul, alpha);
}
`

type GLRenderer = {
  gl: WebGLRenderingContext
  program: WebGLProgram
  texture: WebGLTexture
  uniforms: Record<string, WebGLUniformLocation | null>
}

function createGLRenderer(canvas: HTMLCanvasElement, fragSrc: string, alpha: boolean, uniformNames: string[]): GLRenderer | null {
  const gl = canvas.getContext('webgl', { alpha, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
  if (!gl) return null

  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type)
    if (!shader) return null
    gl.shaderSource(shader, src)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader)
      return null
    }
    return shader
  }

  const vs = compile(gl.VERTEX_SHADER, VERT_SRC)
  const fs = compile(gl.FRAGMENT_SHADER, fragSrc)
  if (!vs || !fs) return null

  const program = gl.createProgram()
  if (!program) return null
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  gl.useProgram(program)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const posLoc = gl.getAttribLocation(program, 'a_pos')
  gl.enableVertexAttribArray(posLoc)
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

  const texture = gl.createTexture()
  if (!texture) return null
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

  const uniforms: Record<string, WebGLUniformLocation | null> = {}
  for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name)

  return { gl, program, texture, uniforms }
}

function isOverConsoleContent(target: EventTarget | null) {
  if (!(target instanceof Element)) return false
  return Boolean(
    target.closest(
      '.panel, .table-wrap, .metric-card, .camera-feed, .assist-list, .module-drawer, .admin-drawer, button, input, select, textarea, a',
    ),
  )
}

export default function LivingBackground() {
  const baseRef = useRef<HTMLCanvasElement>(null)
  const filmRef = useRef<HTMLCanvasElement>(null)
  const particleRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const baseCanvas = baseRef.current
    const filmCanvas = filmRef.current
    const particleCanvas = particleRef.current
    if (!baseCanvas || !filmCanvas || !particleCanvas) return

    const root = document.documentElement
    root.dataset.livingBg = ''
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const palette = clonePalette(palettes[themeOf()])

    const baseGL = createGLRenderer(baseCanvas, BASE_FRAG_SRC, false, [
      'u_wave', 'u_texel', 'u_aspect', 'u_time', 'u_pointer', 'u_lensRadius', 'u_lensPower',
      'u_base0', 'u_base1', 'u_base2', 'u_blobs[0]', 'u_blobColors[0]',
      'u_cursor', 'u_causticTint', 'u_focusColor', 'u_specColor', 'u_isDark',
    ])
    const filmGL = createGLRenderer(filmCanvas, FILM_FRAG_SRC, true, [
      'u_wave', 'u_texel', 'u_crestColor', 'u_troughColor', 'u_causticColor', 'u_strength',
    ])
    const fallbackCtx = !baseGL ? baseCanvas.getContext('2d', { alpha: false }) : null
    const particleCtx = particleCanvas.getContext('2d')

    const sprites = {
      light: buildParticleSprites('light'),
      dark: buildParticleSprites('dark'),
    }

    // 2D shallow-water heightfield buffers.
    let gw = 0
    let gh = 0
    let cellPx = 3
    let h0 = new Float32Array(0)
    let h1 = new Float32Array(0)
    let waveTex = new Uint8Array(0)
    let waveEnergy = 0
    let particleDpr = 1
    let particles: LatticeParticle[] = []
    let latticeSize = ''

    const LENS_RADIUS = 114
    const LENS_RADIUS_2 = LENS_RADIUS * LENS_RADIUS
    let lensPower = 0
    let lensClickBoost = 0
    let pointerOverContent = false

    let frame = 0
    let last = 0
    let clock = 0
    let nextDropAt = 2.4
    let pointerFrame = 0
    const pointer = {
      x: innerWidth * 0.35,
      y: innerHeight * 0.35,
      tx: innerWidth * 0.35,
      ty: innerHeight * 0.35,
      prevX: innerWidth * 0.35,
      prevY: innerHeight * 0.35,
      lastT: 0,
      seen: false,
      inside: false,
    }
    let lastStirWake = 0

    /** Build a dense, neatly aligned orthogonal lattice of ~2,000–2,400 glowing particles across the viewport. */
    function initParticles() {
      const spacing = clamp(Math.round(Math.sqrt((innerWidth * innerHeight) / 2150)), 22, 28)
      const cols = Math.ceil(innerWidth / spacing) + 1
      const rows = Math.ceil(innerHeight / spacing) + 1
      const key = `${cols}x${rows}@${spacing}`
      if (key === latticeSize) return
      latticeSize = key

      const offsetX = (innerWidth - (cols - 1) * spacing) * 0.5
      const offsetY = (innerHeight - (rows - 1) * spacing) * 0.5
      const next: LatticeParticle[] = []

      for (let r = 0; r < rows; r++) {
        const hy = offsetY + r * spacing
        for (let c = 0; c < cols; c++) {
          const hx = offsetX + c * spacing
          next.push({
            hx,
            hy,
            ox: 0,
            oy: 0,
            vx: 0,
            vy: 0,
            phase: c * 0.32 + r * 0.41,
            variant: (r + c) & 1,
            flare: 0,
          })
        }
      }
      particles = next
    }

    function allocateGrid() {
      cellPx = Math.max(3, Math.ceil(Math.sqrt((innerWidth * innerHeight) / 115000)))
      gw = Math.max(48, Math.ceil(innerWidth / cellPx))
      gh = Math.max(48, Math.ceil(innerHeight / cellPx))
      const count = gw * gh
      h0 = new Float32Array(count)
      h1 = new Float32Array(count)
      waveTex = new Uint8Array(count * 4)
      waveTex.fill(128)
      for (const renderer of [baseGL, filmGL]) {
        if (!renderer) continue
        const { gl, texture } = renderer
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gw, gh, 0, gl.RGBA, gl.UNSIGNED_BYTE, waveTex)
      }
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      particleDpr = dpr
      const w = Math.max(64, Math.round(innerWidth * dpr))
      const h = Math.max(64, Math.round(innerHeight * dpr))
      if (baseGL) {
        baseCanvas!.width = w
        baseCanvas!.height = h
        baseGL.gl.viewport(0, 0, w, h)
      } else {
        baseCanvas!.width = Math.max(32, Math.ceil(innerWidth / 8))
        baseCanvas!.height = Math.max(32, Math.ceil(innerHeight / 8))
      }
      if (filmGL) {
        filmCanvas!.width = w
        filmCanvas!.height = h
        filmGL.gl.viewport(0, 0, w, h)
      }
      particleCanvas!.width = w
      particleCanvas!.height = h
      allocateGrid()
      initParticles()
      if (!motion.matches) dropWater(innerWidth * 0.52, innerHeight * 0.46, 11, 0.42)
      render()
    }

    /** Stamp a delicate directional fingertip wake at viewport (px, py). */
    function stampWake(px: number, py: number, radiusPx: number, strength: number, ux: number, uy: number) {
      const cx = px / cellPx
      const cy = py / cellPx
      const r = Math.max(1.8, radiusPx / cellPx)
      const r2 = r * r
      const x0 = Math.max(2, Math.floor(cx - r))
      const x1 = Math.min(gw - 3, Math.ceil(cx + r))
      const y0 = Math.max(2, Math.floor(cy - r))
      const y1 = Math.min(gh - 3, Math.ceil(cy + r))

      for (let y = y0; y <= y1; y++) {
        const dy = y - cy
        const row = y * gw
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx
          const u = (dx * dx + dy * dy) / r2
          if (u >= 1) continue
          const bell = (1 - u) * (1 - u)
          const dir = (dx * ux + dy * uy) / r
          const delta = strength * bell * (dir * 0.62 - 0.38)
          const idx = row + x
          h0[idx] = clamp(h0[idx] + delta, -1.8, 1.8)
        }
      }
      waveEnergy = 1
    }

    /** Stamp a fine radially symmetric water droplet impact. */
    function dropWater(px: number, py: number, radiusPx: number, strength: number) {
      const cx = px / cellPx
      const cy = py / cellPx
      const r = Math.max(2.0, radiusPx / cellPx)
      const r2 = r * r
      const x0 = Math.max(2, Math.floor(cx - r))
      const x1 = Math.min(gw - 3, Math.ceil(cx + r))
      const y0 = Math.max(2, Math.floor(cy - r))
      const y1 = Math.min(gh - 3, Math.ceil(cy + r))

      for (let y = y0; y <= y1; y++) {
        const dy = y - cy
        const row = y * gw
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx
          const u = (dx * dx + dy * dy) / r2
          if (u >= 1) continue
          const bell = (1 - u) * (1 - u)
          const ring = 1 - 2.35 * u
          const idx = row + x
          h0[idx] = clamp(h0[idx] - strength * bell * ring, -1.8, 1.8)
        }
      }
      waveEnergy = 1
    }

    // Stiff underwater lily-pad stems: firmly rooted, tiny cohesive slipstream yield (max 2.0px), zero parting gap.
    const STEM_MAX_OFFSET = 2.0
    const clampStemOffset = (p: LatticeParticle) => {
      const r2 = p.ox * p.ox + p.oy * p.oy
      if (r2 > STEM_MAX_OFFSET * STEM_MAX_OFFSET) {
        const s = STEM_MAX_OFFSET / Math.sqrt(r2)
        p.ox *= s
        p.oy *= s
      }
    }

    /**
     * Brush stiff-stemmed lattice particles along (x0, y0) -> (x1, y1) with pure tangential drag.
     * Zero radial/lateral parting ensures the cursor never carves a blank gap through the lattice.
     */
    function partParticlesAlongSegment(x0: number, y0: number, x1: number, y1: number, dtMs: number, scale = 1) {
      const sdx = x1 - x0
      const sdy = y1 - y0
      const segLen2 = sdx * sdx + sdy * sdy
      const segLen = Math.sqrt(segLen2)
      if (segLen < 0.4) return
      const speed = clamp(segLen / Math.max(4, dtMs), 0, 3.2) // px/ms
      const ux = sdx / segLen
      const uy = sdy / segLen
      const reach = clamp(32 + speed * 8, 32, 48)
      const reach2 = reach * reach
      const sigma = reach * 0.48
      const invTwoSigma2 = 1 / (2 * sigma * sigma)
      const impulseBase = (18 + speed * 18) * scale
      const frameScale = Math.min(1, dtMs / 16) * scale

      const boxMinX = Math.min(x0, x1) - reach
      const boxMaxX = Math.max(x0, x1) + reach
      const boxMinY = Math.min(y0, y1) - reach
      const boxMaxY = Math.max(y0, y1) + reach

      for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i]
        const px = p.hx + p.ox
        const py = p.hy + p.oy
        if (px < boxMinX || px > boxMaxX || py < boxMinY || py > boxMaxY) continue

        const tProj = clamp(((px - x0) * sdx + (py - y0) * sdy) / segLen2, 0, 1)
        const cx = x0 + sdx * tProj
        const cy = y0 + sdy * tProj
        const dx = px - cx
        const dy = py - cy
        const d2 = dx * dx + dy * dy
        if (d2 >= reach2) continue

        // Smooth Gaussian slipstream: nearby particles lean slightly together along cursor motion (no void).
        const falloff = Math.exp(-d2 * invTwoSigma2)
        const curDist = Math.hypot(p.ox, p.oy)
        const stemYield = clamp(1 - curDist / STEM_MAX_OFFSET, 0.08, 1)

        const directShift = falloff * (0.14 + speed * 0.08) * frameScale * stemYield
        p.ox += ux * directShift
        p.oy += uy * directShift
        clampStemOffset(p)

        const push = impulseBase * falloff * stemYield
        p.vx += ux * push
        p.vy += uy * push
        p.flare = Math.min(1, p.flare + falloff * (0.34 + speed * 0.14) * scale)
      }
    }

    /** Trace a fine fingertip wake and gently brush the stiff-stemmed particle lattice. */
    function traceFingerSegment(x0: number, y0: number, x1: number, y1: number, dtMs: number, scale: number) {
      const dx = x1 - x0
      const dy = y1 - y0
      const dist = Math.hypot(dx, dy)
      if (dist < 0.5) return
      const speed = dist / Math.max(4, dtMs)
      const ux = dx / dist
      const uy = dy / dist
      const radiusPx = clamp(8 + speed * 2.2, 8, 15)
      const stepPx = Math.max(2.5, radiusPx * 0.4)
      const steps = Math.min(36, Math.max(1, Math.ceil(dist / stepPx)))
      const perStepStrength = clamp(((0.15 + speed * 0.22) * scale) / Math.sqrt(steps), 0.04, 0.38)

      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        stampWake(x0 + dx * t, y0 + dy * t, radiusPx, perStepStrength, ux, uy)
      }
      partParticlesAlongSegment(x0, y0, x1, y1, dtMs, scale)
    }

    function stepWaveSubstep() {
      const w = gw
      const h = gh
      // Higher viscosity damping for thicker, heavier liquid ripples.
      const damping = 0.968
      for (let y = 1; y < h - 1; y++) {
        const row = y * w
        for (let x = 1; x < w - 1; x++) {
          const i = row + x
          const avg =
            (h0[i - 1] + h0[i + 1] + h0[i - w] + h0[i + w]) * 0.20 +
            (h0[i - w - 1] + h0[i - w + 1] + h0[i + w - 1] + h0[i + w + 1]) * 0.05
          h1[i] = (0.22 * h0[i] + 1.78 * avg - h1[i]) * damping
        }
      }
      const swap = h0
      h0 = h1
      h1 = swap
    }

    function packWaveTexture() {
      const w = gw
      const h = gh
      let maxAbs = 0
      for (let y = 1; y < h - 1; y++) {
        const row = y * w
        for (let x = 1; x < w - 1; x++) {
          const i = row + x
          const val = h0[i]
          const absVal = val < 0 ? -val : val
          if (absVal > maxAbs) maxAbs = absVal
          const nx = (h0[i + 1] - h0[i - 1]) * 0.5
          const ny = (h0[i + w] - h0[i - w]) * 0.5
          const lap = (h0[i - 1] + h0[i + 1] + h0[i - w] + h0[i + w]) * 0.25 - val
          const p = i * 4
          waveTex[p] = clamp((128 + nx * 175) | 0, 0, 255)
          waveTex[p + 1] = clamp((128 + ny * 175) | 0, 0, 255)
          waveTex[p + 2] = clamp((128 + val * 88) | 0, 0, 255)
          waveTex[p + 3] = clamp((128 + lap * 220) | 0, 0, 255)
        }
      }
      waveEnergy = maxAbs > 0.0015 ? maxAbs : 0
    }

    function stepParticles(dt: number) {
      // Stiff underwater stem + viscous honey damping: firmly anchored (zeta ~ 1.29, zero wobble, zero gap).
      const pdt = Math.min(dt, 0.032)
      const drag = Math.exp(-20 * pdt)
      const springK = 60
      const hoverR = 34
      const hoverR2 = hoverR * hoverR
      const hasWaves = waveEnergy > 0.016
      const ptx = pointer.tx
      const pty = pointer.ty
      const pSeen = pointer.seen
      const flareDecay = Math.exp(-2.8 * pdt)

      for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i]
        const px = p.hx + p.ox
        const py = p.hy + p.oy

        // 1. Subtle luminous awareness under the cursor tip — zero outward push so no blank circle forms.
        if (pSeen) {
          const dx = px - ptx
          const dy = py - pty
          if (dx > -hoverR && dx < hoverR && dy > -hoverR && dy < hoverR) {
            const d2 = dx * dx + dy * dy
            if (d2 < hoverR2) {
              const f = 1 - Math.sqrt(d2) / hoverR
              p.flare = Math.min(1, p.flare + f * f * 0.42 * pdt)
            }
          }
        }

        // 2. Stiff stems resist passing ripples — only strong wave crests cause a barely-perceptible shimmer.
        if (hasWaves) {
          const gx = clamp((px / cellPx) | 0, 1, gw - 2)
          const gy = clamp((py / cellPx) | 0, 1, gh - 2)
          const idx = gy * gw + gx
          const nx = (h0[idx + 1] - h0[idx - 1]) * 0.5
          const ny = (h0[idx + gw] - h0[idx - gw]) * 0.5
          if (nx > 0.018 || nx < -0.018 || ny > 0.018 || ny < -0.018) {
            p.vx += nx * 8 * pdt
            p.vy += ny * 8 * pdt
            const crest = (nx < 0 ? -nx : nx) + (ny < 0 ? -ny : ny)
            if (crest > 0.06) p.flare = Math.min(1, p.flare + crest * 0.10)
          }
        }

        // 3. Firm overdamped stem restoration back to (hx, hy), radially capped at 2.0px.
        p.vx = (p.vx - springK * p.ox * pdt) * drag
        p.vy = (p.vy - springK * p.oy * pdt) * drag
        p.ox += p.vx * pdt
        p.oy += p.vy * pdt
        clampStemOffset(p)
        p.flare *= flareDecay
      }
    }

    function step(dt: number) {
      const still = motion.matches
      if (!still) {
        clock += dt
        if (clock >= nextDropAt) {
          nextDropAt = clock + 2.8 + Math.random() * 2.4
          if (waveEnergy < 0.12) {
            dropWater(
              (0.12 + Math.random() * 0.76) * innerWidth,
              (0.14 + Math.random() * 0.72) * innerHeight,
              9 + Math.random() * 4,
              0.24 + Math.random() * 0.14,
            )
          }
        }
        if (waveEnergy > 0) {
          // Single slower substep per frame gives thicker, more viscous wave propagation.
          stepWaveSubstep()
          packWaveTexture()
        }
        stepParticles(dt)
      }

      for (const blob of blobs) {
        const k = 9
        const c = 3.2
        blob.vx += (-k * blob.ox - c * blob.vx) * dt
        blob.vy += (-k * blob.oy - c * blob.vy) * dt
        const limit = Math.max(innerWidth, innerHeight) * 0.28
        blob.ox = clamp(blob.ox + blob.vx * dt, -limit, limit)
        blob.oy = clamp(blob.oy + blob.vy * dt, -limit, limit)
      }
      const follow = still ? 1 : 1 - Math.exp(-dt * 18)
      pointer.x = mix(pointer.x, pointer.tx, follow)
      pointer.y = mix(pointer.y, pointer.ty, follow)
      const lensTarget = pointer.inside ? (pointerOverContent ? 0.82 : 1.0) : 0
      const lensEase = still ? 1 : 1 - Math.exp(-dt * 11)
      lensPower = mix(lensPower, lensTarget, lensEase)
      if (lensPower < 0.002 && lensTarget === 0) lensPower = 0
      lensClickBoost *= still ? 0 : Math.exp(-dt * 6.5)
      if (lensClickBoost < 0.002) lensClickBoost = 0
      approach(palette, palettes[themeOf()], 1 - Math.exp(-dt * 5))
    }

    function renderParticles() {
      const ctx = particleCtx
      if (!ctx) return
      const w = particleCanvas!.width
      const h = particleCanvas!.height
      ctx.clearRect(0, 0, w, h)
      if (root.dataset.glass === 'off') return

      const currentTheme = themeOf()
      const themeSprites = sprites[currentTheme]
      const dpr = particleDpr
      // Stiff-stemmed optical lattice with interactive convex magnifying-glass loupe at the cursor.
      const restAlpha = currentTheme === 'dark' ? 0.72 : 0.70
      const restRadius = 3.5 * dpr
      const effectiveLens = lensPower * (1 + lensClickBoost)
      const hasLens = effectiveLens > 0.005
      const lx0 = pointer.x
      const ly0 = pointer.y

      for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i]
        const waveX = Math.sin(clock * 0.45 + p.phase) * 0.16
        const waveY = Math.cos(clock * 0.40 + p.phase * 1.1) * 0.16
        let drawX = p.hx + p.ox + waveX
        let drawY = p.hy + p.oy + waveY
        let lensMag = 0
        let lensFocus = 0

        if (hasLens) {
          const dx = drawX - lx0
          const dy = drawY - ly0
          if (dx > -LENS_RADIUS && dx < LENS_RADIUS && dy > -LENS_RADIUS && dy < LENS_RADIUS) {
            const d2 = dx * dx + dy * dy
            if (d2 < LENS_RADIUS_2) {
              const oneMinusU2 = 1 - d2 / LENS_RADIUS_2
              const dome = oneMinusU2 * oneMinusU2
              // True convex magnification: 0 shift at lens center (zero blank hole), smooth radial expansion inside.
              const magShift = 0.28 * effectiveLens * dome
              drawX += dx * magShift
              drawY += dy * magShift
              lensMag = Math.pow(oneMinusU2, 1.35) * effectiveLens
              lensFocus = Math.pow(oneMinusU2, 1.1) * effectiveLens
            }
          }
        }

        const x = drawX * dpr
        const y = drawY * dpr
        const flare = p.flare
        const breath = 0.93 + 0.07 * Math.sin(clock * 1.1 + p.phase)
        const alpha = clamp(restAlpha * breath + lensFocus * 0.26 + flare * 0.20, 0.16, 0.98)
        const radius = restRadius * (1 + 0.95 * lensMag) + flare * 0.45 * dpr
        const sprite = lensFocus > 0.42 || flare > 0.32 ? themeSprites[2] : themeSprites[p.variant]

        ctx.globalAlpha = alpha
        ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2)
      }

      // Frameless optical glass loupe dome & specular rim over the magnified dots.
      if (lensPower > 0.015) {
        const cx = lx0 * dpr
        const cy = ly0 * dpr
        const r = LENS_RADIUS * (1 + lensClickBoost * 0.06) * dpr
        const isDark = currentTheme === 'dark'

        ctx.save()
        ctx.globalAlpha = lensPower

        // 1. Subtle spherical Fresnel edge sheen (clear center so magnified dots stay razor-sharp).
        const domeGrad = ctx.createRadialGradient(cx, cy, r * 0.08, cx, cy, r)
        if (isDark) {
          domeGrad.addColorStop(0, 'rgba(180, 232, 255, 0)')
          domeGrad.addColorStop(0.68, 'rgba(130, 206, 255, 0.025)')
          domeGrad.addColorStop(0.90, 'rgba(148, 224, 255, 0.11)')
          domeGrad.addColorStop(0.985, 'rgba(214, 244, 255, 0.22)')
          domeGrad.addColorStop(1, 'rgba(148, 224, 255, 0)')
        } else {
          domeGrad.addColorStop(0, 'rgba(255, 255, 255, 0)')
          domeGrad.addColorStop(0.68, 'rgba(255, 255, 255, 0.04)')
          domeGrad.addColorStop(0.90, 'rgba(255, 255, 255, 0.26)')
          domeGrad.addColorStop(0.985, 'rgba(92, 162, 246, 0.20)')
          domeGrad.addColorStop(1, 'rgba(92, 162, 246, 0)')
        }
        ctx.fillStyle = domeGrad
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()

        // 2. Curved top-left glass specular reflection inside the convex lens dome.
        ctx.beginPath()
        ctx.arc(cx, cy, r - 0.6 * dpr, 0, Math.PI * 2)
        ctx.clip()
        const specX = cx - r * 0.34
        const specY = cy - r * 0.36
        const specGrad = ctx.createRadialGradient(specX, specY, 0, specX, specY, r * 0.68)
        specGrad.addColorStop(0, isDark ? 'rgba(225, 246, 255, 0.14)' : 'rgba(255, 255, 255, 0.34)')
        specGrad.addColorStop(0.45, isDark ? 'rgba(155, 222, 255, 0.04)' : 'rgba(255, 255, 255, 0.09)')
        specGrad.addColorStop(1, 'rgba(255, 255, 255, 0)')
        ctx.fillStyle = specGrad
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
        ctx.restore()

        // 3. Crisp hairline optical glass bezel rim.
        ctx.save()
        ctx.globalAlpha = lensPower
        const rimGrad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r)
        if (isDark) {
          rimGrad.addColorStop(0, 'rgba(232, 248, 255, 0.42)')
          rimGrad.addColorStop(0.45, 'rgba(116, 206, 255, 0.16)')
          rimGrad.addColorStop(1, 'rgba(166, 228, 255, 0.30)')
        } else {
          rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.72)')
          rimGrad.addColorStop(0.45, 'rgba(98, 164, 242, 0.22)')
          rimGrad.addColorStop(1, 'rgba(54, 124, 228, 0.30)')
        }
        ctx.strokeStyle = rimGrad
        ctx.lineWidth = 1.25 * dpr
        ctx.beginPath()
        ctx.arc(cx, cy, r - 0.8 * dpr, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }

      ctx.globalAlpha = 1
    }

    function renderFallback() {
      const ctx = fallbackCtx
      if (!ctx) return
      const width = baseCanvas!.width
      const height = baseCanvas!.height
      const long = Math.max(width, height)
      const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r | 0},${g | 0},${b | 0},${a})`
      const base = ctx.createLinearGradient(0, 0, width, height)
      base.addColorStop(0, rgba(palette.base[0], 1))
      base.addColorStop(0.6, rgba(palette.base[1], 1))
      base.addColorStop(1, rgba(palette.base[2], 1))
      ctx.fillStyle = base
      ctx.fillRect(0, 0, width, height)
      blobs.forEach((blob, index) => {
        const x = (blob.ax + blob.rx * Math.sin(clock * blob.sx + blob.phase)) * width + blob.ox / 8
        const y = (blob.ay + blob.ry * Math.cos(clock * blob.sy + blob.phase * 1.3)) * height + blob.oy / 8
        const radius = blob.size * long * (1 + 0.06 * Math.sin(clock * 0.21 + blob.phase))
        const color = palette.blobs[index]
        const alpha = palette.alphas[index]
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
        gradient.addColorStop(0, rgba(color, alpha))
        gradient.addColorStop(0.55, rgba(color, alpha * 0.38))
        gradient.addColorStop(1, rgba(color, 0))
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, width, height)
      })
    }

    const blobUniforms = new Float32Array(24)
    const blobColorUniforms = new Float32Array(18)

    function render() {
      if (!baseGL) {
        renderFallback()
        renderParticles()
        return
      }

      // 1. Base underwater + refracted caustic wallpaper
      {
        const { gl, program, texture, uniforms } = baseGL
        gl.useProgram(program)
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        if (waveEnergy > 0) {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, waveTex)
        }
        gl.uniform1i(uniforms.u_wave, 0)
        gl.uniform2f(uniforms.u_texel, 1 / gw, 1 / gh)
        gl.uniform1f(uniforms.u_aspect, innerWidth / Math.max(1, innerHeight))
        gl.uniform1f(uniforms.u_time, clock)
        gl.uniform2f(
          uniforms.u_pointer,
          pointer.seen ? pointer.x / Math.max(1, innerWidth) : -2,
          pointer.seen ? pointer.y / Math.max(1, innerHeight) : -2,
        )
        gl.uniform1f(uniforms.u_lensRadius, (LENS_RADIUS * (1 + lensClickBoost * 0.06)) / Math.max(1, innerHeight))
        gl.uniform1f(uniforms.u_lensPower, root.dataset.glass === 'off' ? 0 : lensPower * (1 + lensClickBoost))
        gl.uniform3f(uniforms.u_base0, palette.base[0][0] / 255, palette.base[0][1] / 255, palette.base[0][2] / 255)
        gl.uniform3f(uniforms.u_base1, palette.base[1][0] / 255, palette.base[1][1] / 255, palette.base[1][2] / 255)
        gl.uniform3f(uniforms.u_base2, palette.base[2][0] / 255, palette.base[2][1] / 255, palette.base[2][2] / 255)

        for (let i = 0; i < 6; i++) {
          const blob = blobs[i]
          const x = blob.ax + blob.rx * Math.sin(clock * blob.sx + blob.phase) + blob.ox / Math.max(1, innerWidth)
          const y = blob.ay + blob.ry * Math.cos(clock * blob.sy + blob.phase * 1.3) + blob.oy / Math.max(1, innerHeight)
          const r = blob.size * (1 + 0.06 * Math.sin(clock * 0.21 + blob.phase))
          blobUniforms[i * 4] = x
          blobUniforms[i * 4 + 1] = y
          blobUniforms[i * 4 + 2] = r
          blobUniforms[i * 4 + 3] = palette.alphas[i]
          const c = palette.blobs[i]
          blobColorUniforms[i * 3] = c[0] / 255
          blobColorUniforms[i * 3 + 1] = c[1] / 255
          blobColorUniforms[i * 3 + 2] = c[2] / 255
        }
        gl.uniform4fv(uniforms['u_blobs[0]'], blobUniforms)
        gl.uniform3fv(uniforms['u_blobColors[0]'], blobColorUniforms)
        gl.uniform4f(
          uniforms.u_cursor,
          palette.cursor[0] / 255,
          palette.cursor[1] / 255,
          palette.cursor[2] / 255,
          pointer.seen ? palette.cursorAlpha : 0,
        )
        gl.uniform3f(uniforms.u_causticTint, palette.causticTint[0] / 255, palette.causticTint[1] / 255, palette.causticTint[2] / 255)
        gl.uniform3f(uniforms.u_focusColor, palette.focusColor[0] / 255, palette.focusColor[1] / 255, palette.focusColor[2] / 255)
        gl.uniform3f(uniforms.u_specColor, palette.specColor[0] / 255, palette.specColor[1] / 255, palette.specColor[2] / 255)
        gl.uniform1f(uniforms.u_isDark, themeOf() === 'dark' ? 1 : 0)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }

      // 2. Surface water-film overlay
      if (filmGL) {
        const { gl, program, texture, uniforms } = filmGL
        gl.useProgram(program)
        if (waveEnergy <= 0 || root.dataset.glass === 'off') {
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
        } else {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D, texture)
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gw, gh, gl.RGBA, gl.UNSIGNED_BYTE, waveTex)
          gl.uniform1i(uniforms.u_wave, 0)
          gl.uniform2f(uniforms.u_texel, 1 / gw, 1 / gh)
          gl.uniform3f(uniforms.u_crestColor, palette.filmCrest[0] / 255, palette.filmCrest[1] / 255, palette.filmCrest[2] / 255)
          gl.uniform3f(uniforms.u_troughColor, palette.filmTrough[0] / 255, palette.filmTrough[1] / 255, palette.filmTrough[2] / 255)
          gl.uniform3f(uniforms.u_causticColor, palette.filmCaustic[0] / 255, palette.filmCaustic[1] / 255, palette.filmCaustic[2] / 255)
          gl.uniform1f(uniforms.u_strength, palette.filmStrength)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        }
      }

      // 3. Regular bioluminescent water-surface particle lattice
      renderParticles()
    }

    function loop(now: number) {
      frame = requestAnimationFrame(loop)
      const interval = motion.matches ? 250 : 1000 / 60
      if (now - last < interval) return
      const dt = Math.min(0.06, (now - (last || now)) / 1000)
      last = now
      step(dt)
      render()
    }

    function onPointerMove(event: PointerEvent) {
      const now = event.timeStamp || performance.now()
      const wasInside = pointer.inside
      pointer.tx = event.clientX
      pointer.ty = event.clientY
      pointer.inside = true
      pointerOverContent = isOverConsoleContent(event.target)
      const scale = pointerOverContent ? 0.48 : 1.0
      if (!pointer.seen || (!wasInside && lensPower < 0.05)) {
        pointer.seen = true
        pointer.x = event.clientX
        pointer.y = event.clientY
        pointer.prevX = event.clientX
        pointer.prevY = event.clientY
        pointer.lastT = now
      } else if (!motion.matches) {
        const dtMs = Math.max(4, now - pointer.lastT)
        traceFingerSegment(pointer.prevX, pointer.prevY, event.clientX, event.clientY, dtMs, scale)
        pointer.prevX = event.clientX
        pointer.prevY = event.clientY
        pointer.lastT = now
      }
      if (pointerFrame) return
      pointerFrame = requestAnimationFrame(() => {
        pointerFrame = 0
        root.style.setProperty('--pointer-x', `${pointer.tx}px`)
        root.style.setProperty('--pointer-y', `${pointer.ty}px`)
      })
    }

    function onPointerLeave() {
      pointer.inside = false
    }

    function onPointerDown(event: PointerEvent) {
      if (motion.matches || !event.isPrimary) return
      pointer.tx = event.clientX
      pointer.ty = event.clientY
      pointer.inside = true
      pointerOverContent = isOverConsoleContent(event.target)
      if (!pointer.seen) {
        pointer.seen = true
        pointer.x = event.clientX
        pointer.y = event.clientY
      }
      pointer.prevX = event.clientX
      pointer.prevY = event.clientY
      pointer.lastT = event.timeStamp || performance.now()
      lensClickBoost = 0.22
      const scale = pointerOverContent ? 0.35 : 0.56
      dropWater(event.clientX, event.clientY, 10, scale)
      // Soft luminous pulse on tap — zero outward scatter so clicking never opens a blank hole.
      const reach = 36
      const cx = event.clientX
      const cy = event.clientY
      for (let i = 0, len = particles.length; i < len; i++) {
        const p = particles[i]
        const dx = p.hx + p.ox - cx
        const dy = p.hy + p.oy - cy
        if (dx < -reach || dx > reach || dy < -reach || dy > reach) continue
        const d = Math.hypot(dx, dy)
        if (d < reach) {
          const f = (1 - d / reach) * (1 - d / reach)
          p.flare = Math.min(1, p.flare + f * 0.45)
        }
      }
    }

    function onStir(event: Event) {
      if (motion.matches) return
      const { x, y, vx, vy, rect } = (event as CustomEvent<StirDetail>).detail
      const speed = Math.hypot(vx, vy)
      const now = performance.now()

      if (speed > 0.04 && now - lastStirWake > 14) {
        lastStirWake = now
        const ux = vx / speed
        const uy = vy / speed
        const strength = clamp(0.22 + speed * 0.30, 0.22, 0.62)
        stampWake(x, y, 14, strength, ux, uy)
        if (rect) {
          const leadX = ux >= 0 ? rect.x + rect.width : rect.x
          const leadY = uy >= 0 ? rect.y + rect.height : rect.y
          stampWake(leadX, rect.y + rect.height * 0.3, 12, strength * 0.55, ux, uy)
          stampWake(leadX, rect.y + rect.height * 0.7, 12, strength * 0.55, ux, uy)
          stampWake(rect.x + rect.width * 0.5, leadY, 12, strength * 0.5, ux, uy)
        }
        partParticlesAlongSegment(x - vx * 18, y - vy * 18, x, y, 18, 0.8)
      }

      const reach = Math.max(innerWidth, innerHeight) * 0.38
      for (const [index, blob] of blobs.entries()) {
        const bx = (blob.ax + blob.rx * Math.sin(clock * blob.sx + blob.phase)) * innerWidth + blob.ox
        const by = (blob.ay + blob.ry * Math.cos(clock * blob.sy + blob.phase * 1.3)) * innerHeight + blob.oy
        const influence = Math.exp(-((bx - x) ** 2 + (by - y) ** 2) / (2 * reach * reach))
        const carry = index >= 4 ? 0.82 : 0.5
        const grip = 0.16 * influence
        blob.vx += (vx * 1000 * carry * influence - blob.vx) * grip
        blob.vy += (vy * 1000 * carry * influence - blob.vy) * grip
      }
    }

    resize()
    frame = requestAnimationFrame(loop)
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    document.documentElement.addEventListener('pointerleave', onPointerLeave, { passive: true })
    window.addEventListener('blur', onPointerLeave)
    window.addEventListener(STIR_EVENT, onStir)
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(pointerFrame)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerdown', onPointerDown)
      document.documentElement.removeEventListener('pointerleave', onPointerLeave)
      window.removeEventListener('blur', onPointerLeave)
      window.removeEventListener(STIR_EVENT, onStir)
      delete root.dataset.livingBg
    }
  }, [])

  return (
    <div className="living-bg" aria-hidden="true">
      <canvas ref={baseRef} className="living-bg-base" />
      <div className="living-bg-veil" />
      <canvas ref={particleRef} className="living-particles" />
      <canvas ref={filmRef} className="living-water-film" />
    </div>
  )
}
