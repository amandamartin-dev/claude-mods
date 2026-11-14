// Bakes deep-field.html's self-playing asteroid game into one CSS-animated SVG.
//
// The desktop app draws a theme backdrop as SVG with no script, so the game
// can't run live behind the UI. Instead this runs the game's own simulation
// (fixed 60 Hz physics, the same autopilot, splitting and collisions) for one
// whole cycle, from an empty field through the waves until the field is clear,
// and writes every rock, shot, explosion and the ship as keyframes.
//
// The sim still supports a second ship (with chases) if one is added to `ships`;
// it was dropped to make room for richer rocks under the app's size limit.
//
// No <filter>, <mask> or <image> anywhere: the desktop app freezes a backdrop that
// holds any of them. Texture is layered shapes: each rock has chipped facets,
// ragged blotches, grit and crater bowls that turn with it, under a shading disc
// that turns the other way so the sun stays fixed in the upper left.
//
// Frame cap: every keyframe sits on a 1/30 s grid and moves in steps(),
// so the scene changes at most 30 times a second.
//
// Usage: node tools/build-scene.mjs [seed]   -> writes hooks/scene.ts

import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'scene.ts')
const SEED = Number(process.argv[2] ?? 99)

// ---------- utils (from deep-field.html) ----------
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0
    let t = Math.imul(a ^ a >>> 15, 1 | a)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}
const rand = mulberry32(SEED)
const rnd = (a, b) => a + (b - a) * rand()
const TAU = Math.PI * 2
function angDiff(a, b) { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d }
const f1 = v => (Math.round(v * 10) / 10).toString()
const f0 = v => Math.round(v).toString()

// ---------- world ----------
// The view is 1600x1000; the world wraps 100 px outside it on every side so
// rocks and shots wrap out of sight instead of popping at the window's edge.
const VIEW_W = 1600, VIEW_H = 1000, M = 100
const W = VIEW_W + 2 * M, H = VIEW_H + 2 * M
const FPS = 30, STEP = 1 / 60
const MAX_T = 90          // seconds simulated at most
const LAST_WAVE_AT = Number(process.env.LAST_WAVE_AT ?? 26)   // no new wave after this; the loop ends when the field is clear

const BULLET_SPEED = 560, BULLET_LIFE = 0.95, MAX_BULLETS = 5, FIRE_COOLDOWN = 0.17
const TURN_MAX = 4.6, TURN_ACC = 20, THRUST = 230, SHIP_R = 9
const SIZES = [
  { r: 48, count: 4, speed: [16, 40] },
  { r: 26, count: 5, speed: [35, 75] },
  { r: 13, count: 5, speed: [55, 110] },
]
const ROCK = [[104, 95, 86], [90, 88, 86], [114, 100, 82], [84, 78, 74], [100, 90, 79], [94, 94, 98]]

// ---------- asteroid shapes (the outline function of makeAsteroidTemplate) ----------
const TPL = SIZES.map((sz, si) => {
  const arr = []
  for (let t = 0; t < sz.count; t++) {
    const R = mulberry32(SEED + si * 101 + t * 17)
    const harm = []
    for (let k = 2; k <= 9; k++) harm.push([k, (0.17 / Math.pow(k, 0.95)) * (0.35 + R()), R() * TAU])
    const elong = 0.74 + R() * 0.24, ea = R() * TAU
    const shapeR = th => {
      let s = 1; for (const h of harm) s += h[1] * Math.sin(h[0] * th + h[2])
      const c = Math.cos(th - ea), sn = Math.sin(th - ea) / elong
      return clamp(s, 0.7, 1.2) / Math.sqrt(c * c + sn * sn) * (0.5 + 0.5 * elong) * 1.08
    }
    const n = si === 0 ? 40 : si === 1 ? 28 : 16
    const pts = []
    for (let i = 0; i < n; i++) { const th = i / n * TAU, r = shapeR(th) * sz.r * (1 + (R() - 0.5) * 0.1); pts.push([Math.cos(th) * r, Math.sin(th) * r]) }
    const craters = []
    const nCr = si === 2 ? 1 : si === 1 ? 3 : 5
    for (let i = 0; i < nCr; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * 0.62 * sz.r, cr = (0.1 + R() * R() * 0.3) * sz.r
      craters.push([Math.cos(a) * d, Math.sin(a) * d, cr])
    }
    const pal = (R() * ROCK.length) | 0
    arr.push({ id: `k${si}${t}`, pts, craters, pal, radius: sz.r, collR: sz.r * 0.9 })
  }
  return arr
})

// ---------- game state (ported from deep-field.html, with a second ship) ----------
let time = 0, nextId = 0
const rocks = [], bullets = []
const mkShip = (id, respawn) => ({ id, x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, av: 0, alive: false, respawn, inv: 0,
  cool: 0, thrust: false, target: null, decide: 0, wob: rand() * 10, log: [], gone: false })
const ships = [mkShip(0, 0.6)]
const otherOf = s => ships.find(x => x !== s) ?? null
let wave = 0, waveTimer = 0.8
// a chase: one ship hunts the other for a few seconds, then both go back to the rocks
let chase = null, nextChase = 7, chaseTurn = 1, chaseCount = 0

const rockLog = [], bulletLog = [], fx = []
const wd = (d, size) => d > size / 2 ? d - size : d < -size / 2 ? d + size : d
const tplOf = r => TPL[r.size][r.tpl]

