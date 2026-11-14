import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'

// <scene>
// ─── Tunables ────────────────────────────────────────────────────────────────
/** Fireflies flying through the grass around you (40–60 looks right). */
export const FIREFLY_COUNT = 56
/** Big out-of-focus fireflies very close to you. */
export const NEAR_GLOW_COUNT = 5
/** Seconds between shooting stars, min and max. Never two at once. */
export const SHOOTING_STAR_GAP_S: [number, number] = [12, 30]
/** Frame-rate cap for fireflies, blinks, twinkles and shooting stars. */
export const FPS_CAP = 30
/** Frame rate of the grass sway (a divisor of FPS_CAP: it's slow, and it's the biggest area to repaint). */
export const GRASS_FPS = 15
/** Overall brightness of fireflies, stars and moon: 0.5 dim … 1.5 bright. */
export const BRIGHTNESS = 1.0
/** The tall grass sways in the breeze. */
export const GRASS_SWAY = true
/** A few single leaves on the trees flutter now and then, as a breeze passes through. */
export const LEAF_RUSTLE = true
/** How many leaves flutter (each one only occasionally). */
export const FLUTTER_LEAVES = 12
/** Layers of tall grass between you and the meadow (3–8). */
export const GRASS_LAYERS = 6
/** How much the app's panels darken the scene behind text: 0 none … 1 opaque. */
export const PANEL_TINT = 0.36
/** Background stars, and how many of them twinkle. */
export const STAR_COUNT = 110
export const TWINKLE_COUNT = 14
/** The moon in the upper right. */
export const SHOW_MOON = true
/** Change for a different (but equally calm) arrangement. */
export const SEED = 7
// ─────────────────────────────────────────────────────────────────────────────

const W = 1600
const H = 1000
/** Eye level: you're standing in the grass, so the horizon sits a little below the middle. */
const HZ = 640

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()
const f2 = (n: number) => (Math.round(n * 100) / 100).toString()
const i0 = (n: number) => Math.round(n).toString()
const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Animation timing on one shared frame grid: duration and delay are whole
 * multiples of 1/fps (fps divides FPS_CAP) and every keyframe segment steps once
 * per frame, so every element changes on the same frames, at most FPS_CAP times
 * a second, and the frames in between repaint nothing.
 */
const gridTiming = (seconds: number, segments: number, phase01: number, fps = FPS_CAP) => {
  const perSeg = Math.max(1, Math.round((seconds / segments) * fps))
  const total = perSeg * segments
  const delay = Math.round(phase01 * total)
  return `${(total / fps).toFixed(4)}s steps(${perSeg}) ${(-delay / fps).toFixed(4)}s infinite`
}

/** Keyframes sampled from a 0..1 → declarations function, `segments` steps per loop. */
const sampled = (name: string, segments: number, prop: (u: number) => string) =>
  `@keyframes ${name}{${Array.from({ length: segments + 1 }, (_, k) => `${f2((k / segments) * 100)}%{${prop(k / segments)}}`).join('')}}`

/** A smooth line through points (Catmull-Rom as cubic Béziers). */
function smoothPath(pts: Array<[number, number]>): string {
  let d = `M${f1(pts[0]![0])} ${f1(pts[0]![1])}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]!
    const p1 = pts[i]!
    const p2 = pts[i + 1]!
    const p3 = pts[Math.min(pts.length - 1, i + 2)]!
    d += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`
  }
  return d
}

/** One tapered, curving grass blade, filled (whole units keep the file small). */
const blade = (x: number, y: number, h: number, lean: number, w: number) =>
  `M${i0(x - w)} ${i0(y)}Q${i0(x - w * 0.25 + lean * 0.35)} ${i0(y - h * 0.55)} ${i0(x + lean)} ${i0(y - h)}Q${i0(x + w * 0.25 + lean * 0.35)} ${i0(y - h * 0.55)} ${i0(x + w)} ${i0(y)}Z`