function addRock(size, x, y, vx, vy) {
  const r = { id: nextId++, size, tpl: (rand() * TPL[size].length) | 0, x, y, vx, vy, a: rand() * TAU,
              va: rnd(-0.45, 0.45) * (1 + size * 0.4), dead: false, born: time, samples: [] }
  rocks.push(r); rockLog.push(r)
}
function spawnWave() {
  wave++
  const maxL = clamp(Math.round(W * H / 160000), 4, 9), n = Math.min(maxL, 3 + wave)
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0
    for (let t = 0; t < 25; t++) {
      if (rand() < 0.5) { x = rand() * W; y = rand() < 0.5 ? rnd(0, M * 0.6) : H - rnd(0, M * 0.6) }
      else { x = rand() < 0.5 ? rnd(0, M * 0.6) : W - rnd(0, M * 0.6); y = rand() * H }
      if (ships.every(s => !s.alive || Math.hypot(wd(x - s.x, W), wd(y - s.y, H)) > 280)) break
    }
    const a = rand() * TAU, sp = rnd(...SIZES[0].speed)
    addRock(0, x, y, Math.cos(a) * sp, Math.sin(a) * sp)
  }
}
function breakRock(r, hvx, hvy) {
  r.dead = true; r.died = time
  fx.push({ kind: `b${r.size}`, t: time, x: r.x, y: r.y, rot: Math.atan2(hvy, hvx) })
  if (r.size < 2) {
    const base = Math.atan2(r.vy, r.vx), spd = Math.hypot(r.vx, r.vy), lim = SIZES[r.size + 1].speed
    const rad = tplOf(r).radius
    for (const s of [-1, 1]) {
      const a = base + s * rnd(0.35, 1.1), sp = clamp(spd * rnd(1.1, 1.5) + rnd(8, 28), lim[0], lim[1])
      const off = rad * 0.35
      addRock(r.size + 1, (r.x + Math.cos(a) * off + W) % W, (r.y + Math.sin(a) * off + H) % H, Math.cos(a) * sp, Math.sin(a) * sp)
    }
  }
}
function killShip(s) {
  s.alive = false; s.respawn = 2.8; s.thrust = false
  fx.push({ kind: 'die', t: time, x: s.x, y: s.y, rot: rand() * TAU })
}
function trySpawnShip(s) {
  const other = otherOf(s)
  const cands = ships.length > 1 ? [[W * (s.id ? 0.6 : 0.42), H * (s.id ? 0.42 : 0.55)]] : [[W / 2, H / 2]]
  for (let i = 0; i < 30; i++) cands.push([rnd(W * 0.25, W * 0.75), rnd(H * 0.25, H * 0.75)])
  for (const [x, y] of cands) {
    let ok = !other || !other.alive || Math.hypot(wd(other.x - x, W), wd(other.y - y, H)) > 220
    for (const r of rocks) {
      if (!ok) break
      if (r.dead) continue
      const T = tplOf(r), px = wd(r.x - x, W), py = wd(r.y - y, H)
      const fx_ = px + r.vx * 1.2, fy = py + r.vy * 1.2
      if (Math.hypot(px, py) < T.collR + 150 || Math.hypot(fx_, fy) < T.collR + 90) ok = false
    }
    if (ok) {
      Object.assign(s, { x, y, vx: 0, vy: 0, a: -Math.PI / 2 + (s.id ? 0.8 : 0), av: 0, alive: true, inv: 2.2, cool: 0.4, target: null })
      fx.push({ kind: 'spawn', t: time, x, y, rot: 0 })
      return
    }
  }
  s.respawn = 0.4
}
// where to aim so a bolt fired now meets a body at (bx, by) moving at (bvx, bvy)
function aimAt(s, bx, by, bvx, bvy) {
  const px = wd(bx - s.x, W), py = wd(by - s.y, H)
  const vx = bvx - s.vx, vy = bvy - s.vy
  const a = vx * vx + vy * vy - BULLET_SPEED * BULLET_SPEED, b = 2 * (px * vx + py * vy), c = px * px + py * py
  let t
  if (Math.abs(a) < 1e-6) t = -c / b
  else {
    const disc = b * b - 4 * a * c; if (disc < 0) return null
    const q = Math.sqrt(disc), t1 = (-b + q) / (2 * a), t2 = (-b - q) / (2 * a)
    t = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity)
  }
  if (!isFinite(t) || t <= 0) return null
  const ax = px + vx * t, ay = py + vy * t
  return { t, ang: Math.atan2(ay, ax), dist: Math.sqrt(c), closing: px * vx + py * vy < 0 }
}
const intercept = (s, r) => aimAt(s, r.x, r.y, r.vx, r.vy)
function scoreTarget(s, r) {
  const sol = intercept(s, r); if (!sol) return null
  let sc = sol.t + Math.abs(angDiff(sol.ang, s.a)) / TURN_MAX * 0.9
  if (sol.closing) sc -= 0.25
  sc += [0.12, 0, -0.06][r.size]
  // leave the other ship's target to it
  const o = otherOf(s)
  if (o && o.alive && o.target === r) sc += 0.35
  return { s: sc, sol }
}
function fire(s) {
  const ca = Math.cos(s.a), sa = Math.sin(s.a)
  const b = { owner: s.id, x: s.x + ca * 16, y: s.y + sa * 16, vx: s.vx + ca * BULLET_SPEED, vy: s.vy + sa * BULLET_SPEED, life: BULLET_LIFE, born: time }
  b.x0 = b.x; b.y0 = b.y
  bullets.push(b)
  s.vx -= ca * 3; s.vy -= sa * 3
  s.cool = FIRE_COOLDOWN
}
function autopilot(s, dt) {
  s.cool -= dt; s.inv -= dt; s.decide -= dt
  const o = otherOf(s)
  const mode = chase && o && o.alive ? (chase.pursuer === s.id ? 'pursue' : 'evade') : 'hunt'
  let threat = null, best = Infinity
  for (const r of rocks) {
    if (r.dead) continue
    const T = tplOf(r), px = wd(r.x - s.x, W), py = wd(r.y - s.y, H)
    const rvx = r.vx - s.vx, rvy = r.vy - s.vy, vv = rvx * rvx + rvy * rvy
    const tca = clamp(vv > 1e-3 ? -(px * rvx + py * rvy) / vv : 0, 0, 1.6)
    const cx = px + rvx * tca, cy = py + rvy * tca, cd = Math.hypot(cx, cy)
    if (cd < T.collR + SHIP_R + 30 && tca < best) { best = tca; threat = { r, cx, cy, tca, rvx, rvy } }
  }
  if (mode === 'hunt' && (s.decide <= 0 || !s.target || s.target.dead)) {
    s.decide = 0.25
    let bestT = null, bestS = Infinity
    for (const r of rocks) { if (r.dead) continue; const sc = scoreTarget(s, r); if (sc && sc.s < bestS) { bestS = sc.s; bestT = r } }
    if (s.target && !s.target.dead) { const cur = scoreTarget(s, s.target); if (cur && cur.s < bestS * 1.25) bestT = s.target }
    s.target = bestT
  }
  let desired = s.a, thrust = false, chaseAim = null
  const dxo = o ? wd(o.x - s.x, W) : 0, dyo = o ? wd(o.y - s.y, H) : 0, dOther = o ? Math.hypot(dxo, dyo) : Infinity
  if (mode === 'pursue') {
    // lead the evader and close in, but never ram it
    chaseAim = aimAt(s, o.x, o.y, o.vx, o.vy)
    desired = chaseAim ? chaseAim.ang : Math.atan2(dyo, dxo)
    if (dOther < 110) desired += 0.7
    thrust = dOther > 170 && Math.abs(angDiff(desired, s.a)) < 0.4 && Math.hypot(s.vx, s.vy) < 230
  } else if (mode === 'evade') {
    // run away from the pursuer, jinking side to side
    desired = Math.atan2(-dyo, -dxo) + Math.sin(time * 2.4 + s.wob) * 0.9
    // stay inside the view
    const cxv = W / 2 - s.x, cyv = H / 2 - s.y
    if (Math.abs(cxv) > W * 0.36 || Math.abs(cyv) > H * 0.34) desired = Math.atan2(cyv, cxv) + Math.sin(time * 2.4) * 0.5
    thrust = Math.abs(angDiff(desired, s.a)) < 0.6 && Math.hypot(s.vx, s.vy) < 250
  } else {
    const tsol = s.target && !s.target.dead ? intercept(s, s.target) : null
    if (tsol) desired = tsol.ang + Math.sin(time * 1.7 + s.wob) * 0.02
    if (tsol) {
      const sp = Math.hypot(s.vx, s.vy)
      if (tsol.dist > 360 && sp < 75 && Math.abs(angDiff(desired, s.a)) < 0.3) thrust = true
    } else {
      const dx = W / 2 - s.x + (ships.length > 1 ? (s.id ? 160 : -160) : 0), dy = H / 2 - s.y
      if (Math.hypot(dx, dy) > 250) { desired = Math.atan2(dy, dx); thrust = Math.hypot(s.vx, s.vy) < 50 && Math.abs(angDiff(desired, s.a)) < 0.3 }
    }
    // keep a little room between the two ships
    if (o && o.alive && dOther < 60) { desired = Math.atan2(-dyo, -dxo); thrust = Math.abs(angDiff(desired, s.a)) < 0.5 }
  }
  if (threat && threat.tca < 0.8) {
    const tAim = intercept(s, threat.r)
    const canShootIt = tAim && Math.abs(angDiff(tAim.ang, s.a)) < 0.55 && threat.tca > 0.3 && threat.r.size > 0
    if (canShootIt) { desired = tAim.ang; s.target = threat.r }
    else {
      let ex = -threat.cx, ey = -threat.cy
      if (Math.hypot(ex, ey) < 2) { ex = -threat.rvy; ey = threat.rvx }
      desired = Math.atan2(ey, ex)
      thrust = Math.abs(angDiff(desired, s.a)) < 0.75
    }
  }
  const diff = angDiff(desired, s.a)
  const wantAv = clamp(diff * 9, -TURN_MAX, TURN_MAX)
  const dav = clamp(wantAv - s.av, -TURN_ACC * dt, TURN_ACC * dt)
  s.av += dav; s.a += s.av * dt
  s.thrust = thrust
  if (thrust) { const ca = Math.cos(s.a), sa = Math.sin(s.a); s.vx += ca * THRUST * dt; s.vy += sa * THRUST * dt }
  const drag = Math.exp(-0.28 * dt); s.vx *= drag; s.vy *= drag
  const spd = Math.hypot(s.vx, s.vy); if (spd > 300) { s.vx *= 300 / spd; s.vy *= 300 / spd }
  const mine = bullets.filter(b => b.owner === s.id).length
  if (s.cool <= 0 && mine < MAX_BULLETS) {
    let shoot = false
    // warning shots in a chase: they fly past the evader, never at it
    if (mode === 'pursue' && chaseAim && chaseAim.dist < 460 && Math.abs(angDiff(chaseAim.ang, s.a)) < 0.16 && rand() < 0.3) shoot = true
    if (!shoot) for (const r of rocks) {
      if (r.dead) continue
      const sol = intercept(s, r)
      if (!sol || sol.t > BULLET_LIFE * 0.92) continue
      const tol = Math.atan2(tplOf(r).collR * 0.75, Math.max(sol.dist, 1))
      if (Math.abs(angDiff(sol.ang, s.a)) < tol) { shoot = true; break }
    }
    if (shoot) fire(s)
  }
}
let ending = false
function step(dt) {
  time += dt
  for (const s of ships) {
    if (s.alive) {
      autopilot(s, dt)
      s.x = (s.x + s.vx * dt + W) % W; s.y = (s.y + s.vy * dt + H) % H
    } else if (!ending && !s.gone) { s.respawn -= dt; if (s.respawn <= 0) trySpawnShip(s) }
  }
  // chases start now and then while both ships fly
  if (chase && (time > chase.until || ships.some(x => !x.alive))) { chase = null; nextChase = time + rnd(6, 10) }
  if (!chase && ships.length > 1 && time > nextChase && !ending && ships.every(x => x.alive)) {
    chase = { pursuer: chaseTurn, until: time + rnd(4, 6) }; chaseCount++
    chaseTurn = 1 - chaseTurn
    for (const s of ships) s.target = null
  }
  for (const r of rocks) { r.x = (r.x + r.vx * dt + W) % W; r.y = (r.y + r.vy * dt + H) % H; r.a += r.va * dt }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.x = (b.x + b.vx * dt + W) % W; b.y = (b.y + b.vy * dt + H) % H; b.life -= dt
    let hit = b.life <= 0
    if (!hit) for (const r of rocks) {
      if (r.dead) continue
      const dx = wd(b.x - r.x, W), dy = wd(b.y - r.y, H), cr = tplOf(r).collR + 2
      if (dx * dx + dy * dy < cr * cr) { breakRock(r, b.vx, b.vy); hit = true; break }
    }
    if (hit) { b.died = time; bulletLog.push(b); bullets.splice(i, 1) }
  }
  for (const s of ships) {
    if (!s.alive || s.inv > 0) continue
    for (const r of rocks) {
      if (r.dead) continue
      const dx = wd(s.x - r.x, W), dy = wd(s.y - r.y, H), cr = tplOf(r).collR + SHIP_R
      if (dx * dx + dy * dy < cr * cr) { breakRock(r, s.vx, s.vy); killShip(s); break }
    }
  }
  if (rocks.some(r => r.dead)) for (let i = rocks.length - 1; i >= 0; i--) if (rocks[i].dead) rocks.splice(i, 1)
  const cleared = rocks.length === 0 || (rocks.length <= 2 && rocks.every(r => r.size === 2))
  if (cleared && time < LAST_WAVE_AT) { waveTimer -= dt; if (waveTimer <= 0) { spawnWave(); waveTimer = 1.6 } }
}

// ---------- run and record at 30 fps ----------
let frame = 0, endAt = null
for (let n = 0; ; n++) {
  step(STEP)
  if (n % 2 === 1) {
    frame++
    const t = frame / FPS
    for (const r of rocks) r.samples.push([t, r.x, r.y])
    for (const s of ships) s.log.push({ t, alive: s.alive, x: s.x, y: s.y, a: s.a, thrust: s.thrust })
  }
  if (endAt === null && time > LAST_WAVE_AT && rocks.length === 0 && bullets.length === 0) {
    endAt = time; chase = null
    // the ships jump out once the field is clear, so the loop can restart on an empty field
    ships.forEach((s, i) => { if (s.alive) s.jumpAt = time + 1.0 + i * 0.5 })
  }
  for (const s of ships) {
    if (s.jumpAt !== undefined && time >= s.jumpAt && s.alive) {
      fx.push({ kind: 'spawn', t: time, x: s.x, y: s.y, rot: 0 })
      s.alive = false; s.gone = true; ending = true
    }
  }
  if (endAt !== null) for (const s of ships) if (!s.alive) s.gone = true
  if (endAt !== null && time >= endAt + 3.6) break
  if (time > MAX_T) { console.error('field never cleared; try another seed'); process.exit(1) }
}
const LOOP = Math.ceil(time * FPS) / FPS
for (const b of bullets) { b.died = time; bulletLog.push(b) }

// ---------- keyframe writer ----------
const q = t => Math.round(t * FPS) / FPS                    // onto the 30 fps grid
const pct = t => { const p = clamp(t / LOOP * 100, 0, 100); return (Math.round(p * 1000) / 1000).toString() }
const steps = (t0, t1) => `steps(${Math.max(1, Math.round((t1 - t0) * FPS))})`
function keyframes(name, frames) {
  let s = `@keyframes ${name}{`
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i], nx = frames[i + 1]
    const tf = nx ? `;animation-timing-function:${steps(f.t, nx.t)}` : ''
    s += `${pct(f.t)}%{${f.css}${tf}}`
  }
  return s + '}'
}
// Keeps the samples a straight line can't stand in for, and splits at wraps.
function simplify(samples, tol, jump, valueOf) {
  if (samples.length <= 2) return samples
  const out = [samples[0]]
  let i = 0
  while (i < samples.length - 1) {
    let j = i + 1
    if (Math.abs(valueOf(samples[j])[0] - valueOf(samples[i])[0]) > jump || Math.abs(valueOf(samples[j])[1] - valueOf(samples[i])[1]) > jump) {
      out.push(samples[j]); i = j; continue
    }
    while (j + 1 < samples.length) {
      const c = j + 1, vc = valueOf(samples[c]), vj = valueOf(samples[j])
      if (Math.abs(vc[0] - vj[0]) > jump || Math.abs(vc[1] - vj[1]) > jump) break
      const vi = valueOf(samples[i])
      let ok = true
      for (let k = i + 1; k < c && ok; k++) {
        const u = (samples[k][0] - samples[i][0]) / (samples[c][0] - samples[i][0]), vk = valueOf(samples[k])
        for (let d = 0; d < vi.length; d++) if (Math.abs(vi[d] + (vc[d] - vi[d]) * u - vk[d]) > tol[d]) ok = false
      }
      if (!ok) break
      j = c
    }
    out.push(samples[j]); i = j
  }
  return out
}
const dedupe = frames => frames.filter((f, i) => i === frames.length - 1 || frames[i + 1].t > f.t)

const css = []
const body = []
const defs = []