const mix = (a: string, b: string, t: number) => {
  const p = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The whole scene as one SVG document. Only SVG elements, animated by CSS
 * `transform` and `opacity` (the app's backdrop keeps no HTML inside the SVG).
 */
export function buildScene(): string {
  const r = rng(SEED)
  const css: string[] = []
  const B = BRIGHTNESS
  const rand = (a: number, b: number) => a + r() * (b - a)

  let defs = `
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="${HZ}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#151d48"/><stop offset=".5" stop-color="#252f68"/>
<stop offset=".85" stop-color="#383a70"/><stop offset="1" stop-color="#57507f"/>
</linearGradient>
<linearGradient id="ground" x1="0" y1="${HZ}" x2="0" y2="${H}" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="#2a4048"/><stop offset=".4" stop-color="#1f333c"/><stop offset="1" stop-color="#14242c"/>
</linearGradient>
<radialGradient id="glowband" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#6c5c98" stop-opacity=".55"/><stop offset="1" stop-color="#3b3358" stop-opacity="0"/></radialGradient>
<radialGradient id="mist" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#a49ed0" stop-opacity=".28"/><stop offset=".6" stop-color="#7a74a8" stop-opacity=".1"/><stop offset="1" stop-color="#7a74a8" stop-opacity="0"/></radialGradient>
<radialGradient id="veil" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#0b0e22" stop-opacity=".16"/><stop offset=".6" stop-color="#0b0e22" stop-opacity=".08"/><stop offset="1" stop-color="#0b0e22" stop-opacity="0"/></radialGradient>
<radialGradient id="sglow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#e8eeff" stop-opacity=".5"/><stop offset="1" stop-color="#e8eeff" stop-opacity="0"/></radialGradient>
<radialGradient id="gA" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffef0"/><stop offset=".07" stop-color="#f0fbb8"/><stop offset=".17" stop-color="#d8f58a" stop-opacity=".72"/><stop offset=".36" stop-color="#d8f58a" stop-opacity=".26"/><stop offset=".64" stop-color="#ffd27a" stop-opacity=".08"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<radialGradient id="gB" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff8e2"/><stop offset=".07" stop-color="#ffe7a8"/><stop offset=".17" stop-color="#ffd27a" stop-opacity=".7"/><stop offset=".36" stop-color="#ffd27a" stop-opacity=".24"/><stop offset=".64" stop-color="#d8f58a" stop-opacity=".07"/><stop offset="1" stop-color="#d8f58a" stop-opacity="0"/></radialGradient>
<radialGradient id="gN" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f0fbb8" stop-opacity=".9"/><stop offset=".3" stop-color="#d8f58a" stop-opacity=".55"/><stop offset=".6" stop-color="#ffd27a" stop-opacity=".2"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient>
<linearGradient id="tail" x1="-130" y1="0" x2="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#cfd8ff" stop-opacity="0"/><stop offset=".75" stop-color="#e8eeff" stop-opacity=".55"/><stop offset="1" stop-color="#ffffff"/></linearGradient>`

  let paint = `<rect width="${W}" height="${H}" fill="url(#sky)"/>
<ellipse cx="${W / 2}" cy="${HZ}" rx="1100" ry="190" fill="url(#glowband)"/>`

  // ── Moon: a soft-edged waxing gibbous with darker seas, faint earthshine and layered glow ──
  const moon = { x: 1000, y: 140, r: 44 }
  if (SHOW_MOON) {
    const { x, y, r: mr } = moon
    defs += `
<radialGradient id="halo" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f6eccc" stop-opacity="${f2(0.2 * B)}"/><stop offset=".3" stop-color="#d9d2ef" stop-opacity="${f2(0.08 * B)}"/><stop offset="1" stop-color="#b8b4e0" stop-opacity="0"/></radialGradient>
<radialGradient id="corona" cx=".5" cy=".5" r=".5"><stop offset=".42" stop-color="#fff6dc" stop-opacity="${f2(0.35 * B)}"/><stop offset=".6" stop-color="#f3e9cf" stop-opacity="${f2(0.12 * B)}"/><stop offset="1" stop-color="#f3e9cf" stop-opacity="0"/></radialGradient>
<radialGradient id="limb" cx=".42" cy=".4" r=".62"><stop offset="0" stop-color="#fffaf0"/><stop offset=".65" stop-color="#f1e8d2"/><stop offset="1" stop-color="#cfc5ad"/></radialGradient>
<radialGradient id="shade" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2a3162" stop-opacity=".86"/><stop offset=".62" stop-color="#2a3162" stop-opacity=".8"/><stop offset=".82" stop-color="#2a3162" stop-opacity=".35"/><stop offset="1" stop-color="#2a3162" stop-opacity="0"/></radialGradient>
<clipPath id="moonclip"><circle cx="${x}" cy="${y}" r="${mr}"/></clipPath>`
    let seas = ''
    for (const [dx, dy, rx, ry] of [[-14, -12, 13, 10], [-4, 4, 10, 8], [-20, 10, 8, 11], [6, -16, 7, 5], [-8, 20, 12, 6]] as const) {
      seas += `<ellipse cx="${x + dx}" cy="${y + dy}" rx="${rx}" ry="${ry}"/>`
    }
    paint += `
<circle cx="${x}" cy="${y}" r="280" fill="url(#halo)"/>
<circle cx="${x}" cy="${y}" r="${mr * 2.4}" fill="url(#corona)"/>
<g clip-path="url(#moonclip)" opacity="${f2(clamp01(0.96 * B))}"><circle cx="${x}" cy="${y}" r="${mr}" fill="url(#limb)"/><g fill="#a49d8c" opacity=".32">${seas}</g><circle cx="${x + mr * 1.55}" cy="${y - mr * 0.12}" r="${mr * 1.45}" fill="url(#shade)"/></g>`
  }

  // ── Stars, a few of them twinkling ──
  const tints = ['#ffffff', '#eef2ff', '#dfe7ff', '#d2ddff', '#fff7ea']
  let stars = ''
  let twinkles = ''
  let twinkled = 0
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = r() * W
    const y = Math.pow(r(), 1.6) * HZ * 0.82
    if (SHOW_MOON && Math.hypot(x - moon.x, y - moon.y) < 95) continue
    const s = r()
    const rad = s < 0.55 ? 0.7 : s < 0.82 ? 1.0 : s < 0.95 ? 1.4 : 1.9
    const op = clamp01((0.35 + r() * 0.55) * B * (1 - y / HZ) + 0.15)
    const fill = tints[Math.floor(r() * tints.length)]!
    const glow = rad >= 1.4 ? `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rad * 4)}" fill="url(#sglow)" opacity="${f2(op * 0.6)}"/>` : ''
    const dot = `${glow}<circle cx="${f1(x)}" cy="${f1(y)}" r="${rad}" fill="${fill}"/>`
    if (twinkled < TWINKLE_COUNT && rad >= 1.0 && x > 380 && x < 900 && y < 420 && r() < 0.6) {
      twinkles += `<g opacity="${f2(op)}"><g class="t${twinkled}">${dot}</g></g>`
      css.push(`.t${twinkled}{animation:tw ${gridTiming(4 + r() * 4, 8, r())}}`)
      twinkled++
      continue
    }
    stars += `<g opacity="${f2(op)}">${dot}</g>`
  }
  css.push(sampled('tw', 8, u => `opacity:${f2(0.62 + 0.38 * Math.cos(u * Math.PI * 2))}`))
  paint += `<g>${stars}</g>`

  // ── Shooting stars: one fixed, irregular schedule, so never two at once ──
  const [gMin, gMax] = SHOOTING_STAR_GAP_S
  const COUNT = 7
  const gaps = Array.from({ length: COUNT }, () => rand(gMin, gMax))
  const cycle = gaps.reduce((a, b) => a + b, 0)
  let shoot = ''
  let t = 5
  for (let k = 0; k < COUNT; k++) {
    const dur = rand(0.6, 1.0)
    const goRight = r() < 0.5
    const x = goRight ? rand(300, 620) : rand(620, 900)
    const y = rand(40, 260)
    const ang = (goRight ? 1 : -1) * rand(18, 34) + (goRight ? 0 : 180)
    const travel = rand(190, 290)
    const a = (t / cycle) * 100
    const p = ((t + dur * 0.22) / cycle) * 100
    const b = ((t + dur) / cycle) * 100
    css.push(`@keyframes s${k}{0%,${f2(a)}%{opacity:0;transform:translate(0px,0px) scale(.35,1);animation-timing-function:cubic-bezier(.2,.55,.35,1)}${f2(p)}%{opacity:${f2(clamp01(0.95 * B))}}${f2(b)}%,100%{opacity:0;transform:translate(${f1(travel)}px,0px) scale(1,1)}}`)
    css.push(`.s${k}{opacity:0;animation:s${k} ${f2(cycle)}s linear infinite}`)
    shoot += `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang)})"><g class="s${k} ss"><path d="M-130 0L0 -1.7L2 0L0 1.7Z" fill="url(#tail)"/></g></g>`
    t += gaps[k]!
  }
  paint += `<g>${twinkles}</g><g>${shoot}</g>`

  // ── Distant woods along the horizon: rows of soft rounded crowns, hazed by mist ──
  const crowns = (y: number, r0: number, r1: number, step: number, fill: string) => {
    let c = ''
    for (let x = -40; x <= W + 40; x += step * rand(0.6, 1.2)) {
      const rr = rand(r0, r1) * (0.75 + 0.35 * Math.sin(x / 190 + y))
      c += `<circle cx="${i0(x)}" cy="${i0(y - rr * 0.55 + rand(-3, 3))}" r="${i0(rr)}"/>`
    }
    return `<g fill="${fill}">${c}<rect x="-60" y="${y}" width="${W + 120}" height="40"/></g>`
  }
  paint += crowns(HZ - 4, 10, 30, 22, '#2b3756')
  paint += crowns(HZ + 4, 8, 20, 16, '#25324a')
  paint += `<ellipse cx="${W / 2}" cy="${HZ - 4}" rx="1150" ry="56" fill="url(#mist)"/>`

  // ── The meadow floor and its far grass ──
  {
    const pts: Array<[number, number]> = []
    for (let x = -60; x <= W + 60; x += 80) pts.push([x, HZ + 6 + 7 * Math.sin(x / 300 + 1.3) + 4 * Math.sin(x / 117)])
    paint += `<path d="${smoothPath(pts)}L${W + 60} ${H + 20}L-60 ${H + 20}Z" fill="url(#ground)"/>`
  }
  const band = (count: number, y0: number, y1: number, h0: number, h1: number, w: number, fill: string) => {
    let d = ''
    for (let i = 0; i < count; i++) {
      const y = rand(y0, y1)
      const tt = (y - y0) / (y1 - y0)
      const h = (h0 + (h1 - h0) * tt) * rand(0.6, 1.25)
      d += blade(rand(-20, W + 20), y, h, rand(-0.35, 0.35) * h, w * (0.7 + tt * 0.6))
    }
    return `<path d="${d}" fill="${fill}"/>`
  }
  paint += band(160, HZ + 8, HZ + 100, 6, 20, 1.1, '#34505a')
  paint += band(120, HZ + 90, HZ + 220, 18, 56, 2.0, '#2b444e')

  // ── Trees, grown branch by branch: a tapering trunk that forks again and again, with
  // small clusters of leaves along the outer twigs, sky showing through the gaps, and
  // moonlight on the side that faces the moon. ──
  // Leaf sprays: four shapes drawn once, each a few twigs fanning out from the centre,
  // with pointed oval leaves on short stalks alternating along them and one at each tip.
  // The leaves facing the moon (upper right) catch a little of its light.
  const leafPath = (bx: number, by: number, a: number, len: number, wid: number) => {
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    const px = -dy
    const py = dx
    const sx = bx + dx * len * 0.12 // a short stalk before the blade
    const sy = by + dy * len * 0.12
    const tx = bx + dx * len
    const ty = by + dy * len
    const mx = bx + dx * len * 0.5
    const my = by + dy * len * 0.5
    return `M${f2(bx)} ${f2(by)}L${f2(sx)} ${f2(sy)}Q${f2(mx + px * wid)} ${f2(my + py * wid)} ${f2(tx)} ${f2(ty)}Q${f2(mx - px * wid)} ${f2(my - py * wid)} ${f2(sx)} ${f2(sy)}Z`
  }
  for (let k = 0; k < 4; k++) {
    let leavesD = ''
    let litD = ''
    let twigs = ''
    // A dense heart so the spray reads as foliage, not a few loose leaves.
    let core = `<ellipse rx=".42" ry=".32" cy=".05"/>`
    const nTwigs = 4 + Math.floor(r() * 2)
    for (let t = 0; t < nTwigs; t++) {
      const ta = -Math.PI / 2 + (t / (nTwigs - 1) - 0.5) * 3.4 + rand(-0.25, 0.25)
      const tl = rand(0.6, 0.85)
      const ex = Math.cos(ta) * tl
      const ey = Math.sin(ta) * tl
      twigs += `M0 .1L${f2(ex)} ${f2(ey)}`
      const nLeaves = 4 + Math.floor(r() * 2)
      for (let i = 0; i < nLeaves; i++) {
        const at = 0.3 + (i / nLeaves) * 0.7
        const bx = Math.cos(ta) * tl * at
        const by = 0.1 + (Math.sin(ta) * tl - 0.1) * at
        const side = i % 2 ? 1 : -1
        const la = ta + side * rand(0.55, 1.05) + 0.25 // leaves droop a little
        const leaf = leafPath(bx, by, la, rand(0.26, 0.36), rand(0.085, 0.12))
        if (Math.cos(la) > 0.1 && Math.sin(la) < 0.2 && r() < 0.45) litD += leaf
        else leavesD += leaf
      }
      const tip = leafPath(ex, ey, ta + rand(-0.2, 0.2), rand(0.28, 0.36), rand(0.09, 0.12))
      leavesD += tip
    }
    if (r() < 0.5) core += `<ellipse rx=".3" ry=".24" cx="${f2(rand(-0.2, 0.2))}" cy="-.15"/>`
    defs += `<symbol id="lf${k}" viewBox="-1 -1 2 2" overflow="visible">${core}<path d="${twigs}" fill="none" stroke="#132131" stroke-width=".035"/><path d="${leavesD}"/><path d="${litD}" fill="#3e5f86" fill-opacity=".55"/></symbol>`
  }
  // Places on the outer edge of each crown where a single leaf can flutter (recorded while
  // the trees grow; picking among them draws on its own random sequence, so the flutter
  // leaves the rest of the scene exactly as it was).
  const edgeSpots: Array<[number, number, number, string]> = []
  const tree = (x0: number, y0: number, trunkLen: number, trunkW: number, depth: number, spread: number, leaf: number, dark: string, lit: string) => {
    const wood: string[] = []
    const widths: number[] = []
    let flare = ''
    let leaves = ''
    let lights = ''
    // Leaf clusters are four shapes drawn once (see leafShapes), placed at each twig.
    const cluster = (cx: number, cy: number, size: number) => {
      const s2 = size * rand(0.85, 1.2)
      leaves += `<use href="#lf${Math.floor(r() * 4)}" x="${i0(cx - s2)}" y="${i0(cy - s2)}" width="${i0(s2 * 2)}" height="${i0(s2 * 2)}"/>`
      if (size >= leaf) edgeSpots.push([cx, cy, s2, dark])
    }
    const branch = (x: number, y: number, ang: number, len: number, w: number, d: number) => {
      const bend = rand(-0.18, 0.18)
      const x2 = x + Math.cos(ang) * len
      const y2 = y + Math.sin(ang) * len
      const mx = x + Math.cos(ang + bend) * len * 0.5
      const my = y + Math.sin(ang + bend) * len * 0.5
      const w2 = w * 0.62
      // One stroked path per branching level, each a little thinner: a tapering silhouette.
      wood[d] = (wood[d] ?? '') + `M${i0(x)} ${i0(y)}Q${i0(mx)} ${i0(my)} ${i0(x2)} ${i0(y2)}`
      widths[d] = w * 1.6
      if (d <= 3) cluster(x2, y2, leaf * (d === 0 ? 1 : d === 1 ? 0.95 : d === 2 ? 0.85 : 0.7))
      if (d === 0) return
      const n = r() < 0.15 ? 3 : 2
      for (let k = 0; k < n; k++) {
        const off = n === 1 ? 0 : (k / (n - 1) - 0.5) * spread * 2
        // Branches lean up and out; gravity pulls the long outer ones down a little.
        const a2 = Math.max(-Math.PI + 0.3, Math.min(-0.3, ang + off + rand(-0.22, 0.22)))
        branch(x2, y2, a2, len * rand(0.66, 0.8), w2, d - 1)
      }
    }
    // Root flare, then the trunk.
    flare = `M${i0(x0 - trunkW * 2.2)} ${i0(y0 + 4)}Q${i0(x0 - trunkW)} ${i0(y0 - 6)} ${i0(x0 - trunkW)} ${i0(y0 - trunkW * 2)}L${i0(x0 + trunkW)} ${i0(y0 - trunkW * 2)}Q${i0(x0 + trunkW)} ${i0(y0 - 6)} ${i0(x0 + trunkW * 2.2)} ${i0(y0 + 4)}Z`
    branch(x0, y0, -Math.PI / 2 + rand(-0.05, 0.05), trunkLen, trunkW, depth)
    const strokes = wood.map((d, i) => (d ? `<path d="${d}" stroke-width="${f1(widths[i]!)}"/>` : '')).join('')
    return `<path d="${flare}" fill="${dark}"/><g fill="none" stroke="${dark}" stroke-linecap="round">${strokes}</g><g fill="${dark}">${leaves}</g><g fill="${lit}" opacity=".2">${lights}</g>`
  }
  paint += tree(200, HZ + 26, 130, 10, 4, 0.4, 50, '#1a2a3c', '#3d5b7e')
  paint += tree(1480, HZ + 110, 165, 22, 5, 0.46, 82, '#142233', '#38587e')

  // ── A breeze through the trees: a few single leaves on the crowns' edges. Each hangs
  // still for most of its 8–16 s cycle, then wavers briefly and settles, on its own time. ──
  if (LEAF_RUSTLE && edgeSpots.length > 0) {
    const rr = rng(SEED + 101)
    const rrand = (a: number, b: number) => a + rr() * (b - a)
    let flutter = ''
    const picked = new Set<number>()
    for (let k = 0; k < Math.min(FLUTTER_LEAVES, edgeSpots.length); k++) {
      let j = Math.floor(rr() * edgeSpots.length)
      while (picked.has(j)) j = (j + 1) % edgeSpots.length
      picked.add(j)
      const [cx, cy, sz, dark] = edgeSpots[j]!
      // Out on the upper edge of the spray, pointing away from it.
      const a = rrand(-Math.PI * 0.9, -Math.PI * 0.1)
      const lx = cx + Math.cos(a) * sz * 0.78
      const ly = cy + Math.sin(a) * sz * 0.78
      const L = sz * rrand(0.3, 0.38)
      const w = L * 0.34
      const stalk = L * 0.14
      flutter += `<g transform="translate(${i0(lx)} ${i0(ly)}) rotate(${i0((a * 180) / Math.PI + 90)})"><path class="w${k}" d="M0 0L0 ${f1(-stalk)}Q${f1(w)} ${f1(-L / 2)} 0 ${f1(-L)}Q${f1(-w)} ${f1(-L / 2)} 0 ${f1(-stalk)}Z" fill="${dark}"/></g>`
      // A brief waver that dies away: a few swings over ~1.2 s, then stillness.
      const cycle = Math.round(rrand(8, 16) * FPS_CAP) / FPS_CAP
      const amp = rrand(9, 16)
      const swings = [0, 1, -0.7, 0.45, -0.22, 0.08, 0]
      const stepS = 0.2
      const kf = swings.map((v, i) => `${f2(((i * stepS) / cycle) * 100)}%{transform:rotate(${f1(v * amp)}deg);animation-timing-function:steps(${Math.round(stepS * FPS_CAP)})}`).join('')
      css.push(`@keyframes w${k}{${kf}100%{transform:rotate(0deg)}}`)
      css.push(`.w${k}{animation:w${k} ${cycle.toFixed(4)}s linear ${(-Math.round(rr() * cycle * FPS_CAP) / FPS_CAP).toFixed(4)}s infinite}`)
    }
    paint += flutter
  }

  // ── Fireflies (defined here; placed between the grass layers below) ──
  const KF = 16
  const PK = 16
  const blinks = [
    (u: number) => 0.12 + 0.88 * Math.pow(0.5 + 0.5 * Math.cos(u * Math.PI * 2), 2), // slow glow, deep fade
    (u: number) => 0.02 + 0.98 * Math.pow(0.5 + 0.5 * Math.cos(u * Math.PI * 2), 4), // dark, then a soft flash
    (u: number) => 0.06 + 0.94 * Math.pow(Math.abs(Math.cos(u * Math.PI * 2)), 6) * (u < 0.5 ? 1 : 0.6), // double flash
  ]
  blinks.forEach((fn, v) => css.push(sampled(`p${v}`, PK, u => `opacity:${f2(fn(u))}`)))
  // 18 looping flight paths in three sizes (far, middle, near), shared: each firefly also
  // has its own place, speed and phase, so no two fly alike.
  const PATHS = 6
  ;[
    [90, 45],
    [170, 80],
    [260, 120],
  ].forEach(([ax, ay], size) => {
    for (let j = 0; j < PATHS; j++) {
      const ph = Array.from({ length: 6 }, () => r() * Math.PI * 2)
      const sx = ax! * rand(0.8, 1.2)
      const sy = ay! * rand(0.8, 1.2)
      css.push(sampled(`m${size}${j}`, KF, u => {
        const a = u * Math.PI * 2
        const dx = sx * (0.6 * Math.sin(a + ph[0]!) + 0.3 * Math.sin(2 * a + ph[1]!) + 0.18 * Math.sin(3 * a + ph[2]!))
        const dy = sy * (0.55 * Math.sin(a + ph[3]!) + 0.35 * Math.sin(2 * a + ph[4]!) + 0.2 * Math.sin(4 * a + ph[5]!))
        return `transform:translate(${i0(dx)}px,${i0(dy)}px)`
      }))
    }
  })
  const fly = (i: number, size: number, cx: number, cy: number, rad: number, alpha: number, loop: number, blinkS: number, variant: number, grad: string) => {
    css.push(`.f${i}{animation:m${size}${Math.floor(r() * PATHS)} ${gridTiming(loop, KF, r())}}`)
    css.push(`.f${i} circle{animation:p${variant} ${gridTiming(blinkS, PK, r())}}`)
    return `<g transform="translate(${i0(cx)} ${i0(cy)})" opacity="${f2(clamp01(alpha))}"><g class="f${i}"><circle r="${i0(rad)}" fill="url(#${grad})"/></g></g>`
  }
  const NL = Math.max(1, GRASS_LAYERS)
  const groups: Array<Array<[number, string]>> = Array.from({ length: NL + 1 }, () => [])
  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const depth = r() // 0 far … 1 near
    const cx = rand(-30, W + 30)
    const cy = rand(HZ - 280, H - 60) * (0.7 + 0.3 * depth) + (HZ - 140) * (0.3 - 0.3 * depth)
    const html = fly(i, depth < 0.35 ? 0 : depth < 0.7 ? 1 : 2, cx, cy, 18 + 44 * depth, (0.8 + 0.2 * depth) * B, rand(24, 44), rand(2, 5), Math.floor(r() * blinks.length), r() < 0.6 ? 'gA' : 'gB')
    groups[Math.min(NL, Math.floor(depth * (NL + 1)))]!.push([depth, html])
  }
  for (let k = 0; k < NEAR_GLOW_COUNT; k++) {
    const left = k % 2 === 0
    groups[NL]!.push([2, fly(FIREFLY_COUNT + k, 2, left ? rand(-40, 420) : rand(1180, W + 40), rand(HZ - 60, H - 60), rand(55, 85), rand(0.28, 0.42) * B, rand(40, 60), rand(3.5, 6), 0, 'gN')])
  }
  const order = (list: Array<[number, string]>) => list.sort((a, b) => a[0] - b[0]).map(f => f[1]).join('')

  // ── Tall grass all around you, layer upon layer, nearer layers taller and darker ──
  // Each layer is a row of overlapping tiles. A tile's blades are drawn once as a
  // <symbol> and placed (sometimes mirrored) by <use>. Every tile sways, skewing from
  // its base, a little behind its left neighbour, so a slow breeze rolls across.
  const TW = 440
  let field = order(groups[0]!)
  for (let li = 0; li < NL; li++) {
    const d = NL === 1 ? 1 : li / (NL - 1) // 0 farthest … 1 nearest
    const tall = Math.round(250 + 230 * d)
    const base = Math.round(H - 70 + 82 * d)
    const n = Math.round(46 - 16 * d)
    const w0 = 2 + 3.5 * d
    const body = mix('#3a5a60', '#10242a', d)
    const lit = mix('#5e837a', '#2a4a42', d)
    for (const v of ['a', 'b']) {
      let bodyD = ''
      let litD = ''
      let seeds = ''
      for (let i = 0; i < n; i++) {
        const bx = rand(10, TW - 10)
        const h = tall * rand(0.28, 1) * (r() < 0.12 ? 1.15 : 1)
        const bl = blade(bx, tall + 6, h, rand(-0.3, 0.3) * h, rand(w0, w0 * 1.9))
        if (r() < 0.22) litD += bl
        else bodyD += bl
      }
      for (let i = 0; i < 3; i++) {
        const bx = rand(30, TW - 30)
        const h = tall * rand(0.7, 1.02)
        const lean = rand(-0.18, 0.18) * h
        const tx = bx + lean
        const ty = tall + 6 - h
        seeds += `M${i0(bx)} ${tall + 6}Q${i0(bx + lean * 0.3)} ${i0(tall + 6 - h * 0.6)} ${i0(tx)} ${i0(ty)}`
        for (let k = 0; k < 5; k++) seeds += `M${i0(tx)} ${i0(ty + k * 10)}l${k % 2 ? 4 : -4} -6`
      }
      let flowers = ''
      for (let i = 0; i < 2; i++) flowers += `<circle cx="${i0(rand(20, TW - 20))}" cy="${i0(tall + 6 - tall * rand(0.45, 0.8))}" r="${f1(rand(2.5, 4))}"/>`
      defs += `<symbol id="g${li}${v}" viewBox="0 0 ${TW} ${tall + 10}" overflow="visible"><path d="${bodyD}" fill="${body}"/><path d="${litD}" fill="${lit}"/><path d="${seeds}" fill="none" stroke="${body}" stroke-width="1.5" stroke-linecap="round"/><g fill="#b9b2dc" opacity=".5">${flowers}</g></symbol>`
    }
    const sway = 1.0 + 1.8 * d
    const period = 10 - 3.5 * d
    if (GRASS_SWAY) css.push(sampled(`sw${li}`, 12, u => `transform:skewX(${f2(sway * Math.sin(u * Math.PI * 2) - sway * 0.25)}deg)`))
    const shift = rand(0, 380)
    for (let k = 0; k < 5; k++) {
      const cx = -150 + k * 380 + shift - 190 + TW / 2 + rand(-30, 30)
      const mirror = (k + li) % 3 === 1 ? ` transform="matrix(-1 0 0 1 0 0)"` : ''
      field += `<g transform="translate(${i0(cx)} ${base})"><g class="c${li}${k}"><use href="#g${li}${(k + li) % 2 ? 'b' : 'a'}" x="${-TW / 2}" y="${-(tall + 6)}" width="${TW}" height="${tall + 10}"${mirror}/></g></g>`
      // A gust travels left to right: each tile's phase trails the one before it.
      if (GRASS_SWAY) css.push(`.c${li}${k}{animation:sw${li} ${gridTiming(period, 12, (1 - ((k * 0.13 + li * 0.07) % 1)) % 1, GRASS_FPS)}}`)
    }
    field += order(groups[li + 1]!)
  }

  css.push(
    // Every animated element transforms around its own local origin.
    `[class^=f],[class^=c],.ss{transform-box:view-box;transform-origin:0 0}`,
    // A fluttering leaf turns on its stalk.
    `[class^=w]{transform-box:view-box;transform-origin:0 0}`,
    `@media (prefers-reduced-motion:reduce){[class^=f],[class^=c],[class^=t],[class^=w]{animation:none!important}.ss{display:none}[class^=f] circle{animation-duration:6s!important;animation-timing-function:ease-in-out!important}}`,
  )

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice">
<defs>${defs}</defs>
<style>${css.join('\n')}</style>
${paint}
<ellipse cx="${W / 2}" cy="${H * 0.45}" rx="${W * 0.36}" ry="${H * 0.42}" fill="url(#veil)"/>
${field}
</svg>`
}
// </scene>

export const SCENE_NAME = 'firefly-meadow'

// Night palette taken from the scene.
const { theme, problems } = makeColors({
  label: 'Firefly Meadow',
  only: 'dark',
  roles: { accent: '#ffd27a', success: '#9fd8a0', danger: '#f2a0b0', warning: '#f0bc82', pro: '#b8a8ee' },
  dark: {
    gray: {
      anchors: {
        'surface-0': '#121631',
        'surface-1': '#171b3a',
        'surface-2': '#1c2042',
        'surface-3': '#20254a',
        'text-primary': '#ece8f5',
        'text-secondary': '#c6c2dc',
        'text-muted': '#9a98b8',
      },
    },
  },
})

const LOOK: ThemeSetArgs = {
  colors: theme,
  // Panels tinted translucent deep indigo with no blur: the meadow stays visible
  // through them, and nothing has to be re-blurred each time a firefly moves.
  backdrop: { scene: SCENE_NAME, glass: { blur: 0, tint: '#121631', opacity: PANEL_TINT } },
}

let sceneSvg: string | undefined

async function apply($: EngineInterface) {
  const set = await $.theme.set(LOOK)
  if (!set.isDrawn) {
    $.ui.status(`Firefly Meadow: ${set.reason}`)
  }
  return set
}

// ── Remembered theme choice, shared by the theme mods in ~/claude-mods ──
// One line of text in ~/.claude/active-theme names the theme you picked last: a mod's
// name (its slash command), or "none" for the app's own look. Every theme mod follows
// the same rules, so several can stay enabled without racing at startup:
//   • session start: apply your theme only if the file names you, or if there is no file;
//   • /<mod>: apply your theme and write your name;
//   • /<mod> off: only if the file names you (or is missing), clear the theme and write "none".
/** At session start: does this mod put its theme on, given the remembered choice? */
export const appliesAtStart = (choice: string | undefined) => choice === undefined || choice === SCENE_NAME
/** May `/<mod> off` turn the theme off, given the remembered choice? */
export const mayTurnOff = (choice: string | undefined) => choice === undefined || choice === SCENE_NAME

async function choicePath($: EngineInterface) {
  const home = await $.env.get('HOME')
  return home === undefined ? undefined : `${home}/.claude/active-theme`
}

export async function readChoice($: EngineInterface): Promise<string | undefined> {
  const path = await choicePath($)
  if (path === undefined) return undefined
  try {
    const text = (await $.fs.read(path)).trim()
    return text === '' ? undefined : text
  } catch {
    return undefined // no file yet
  }
}

export async function writeChoice($: EngineInterface, name: string) {
  const path = await choicePath($)
  if (path !== undefined) await $.fs.write(path, `${name}\n`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const unpainted = problems.find(line => line.startsWith("Desktop won't paint"))
    if (unpainted !== undefined) {
      $.ui.toast(unpainted)
    }
    await $.command.register({
      name: SCENE_NAME,
      description: "Firefly Meadow theme: /firefly-meadow to switch to it (remembered for new sessions), /firefly-meadow off for the app's own look",
    })
    if (appliesAtStart(await readChoice($))) {
      await apply($)
    }

    return next(e)
  })

  on('command.run', { command: SCENE_NAME }, async ($, e) => {
    if (e.args.trim() === 'off') {
      const choice = await readChoice($)
      if (!mayTurnOff(choice)) {
        return { text: `Firefly Meadow isn't the active theme (${choice} is), so nothing changed.` }
      }
      await $.theme.clear()
      await writeChoice($, 'none')
      return { text: "Firefly Meadow is off, here and in new sessions: the app's own look is back. /firefly-meadow puts it on again." }
    }
    const set = await apply($)
    await writeChoice($, SCENE_NAME)
    return {
      text: set.isDrawn
        ? 'Firefly Meadow is on, and new sessions will open with it.'
        : `Firefly Meadow is now your chosen theme, but it could not draw here: ${set.reason}`,
    }
  }).catch(() => ({ text: 'Firefly Meadow could not change the theme just now.' }))

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if ((e.surface !== 'desktop' && e.surface !== 'mobile') || e.props.scene !== SCENE_NAME) {
      return next(e)
    }
    const { Svg } = $.ui.resolve(e)
    sceneSvg ??= buildScene()
    return <Svg source={sceneSvg} alt="Standing in a moonlit summer meadow: tall grass, two trees and fireflies drifting all around" isInteractive />
  })
}