// ---------- rocks: chipped, mottled, cratered stone, lit by a sun that doesn't turn ----------
// The desktop app freezes a backdrop that holds any <filter>, <mask> or <image>, so
// this uses only gradients, clip paths and shapes.
// Turning with the rock: its base color, faint angular facets like chipped faces,
// ragged darker and paler blotches, fine grit, and crater bowls with a pale lip.
// Over that, clipped to the outline, a shading disc that turns the other way, so its
// light stays put in the upper left: a lit cap, a terminator and a dark side.
defs.push(
  `<radialGradient id="bowl" fx=".3" fy=".3"><stop offset="0" stop-color="#000" stop-opacity=".5"/><stop offset=".62" stop-color="#000" stop-opacity=".3"/><stop offset=".82" stop-color="#000" stop-opacity=".08"/><stop offset=".9" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`,
  `<radialGradient id="rshade" cx=".34" cy=".32" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".4"/><stop offset=".2" stop-color="#fff" stop-opacity=".1"/><stop offset=".4" stop-color="#000" stop-opacity=".18"/><stop offset=".62" stop-color="#000" stop-opacity=".62"/><stop offset=".8" stop-color="#000" stop-opacity=".9"/></radialGradient>`,
)
const rockR = (T, th) => {
  // the outline's radius at an angle, read off its points
  const n = T.pts.length, u = ((th / TAU) % 1 + 1) % 1 * n, i = Math.floor(u) % n, j = (i + 1) % n, k = u - Math.floor(u)
  return Math.hypot(...T.pts[i]) * (1 - k) + Math.hypot(...T.pts[j]) * k
}
for (const set of TPL) for (const T of set) {
  const R = mulberry32(SEED + T.radius * 31 + T.pts.length)
  const fine = T.radius < 20 ? f1 : f0
  const P = (x, y) => `${fine(x)} ${fine(y)}`
  const d = 'M' + T.pts.map(p => P(p[0], p[1])).join('L') + 'Z'
  const base = `rgb(${ROCK[T.pal].map(v => clamp(Math.round(v * 1.28), 0, 255)).join(',')})`
  const s = T.radius / 48
  const inside = f => { const th = R() * TAU, rr = Math.sqrt(R()) * rockR(T, th) * f; return [Math.cos(th) * rr, Math.sin(th) * rr] }
  // ragged blotch: a polygon of jittered radius
  const blob = (rmin, rmax) => {
    const [cx, cy] = inside(0.8), rad = rmin + R() * (rmax - rmin), nv = 7, rot = R() * TAU
    let p = ''
    for (let i = 0; i < nv; i++) { const th = rot + i / nv * TAU, rr = rad * (0.55 + R() * 0.65); p += (i ? 'L' : 'M') + P(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr) }
    return p + 'Z'
  }
  // facet: a wedge from a stretch of the outline to a point inside, like a chipped face
  const facet = () => {
    const n = T.pts.length, i = (R() * n) | 0, j = (i + 2 + ((R() * n * 0.18) | 0)) % n, [ix, iy] = inside(0.45)
    return 'M' + P(...T.pts[i]) + 'L' + P(...T.pts[j]) + 'L' + P(ix, iy) + 'Z'
  }
  const many = (k, fn) => { let o = ''; for (let i = 0; i < k; i++) o += fn(); return o }
  const dot = (rmin, rmax) => { const [x, y] = inside(0.85); return `<circle cx="${fine(x)}" cy="${fine(y)}" r="${f1(rmin + R() * (rmax - rmin))}"/>` }
  const facetsDark = many(Math.round(4 * s + 1), facet), facetsLight = many(Math.round(3 * s + 1), facet)
  const blobsDark = many(Math.round(7 * s + 2), () => blob(2 * s + 0.8, 9 * s + 1.5))
  const blobsLight = many(Math.round(4 * s + 1), () => blob(1.5 * s + 0.6, 6 * s + 1))
  const gritDark = many(Math.round(14 * s + 3), () => dot(0.4, 1.1)), gritLight = many(Math.round(8 * s + 2), () => dot(0.35, 0.9))
  const cr = T.craters.map(c => `<circle cx="${fine(c[0])}" cy="${fine(c[1])}" r="${f1(c[2])}"/>`).join('')
  defs.push(`<path id="p${T.id}" d="${d}"/>`)
  defs.push(`<clipPath id="c${T.id}"><use href="#p${T.id}"/></clipPath>`)
  defs.push(`<g id="${T.id}"><use href="#p${T.id}" fill="${base}"/><g clip-path="url(#c${T.id})">` +
    `<path d="${facetsDark}" fill="#000" fill-opacity=".1"/><path d="${facetsLight}" fill="#fff" fill-opacity=".07"/>` +
    `<path d="${blobsDark}" fill="#1a1410" fill-opacity=".17"/><path d="${blobsLight}" fill="#f4e8d8" fill-opacity=".09"/>` +
    `<g fill="#000" fill-opacity=".32">${gritDark}</g><g fill="#fff" fill-opacity=".2">${gritLight}</g>` +
    `<g fill="url(#bowl)" stroke="#efe2cf" stroke-opacity=".16" stroke-width=".8">${cr}</g></g>` +
    `<use href="#p${T.id}" fill="none" stroke="#000" stroke-opacity=".4" stroke-width=".8"/></g>`)
}
for (const r of rockLog) {
  const born = q(r.born), died = q(r.died ?? LOOP)
  const s = simplify(r.samples, [1.2, 1.2], 300, p => [p[1], p[2]])
  if (s.length === 0) continue
  const frames = []
  if (born > 0) frames.push({ t: 0, css: 'opacity:0' }, { t: Math.max(0, born - 1 / FPS), css: 'opacity:0' })
  for (const p of s) frames.push({ t: q(p[0]), css: `transform:translate(${f0(p[1] - M)}px,${f0(p[2] - M)}px);opacity:1` })
  if (died < LOOP) frames.push({ t: died, css: 'opacity:0' })
  frames.push({ t: LOOP, css: 'opacity:0' })
  css.push(keyframes(`r${r.id}`, dedupe(frames)) + `.r${r.id}{animation-name:r${r.id}}`)
  const a0 = r.a - r.va * (r.samples.length / FPS), deg = 180 / Math.PI
  const spin = (name, sign) => `@keyframes ${name}{${pct(born)}%{transform:rotate(${f0(sign * a0 * deg)}deg);animation-timing-function:${steps(born, died)}}${pct(died)}%{transform:rotate(${f0(sign * r.a * deg)}deg)}}.${name}{animation-name:${name}}`
  css.push(spin(`q${r.id}`, 1), spin(`p${r.id}`, -1))
  const T = TPL[r.size][r.tpl]
  body.push(`<g class="a r${r.id}"><g class="a q${r.id}"><use href="#${T.id}"/><g clip-path="url(#c${T.id})"><circle class="a p${r.id}" r="${f0(T.radius * 1.3)}" fill="url(#rshade)"/></g></g></g>`)
}

// ---------- shots: bolts grouped by how long they flew; cyan for the first ship, amber for the second ----------
const BUCKETS = 12
const bucketUsed = new Set()
for (const b of bulletLog) {
  const born = q(b.born), life = clamp(b.died - b.born, 1 / FPS, BULLET_LIFE)
  const k = clamp(Math.round(life / BULLET_LIFE * BUCKETS), 1, BUCKETS)
  bucketUsed.add(k)
  const ang = Math.atan2(b.vy, b.vx) * 180 / Math.PI, sp = Math.hypot(b.vx, b.vy)
  body.push(`<g transform="translate(${f0(b.x0 - M)} ${f0(b.y0 - M)}) rotate(${f0(ang)}) scale(${(sp / BULLET_SPEED).toFixed(2)} 1)"><g class="a d s${k}" style="--d:${born.toFixed(3)}s"><use href="#bolt${b.owner}"/></g></g>`)
}
for (const k of bucketUsed) {
  const life = q(k / BUCKETS * BULLET_LIFE), dist = BULLET_SPEED * life
  css.push(keyframes(`s${k}`, [
    { t: 0, css: 'transform:translateX(0);opacity:1' },
    { t: life, css: `transform:translateX(${f0(dist)}px);opacity:1` },
    { t: life + 1 / FPS, css: 'opacity:0' },
    { t: LOOP, css: 'opacity:0' },
  ]) + `.s${k}{animation-name:s${k};animation-delay:var(--d)}`)
}
for (const [i, c, core, glow] of [[0, '#6edcff', '#ebfcff', 'plasma'], [1, '#ffb14a', '#fff4e0', 'amberg']].slice(0, ships.length)) {
  defs.push(`<g id="bolt${i}"><line x1="-15" y1="0" x2="0" y2="0" stroke="${c}" stroke-opacity=".6" stroke-width="2.4" stroke-linecap="round"/><line x1="-9" y1="0" x2="0" y2="0" stroke="${core}" stroke-opacity=".95" stroke-width="1" stroke-linecap="round"/><circle r="9" fill="url(#${glow})"/></g>`)
}

// ---------- explosions: warm sparks, a hot flash, dust and debris ----------
const FX = {
  b0: { sparks: 6, spd: [60, 260], dust: 1, deb: 3, flash: 70, dustR: 60 },
  b1: { sparks: 5, spd: [60, 240], dust: 1, deb: 2, flash: 42, dustR: 34 },
  b2: { sparks: 4, spd: [60, 220], dust: 1, deb: 1, flash: 22, dustR: 18 },
  die: { sparks: 12, spd: [40, 340], dust: 2, deb: 5, flash: 120, dustR: 30, ring: true },
}
const FXP = {}
const fr2 = mulberry32(SEED + 7)
const fxUsed = new Set(fx.map(e => e.kind))
for (const [kind, spec] of Object.entries(FX)) {
  if (!fxUsed.has(kind)) continue
  const parts = []
  const anim = (cls, frames) => { css.push(keyframes(cls, frames) + `.${cls}{animation-name:${cls};animation-delay:var(--d)}`) }
  anim(`${kind}f`, [
    { t: 0, css: 'transform:scale(1);opacity:1' },
    { t: q(kind === 'die' ? 0.5 : 0.2), css: 'transform:scale(1.25);opacity:0' },
    { t: LOOP, css: 'opacity:0' },
  ])
  parts.push(`<circle class="a d ${kind}f" r="${spec.flash / 2}" fill="url(#hot)"/>`)
  for (let i = 0; i < spec.dust; i++) {
    const a = fr2() * TAU, d = 8 + fr2() * 30, life = q(1.4 + fr2() * 1.0), r = spec.dustR * (0.5 + fr2() * 0.5)
    anim(`${kind}d${i}`, [
      { t: 0, css: 'transform:translate(0,0) scale(.6);opacity:.4' },
      { t: life, css: `transform:translate(${f0(Math.cos(a) * d * 2.5)}px,${f0(Math.sin(a) * d * 2.5)}px) scale(1.9);opacity:0` },
      { t: LOOP, css: 'opacity:0' },
    ])
    parts.push(`<circle class="a d ${kind}d${i}" r="${f0(r)}" fill="url(#dust)"/>`)
  }
  for (let i = 0; i < spec.deb; i++) {
    const a = fr2() * TAU, sp = 25 + fr2() * 85, life = q(0.9 + fr2() * 1.2), s = 2 + fr2() * 3.5, spin = (fr2() - 0.5) * 720
    anim(`${kind}r${i}`, [
      { t: 0, css: 'transform:translate(0,0) rotate(0);opacity:1' },
      { t: q(life * 0.6), css: `transform:translate(${f0(Math.cos(a) * sp * life * 0.6)}px,${f0(Math.sin(a) * sp * life * 0.6)}px) rotate(${f0(spin * 0.6)}deg);opacity:.9` },
      { t: life, css: `transform:translate(${f0(Math.cos(a) * sp * life)}px,${f0(Math.sin(a) * sp * life)}px) rotate(${f0(spin)}deg);opacity:0` },
      { t: LOOP, css: 'opacity:0' },
    ])
    const fill = kind === 'die' ? ['#8d949d', '#5b6168', '#b7bdc4'][i % 3] : '#7a6e60'
    parts.push(`<rect class="a d ${kind}r${i}" x="${f1(-s / 2)}" y="${f1(-s * 0.35)}" width="${f1(s)}" height="${f1(s * 0.7)}" fill="${fill}"/>`)
  }
  for (let i = 0; i < spec.sparks; i++) {
    const spread = kind === 'die' ? Math.PI : 1.2
    const a = Math.PI + (fr2() * 2 - 1) * spread, sp = spec.spd[0] + fr2() * (spec.spd[1] - spec.spd[0])
    const life = q(0.25 + fr2() * (kind === 'die' ? 1.0 : 0.4)), size = 3 + fr2() * (kind === 'die' ? 6 : 4)
    const at = u => `translate(${f0(Math.cos(a) * sp * life * u)}px,${f0(Math.sin(a) * sp * life * u)}px)`
    anim(`${kind}s${i}`, [
      { t: 0, css: `transform:${at(0)};opacity:1;fill:#ffecc8` },
      { t: q(life * 0.28), css: `transform:${at(0.28)};opacity:1;fill:#ffc45a` },
      { t: q(life * 0.55), css: `transform:${at(0.55)};opacity:.9;fill:#ff7828` },
      { t: q(life * 0.8), css: `transform:${at(0.8)};opacity:.6;fill:#be2d14` },
      { t: Math.max(q(life), q(life * 0.8) + 1 / FPS), css: `transform:${at(1)};opacity:0` },
      { t: LOOP, css: 'opacity:0' },
    ])
    parts.push(`<circle class="a d ${kind}s${i}" r="${f1(size / 2)}"/>`)
  }
  if (spec.ring) {
    anim(`${kind}g`, [
      { t: 0, css: 'transform:scale(.04);opacity:.5' },
      { t: q(0.7), css: 'transform:scale(1);opacity:0' },
      { t: LOOP, css: 'opacity:0' },
    ])
    parts.push(`<circle class="a d ${kind}g" r="186" fill="none" stroke="#bed7ff" stroke-width="3"/>`)
  }
  FXP[kind] = parts.join('')
}
if (fxUsed.has('spawn')) {
  css.push(keyframes('spf', [{ t: 0, css: 'transform:scale(1);opacity:1' }, { t: q(0.6), css: 'transform:scale(1.25);opacity:0' }, { t: LOOP, css: 'opacity:0' }]) + '.spf{animation-name:spf;animation-delay:var(--d)}')
  css.push(keyframes('spg', [{ t: 0, css: 'transform:scale(1);opacity:.5' }, { t: q(0.5), css: 'transform:scale(.1);opacity:0' }, { t: LOOP, css: 'opacity:0' }]) + '.spg{animation-name:spg;animation-delay:var(--d)}')
  FXP.spawn = `<circle class="a d spf" r="35" fill="url(#hot)"/><circle class="a d spg" r="40" fill="none" stroke="#bed7ff" stroke-width="2"/>`
}
const fxBody = []
for (const e of fx) {
  if (e.t > LOOP) continue
  fxBody.push(`<g transform="translate(${f0(e.x - M)} ${f0(e.y - M)}) rotate(${f0(e.rot * 180 / Math.PI)})" style="--d:${q(e.t).toFixed(3)}s">${FXP[e.kind]}</g>`)
}

// ---------- the ships ----------
const deg = 180 / Math.PI
const shipBodies = []
const LIVERY = [
  // the original: bright alloy, orange leading edges, blue engines
  { metal: 'metal0', wing: 'wing0', stripe: '#cd6e2d', engine: 'blue', canopy: 'canopy0' },
  // the rival: dark bronze, cyan leading edges, amber engines
  { metal: 'metal1', wing: 'wing1', stripe: '#3fc8e6', engine: 'amberg', canopy: 'canopy1' },
]
for (const s of ships) {
  let prev = null, off = 0
  const samples = []
  for (const l of s.log) {
    let a = l.a
    if (prev !== null) { while (a + off - prev > Math.PI) off -= TAU; while (a + off - prev < -Math.PI) off += TAU }
    a += off; prev = a
    samples.push({ ...l, a })
  }
  const frames = [{ t: 0, css: 'opacity:0' }]
  let run = []
  const flush = () => {
    if (run.length === 0) return
    const pts = simplify(run.map(l => [l.t, l.x, l.y, l.a]), [3, 3, 0.09], 300, p => [p[1], p[2], p[3]])
    for (const p of pts) frames.push({ t: q(p[0]), css: `transform:translate(${f1(p[1] - M)}px,${f1(p[2] - M)}px) rotate(${f0(p[3] * deg)}deg);opacity:1` })
    frames.push({ t: q(run[run.length - 1].t) + 1 / FPS, css: 'opacity:0' })
    run = []
  }
  for (const l of samples) { if (l.alive) run.push(l); else flush() }
  flush()
  frames.push({ t: LOOP, css: 'opacity:0' })
  css.push(keyframes(`ship${s.id}`, dedupe(frames)) + `.ship${s.id}{animation-name:ship${s.id}}`)
  const th = [{ t: 0, css: 'opacity:0' }]
  let on = false, since = 0
  for (const l of s.log) {
    const want = l.thrust && l.alive
    if (want !== on && l.t - since >= 0.25) { th.push({ t: q(l.t), css: `opacity:${want ? 1 : 0}` }); on = want; since = l.t }
  }
  th.push({ t: LOOP, css: 'opacity:0' })
  css.push(keyframes(`burn${s.id}`, dedupe(th)) + `.burn${s.id}{animation-name:burn${s.id}}`)
  const L = LIVERY[s.id]
  shipBodies.push(`<g class="a ship${s.id}">` +
    `<g class="a burn${s.id}"><ellipse cx="-28" cy="4.4" rx="13" ry="2.6" fill="url(#plume${s.id})"/><ellipse cx="-28" cy="-4.4" rx="13" ry="2.6" fill="url(#plume${s.id})"/><circle cx="-16" cy="4.4" r="8" fill="url(#${L.engine})"/><circle cx="-16" cy="-4.4" r="8" fill="url(#${L.engine})"/><circle cx="-15.2" cy="4.4" r="3" fill="url(#hot)"/><circle cx="-15.2" cy="-4.4" r="3" fill="url(#hot)"/></g>` +
    `<circle cx="-15.2" cy="4.4" r="3" fill="url(#${L.engine})" opacity=".35"/><circle cx="-15.2" cy="-4.4" r="3" fill="url(#${L.engine})" opacity=".35"/>` +
    `<path d="M3 3L-7 14L-11.5 14.5L-9.5 3.5ZM3 -3L-7 -14L-11.5 -14.5L-9.5 -3.5Z" fill="url(#${L.wing})" stroke="#000" stroke-opacity=".45" stroke-width=".35"/>` +
    `<path d="M1.2 4.6L-6 12.6M1.2 -4.6L-6 -12.6" stroke="${L.stripe}" stroke-opacity=".9" stroke-width=".9"/>` +
    `<rect x="-14" y="2.2" width="9" height="4.4" rx="1.4" fill="url(#${L.metal})"/><rect x="-14" y="-6.6" width="9" height="4.4" rx="1.4" fill="url(#${L.metal})"/>` +
    `<path d="M15 0C12 -2.8 6 -4.4 0 -4.6L-11 -4.2L-12.5 -2.5L-12.5 2.5L-11 4.2L0 4.6C6 4.4 12 2.8 15 0Z" fill="url(#${L.metal})" stroke="#000" stroke-opacity=".5" stroke-width=".4"/>` +
    `<path d="M-2 -4.4V4.4M-7 -4.4V4.4M-11 0H1" stroke="#000" stroke-opacity=".3" stroke-width=".25"/>` +
    `<ellipse cx="6" cy="0" rx="4.6" ry="2.1" fill="url(#${L.canopy})" stroke="#14181e" stroke-width=".45"/>` +
    `<ellipse cx="5.2" cy="-.8" rx="1.8" ry=".5" fill="#fff" fill-opacity=".55"/>` +
    `<circle cx="-10.5" cy="-14" r="2" fill="#ff3228" opacity=".85"/><circle cx="-10.5" cy="14" r="2" fill="#3cff78" opacity=".85"/></g>`)
}

// ---------- the still sky: layered nebula, star clusters, a banded ice giant, sun glare ----------
// (gradients and shapes only: a <filter> anywhere freezes the backdrop)
const sky = []
{
  const R = mulberry32(SEED + 3)
  const gauss = () => (R() + R() + R() - 1.5) / 1.5
  // the galactic band runs from lower left to upper right
  const bandA = -0.55, bx = Math.cos(bandA), by = Math.sin(bandA), nx = -by, ny = bx
  const deg = bandA * 180 / Math.PI
  const cloud = (id, c0, a0, c1, a1) => `<radialGradient id="${id}"><stop offset="0" stop-color="${c0}" stop-opacity="${a0}"/><stop offset=".5" stop-color="${c1}" stop-opacity="${a1}"/><stop offset="1" stop-color="${c1}" stop-opacity="0"/></radialGradient>`
  defs.push(
    cloud('nm', '#b0386e', '.55', '#5a1e44', '.22'),
    cloud('nv', '#7a4ac8', '.5', '#36205e', '.2'),
    cloud('nt', '#3a66c8', '.55', '#1c3266', '.22'),
    cloud('nk', '#ff9ac8', '.5', '#b0386e', '.18'),
    `<radialGradient id="lane"><stop offset="0" stop-color="#010207" stop-opacity=".75"/><stop offset=".6" stop-color="#010207" stop-opacity=".4"/><stop offset="1" stop-color="#010207" stop-opacity="0"/></radialGradient>`,
  )
  const neb = []
  // broad glow, then smaller billows, then a few bright knots
  for (const [n, rmin, rmax, spread, ids, op] of [[9, 260, 420, 0.1, ['nt', 'nv', 'nm'], [0.5, 0.8]], [22, 90, 220, 0.16, ['nm', 'nv', 'nt', 'nm'], [0.45, 0.9]], [7, 25, 60, 0.12, ['nk'], [0.4, 0.75]]]) {
    for (let i = 0; i < n; i++) {
      const s = (R() - 0.5) * 1.35, off = gauss() * spread
      const x = (0.5 + s * bx + off * nx) * VIEW_W, y = (0.5 + s * by + off * ny) * VIEW_H
      const rx = rmin + R() * (rmax - rmin), ry = rx * (0.3 + R() * 0.45)
      neb.push(`<ellipse cx="${f0(x)}" cy="${f0(y)}" rx="${f0(rx)}" ry="${f0(ry)}" transform="rotate(${f0(deg + gauss() * 25)} ${f0(x)} ${f0(y)})" fill="url(#${ids[i % ids.length]})" opacity="${(op[0] + R() * (op[1] - op[0])).toFixed(2)}"/>`)
    }
  }
  // dark dust lanes threading through the glow
  for (let i = 0; i < 11; i++) {
    const s = (R() - 0.5) * 1.2, off = gauss() * 0.05
    const x = (0.5 + s * bx + off * nx) * VIEW_W, y = (0.5 + s * by + off * ny) * VIEW_H, rx = 70 + R() * 190
    neb.push(`<ellipse cx="${f0(x)}" cy="${f0(y)}" rx="${f0(rx)}" ry="${f0(rx * (0.08 + R() * 0.12))}" transform="rotate(${f0(deg + gauss() * 14)} ${f0(x)} ${f0(y)})" fill="url(#lane)"/>`)
  }
  sky.push(neb.join(''))
  // stars: two hand-scattered clusters, each stamped across the sky turned to a different angle so nothing repeats visibly
  const temps = ['#fff4ea', '#fff4ea', '#d6e0ff', '#bed0ff', '#ffe4c8', '#ffcda0']
  const cluster = (id, n, size) => {
    const byC = temps.map(() => [])
    for (let i = 0; i < n; i++) {
      let m = R(); m = m * m * m
      byC[(R() * temps.length) | 0].push(`<circle cx="${f0(R() * size)}" cy="${f0(R() * size)}" r="${f1(0.45 + m * 1.5)}" opacity="${(0.35 + m * 0.65).toFixed(1)}"/>`)
    }
    defs.push(`<g id="${id}">${byC.map((l, i) => l.length ? `<g fill="${temps[i]}">${l.join('')}</g>` : '').join('')}</g>`)
  }
  cluster('sa', 64, 420)
  cluster('sb', 46, 300)
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 4; gx++) {
    const x = gx * 410 - 20 + R() * 30, y = gy * 340 - 20 + R() * 30
    sky.push(`<use href="#sa" transform="translate(${f0(x)} ${f0(y)}) rotate(${f0(R() * 360)} 210 210)"/>`)
  }
  for (let i = 0; i < 8; i++) {
    const s = (i / 7 - 0.5) * 1.25, off = gauss() * 0.08
    const x = (0.5 + s * bx + off * nx) * VIEW_W - 150, y = (0.5 + s * by + off * ny) * VIEW_H - 150
    sky.push(`<use href="#sb" transform="translate(${f0(x)} ${f0(y)}) rotate(${f0(R() * 360)} 150 150)"/>`)
  }
  // a few bright stars with soft spikes
  for (let i = 0; i < 7; i++) {
    const x = R() * VIEW_W, y = R() * VIEW_H, L = 9 + R() * 13
    sky.push(`<g transform="translate(${f0(x)} ${f0(y)})" opacity="${(0.5 + R() * 0.35).toFixed(2)}"><circle r="${f0(L * 0.5)}" fill="url(#star)"/><path d="M${f0(-L)} 0H${f0(L)}M0 ${f0(-L)}V${f0(L)}" stroke="url(#spike)" stroke-width=".6"/></g>`)
  }
  // twinkling: a dozen stars brightening and dimming on a 4 s cycle, each at its own point in it (30 steps a second)
  css.push('@keyframes tw{0%{opacity:.2;animation-timing-function:steps(60)}50%{opacity:1;animation-timing-function:steps(60)}100%{opacity:.2}}.tw{animation:tw 4s infinite;animation-delay:var(--d)}')
  for (let i = 0; i < 12; i++) {
    sky.push(`<circle class="tw" cx="${f0(R() * VIEW_W)}" cy="${f0(R() * VIEW_H * 0.85)}" r="${f1(2.4 + R() * 1.6)}" fill="url(#star)" style="--d:-${(Math.round(R() * 120) / 30).toFixed(3)}s"/>`)
  }
  // shooting stars: three quick streaks per loop, at different places
  css.push(keyframes('met', [
    { t: 0, css: 'transform:translateX(0);opacity:0' },
    { t: q(0.1), css: 'transform:translateX(80px);opacity:1' },
    { t: q(0.8), css: 'transform:translateX(640px);opacity:0' },
    { t: LOOP, css: 'opacity:0' },
  ]) + '.met{animation-name:met;animation-delay:var(--d)}')
  for (const [k, x, y, a] of [[0.17, 260, 120, 28], [0.51, 900, 60, 36], [0.84, 420, 300, 22]]) {
    sky.push(`<g transform="translate(${x} ${y}) rotate(${a})"><g class="a d met" style="--d:${q(LOOP * k).toFixed(3)}s"><rect x="-130" y="-.8" width="130" height="1.6" fill="url(#met)"/></g></g>`)
  }
  // ice giant, lower right: tilted cloud bands of varied tone and width, lit from the upper left
  const PR = Math.min(VIEW_W, VIEW_H) * 0.36, pcx = VIEW_W - PR * 0.3, pcy = VIEW_H + PR * 0.38
  defs.push(`<clipPath id="pc"><circle cx="${f0(pcx)}" cy="${f0(pcy)}" r="${f0(PR)}"/></clipPath>`)
  // rings, tilted with the bands: the whole ellipse goes behind the planet, and the near half is drawn again over it
  const RX = PR * 1.78, RY = PR * 0.3, ringTilt = `rotate(18 ${f0(pcx)} ${f0(pcy)})`
  const ringBands = [[1.0, 30, '#a8bcc6', '.2'], [0.955, 18, '#dfe9ec', '.26'], [0.915, 10, '#2a3a44', '.25'], [0.87, 26, '#c4d4da', '.24'], [0.82, 14, '#9fb4bd', '.18']]
  sky.push(`<g transform="${ringTilt}" fill="none">${ringBands.map(([k, w, c, o]) => `<ellipse cx="${f0(pcx)}" cy="${f0(pcy)}" rx="${f0(RX * k)}" ry="${f0(RY * k)}" stroke="${c}" stroke-width="${w}" stroke-opacity="${o}"/>`).join('')}</g>`)
  const ringFront = `<g transform="${ringTilt}" fill="none">${ringBands.map(([k, w, c, o]) => `<path d="M${f0(pcx - RX * k)} ${f0(pcy)}A${f0(RX * k)} ${f0(RY * k)} 0 0 0 ${f0(pcx + RX * k)} ${f0(pcy)}" stroke="${c}" stroke-width="${w}" stroke-opacity="${o}"/>`).join('')}</g>`
  sky.push(`<circle cx="${f0(pcx)}" cy="${f0(pcy)}" r="${f0(PR * 1.035)}" fill="url(#atmo)"/>`)
  const tones = ['#5d8fa6', '#2f5468', '#8fb6c6', '#3e6a82', '#a9c9d4', '#24465a']
  let bands = `<circle cx="${f0(pcx)}" cy="${f0(pcy)}" r="${f0(PR)}" fill="#4a7890"/>`
  for (let yb = -PR; yb < PR; ) {
    const h = 5 + R() * 20
    bands += `<ellipse cx="${f0(pcx + gauss() * 40)}" cy="${f0(pcy + yb + h / 2)}" rx="${f0(PR * (1.1 + R() * 0.4))}" ry="${f0(h / 2 + R() * 4)}" fill="${tones[(R() * tones.length) | 0]}" opacity="${(0.3 + R() * 0.5).toFixed(2)}"/>`
    yb += h * (0.7 + R() * 0.5)
  }
  // a few long streaks within the bands
  for (let i = 0; i < 6; i++) {
    const yb = (R() - 0.5) * PR * 1.6
    bands += `<ellipse cx="${f0(pcx + gauss() * 120)}" cy="${f0(pcy + yb)}" rx="${f0(PR * (0.3 + R() * 0.4))}" ry="${f1(1.5 + R() * 2.5)}" fill="#cfe4ea" opacity="${(0.15 + R() * 0.2).toFixed(2)}"/>`
  }
  sky.push(`<g clip-path="url(#pc)"><g transform="rotate(18 ${f0(pcx)} ${f0(pcy)})">${bands}</g></g>`)
  sky.push(`<circle cx="${f0(pcx)}" cy="${f0(pcy)}" r="${f0(PR)}" fill="url(#shade)"/>`)
  sky.push(`<circle cx="${f0(pcx)}" cy="${f0(pcy)}" r="${f0(PR)}" fill="url(#limb)"/>`)
  sky.push(ringFront)
  // a small cratered moon above the planet, lit like everything else
  const mx = pcx - PR * 1.22, my = pcy - PR * 1.08, mr = 22
  let moonCraters = ''
  for (let i = 0; i < 6; i++) { const a = R() * TAU, d = Math.sqrt(R()) * mr * 0.7; moonCraters += `<circle cx="${f1(Math.cos(a) * d)}" cy="${f1(Math.sin(a) * d)}" r="${f1(2 + R() * 5)}"/>` }
  sky.push(`<g transform="translate(${f0(mx)} ${f0(my)})"><circle r="${mr}" fill="#a29c92"/><g fill="url(#bowl)">${moonCraters}</g><circle r="${mr}" fill="url(#rshade)"/></g>`)
  // the sun that lights everything, just inside the upper-left corner, and a faint lens flare toward the middle
  const sx = 130, sy = 100
  sky.push(`<circle cx="${sx}" cy="${sy}" r="230" fill="url(#sun)"/>`)
  for (const [k, r, c, o] of [[0.32, 16, '#ffd9a0', '.1'], [0.5, 7, '#ffffff', '.14'], [0.68, 34, '#9fc0ff', '.06'], [0.8, 11, '#ffc890', '.1'], [1.12, 22, '#b8a0ff', '.06']]) {
    sky.push(`<circle cx="${f0(sx + (800 - sx) * k)}" cy="${f0(sy + (500 - sy) * k)}" r="${r}" fill="${c}" fill-opacity="${o}"/>`)
  }
  sky.push(`<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#glare)"/>`)
}

const glow = (id, c) => `<radialGradient id="${id}"><stop offset="0" stop-color="#fff"/><stop offset=".12" stop-color="${c}" stop-opacity=".95"/><stop offset=".4" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>`
const metal = (id, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset=".42" stop-color="${c[1]}"/><stop offset=".55" stop-color="${c[2]}"/><stop offset=".7" stop-color="${c[3]}"/><stop offset="1" stop-color="${c[4]}"/></linearGradient>`
defs.push(
  `<radialGradient id="hot"><stop offset="0" stop-color="#fff"/><stop offset=".12" stop-color="#ffecc8" stop-opacity=".95"/><stop offset=".4" stop-color="#ffc45a" stop-opacity=".28"/><stop offset="1" stop-color="#ff7828" stop-opacity="0"/></radialGradient>`,
  glow('blue', '#78aaff'), glow('plasma', '#6ee1ff'), glow('amberg', '#ffa040'),
  `<linearGradient id="plume0" x1="1" x2="0"><stop offset="0" stop-color="#bcd8ff" stop-opacity=".85"/><stop offset=".4" stop-color="#78aaff" stop-opacity=".45"/><stop offset="1" stop-color="#78aaff" stop-opacity="0"/></linearGradient>`,
  `<linearGradient id="plume1" x1="1" x2="0"><stop offset="0" stop-color="#ffd8a8" stop-opacity=".85"/><stop offset=".4" stop-color="#ffa040" stop-opacity=".45"/><stop offset="1" stop-color="#ffa040" stop-opacity="0"/></linearGradient>`,
  `<linearGradient id="met"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".8" stop-color="#e2eeff" stop-opacity=".45"/><stop offset="1" stop-color="#fff"/></linearGradient>`,
  `<radialGradient id="sun"><stop offset="0" stop-color="#fff"/><stop offset=".07" stop-color="#fff7e6" stop-opacity=".95"/><stop offset=".22" stop-color="#ffd9a0" stop-opacity=".32"/><stop offset=".55" stop-color="#ffb070" stop-opacity=".08"/><stop offset="1" stop-color="#ff9050" stop-opacity="0"/></radialGradient>`,
  `<radialGradient id="dust"><stop offset="0" stop-color="#968878" stop-opacity=".7"/><stop offset="1" stop-color="#968878" stop-opacity="0"/></radialGradient>`,
  `<radialGradient id="star"><stop offset="0" stop-color="#fff"/><stop offset=".2" stop-color="#d6e0ff" stop-opacity=".5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`,
  `<linearGradient id="spike"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#e6ecff" stop-opacity=".8"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
  // the planet's day side, terminator and night side, over its bands
  `<radialGradient id="shade" cx=".24" cy=".22" r=".95"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".28" stop-color="#000" stop-opacity="0"/><stop offset=".62" stop-color="#000" stop-opacity=".55"/><stop offset=".8" stop-color="#010207" stop-opacity=".93"/><stop offset="1" stop-color="#010207"/></radialGradient>`,
  `<radialGradient id="limb"><stop offset=".86" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".55"/></radialGradient>`,
  `<radialGradient id="atmo" cx=".3" cy=".3" r=".7"><stop offset=".9" stop-color="#5091eb" stop-opacity="0"/><stop offset=".965" stop-color="#6aa6ff" stop-opacity=".7"/><stop offset="1" stop-color="#5091eb" stop-opacity="0"/></radialGradient>`,
  `<radialGradient id="glare" cx="-.06" cy="-.1" r=".9"><stop offset="0" stop-color="#ffe2be" stop-opacity=".18"/><stop offset=".25" stop-color="#ffd2aa" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`,
  `<radialGradient id="vig" r=".72"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient>`,
  metal('metal0', ['#1d2127', '#a9b0ba', '#d4d9df', '#7b838d', '#1a1d22']),
  metal('metal1', ['#1f1712', '#8a6a4e', '#c9a27a', '#6a4e38', '#160f0b']),
  `<linearGradient id="wing0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e959e"/><stop offset="1" stop-color="#2b3037"/></linearGradient>`,
  `<linearGradient id="wing1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7d6450"/><stop offset="1" stop-color="#2a1f17"/></linearGradient>`,
  `<linearGradient id="canopy0" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bfe6ff"/><stop offset=".35" stop-color="#2f6f9d"/><stop offset="1" stop-color="#06121d"/></linearGradient>`,
  `<linearGradient id="canopy1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe0b8"/><stop offset=".35" stop-color="#9d5a2f"/><stop offset="1" stop-color="#1d0e06"/></linearGradient>`,
)

// ---------- assemble ----------
const style = `.a{animation-duration:${LOOP.toFixed(3)}s;animation-iteration-count:infinite;transform-box:view-box;transform-origin:0 0}` +
  `.d,${ships.map(x => `.ship${x.id},.burn${x.id}`).join(',')}{opacity:0}` +
  `@media (prefers-reduced-motion:reduce){.a{animation-play-state:paused}}` +
  css.join('')
// Everything sits in one layer over near-black; the mod sets that layer's opacity.
const build = () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}" preserveAspectRatio="xMidYMid slice">` +
  `<style>${style}</style><defs>${defs.join('')}</defs>` +
  `<rect width="${VIEW_W}" height="${VIEW_H}" fill="#010207"/>` +
  `<g opacity=".35">${sky.join('')}<g>${body.join('')}</g><g>${fxBody.join('')}</g>${shipBodies.join('')}` +
  `<rect width="${VIEW_W}" height="${VIEW_H}" fill="url(#vig)"/></g></svg>`
const svg = build()

const stats = { seed: SEED, loop: LOOP.toFixed(2), waves: wave, rocks: rockLog.length, shots: bulletLog.length, bursts: fx.length, chases: chaseCount, chars: svg.length }
console.log(JSON.stringify(stats))
writeFileSync(join(dirname(OUT), '..', 'tools', 'scene-preview.svg'), svg)
if (svg.length > 131072) { console.error(`scene is ${svg.length} characters; the app takes 131072 at most`); process.exit(2) }

writeFileSync(OUT, `// Generated by tools/build-scene.mjs from deep-field.html's simulation. Do not edit.\n` +
  `// ${JSON.stringify(stats)}\n` +
  `export const SCENE = ${JSON.stringify(svg)}\n`)
