// Collision boxes for the player and a coarse walk grid with A* for agents.
// Everything is axis-aligned boxes on the floor plane: { x0, x1, z0, z1 }.

import { BUILDING, PODS, ROOMS } from '../shared/office.js'

const WALL = 0.2
const GLASS = 0.12
const DOOR = 0.85 // half-width of a doorway

function box(x0, x1, z0, z1) {
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) }
}

// A wall from a to b along one axis, with an optional gap centred on `gap`.
function wallX(z, x0, x1, gap, thick = GLASS) {
  if (gap == null) return [box(x0, x1, z - thick / 2, z + thick / 2)]
  return [box(x0, gap - DOOR, z - thick / 2, z + thick / 2), box(gap + DOOR, x1, z - thick / 2, z + thick / 2)]
}

function wallZ(x, z0, z1, gap, thick = GLASS) {
  if (gap == null) return [box(x - thick / 2, x + thick / 2, z0, z1)]
  return [box(x - thick / 2, x + thick / 2, z0, gap - DOOR), box(x - thick / 2, x + thick / 2, gap + DOOR, z1)]
}

export function roomOpen(id, unlocked) {
  return id === 'ceo' || unlocked.includes(id)
}

export function buildObstacles(unlocked) {
  const { minX, maxX, minZ, maxZ } = BUILDING
  const list = [
    ...wallX(minZ, minX, maxX, null, WALL),
    ...wallX(maxZ, minX, maxX, 0, WALL).map((b) => (b.x1 <= 0 ? { ...b, x1: -1.4 } : { ...b, x0: 1.4 })),
    ...wallZ(minX, minZ, maxZ, null, WALL),
    ...wallZ(maxX, minZ, maxZ, null, WALL),
  ]
  const { meeting, ceo, lounge, server } = ROOMS
  list.push(...wallZ(meeting.x1, meeting.z0, meeting.z1, null))
  list.push(...wallX(meeting.z1, meeting.x0, meeting.x1, roomOpen('meeting', unlocked) ? meeting.door.x : null))
  list.push(...wallZ(ceo.x0, ceo.z0, ceo.z1, null))
  list.push(...wallX(ceo.z1, ceo.x0, ceo.x1, ceo.door.x))
  for (const room of [lounge, server]) {
    const id = room === lounge ? 'lounge' : 'server'
    const inner = room === lounge ? room.x1 : room.x0
    list.push(...wallZ(inner, room.z0, room.z1, roomOpen(id, unlocked) ? room.door.z : null))
    list.push(...wallX(room.z0, room.x0, room.x1, null))
    list.push(...wallX(room.z1, room.x0, room.x1, null))
  }

  for (const pod of PODS) {
    if (unlocked.includes(pod.id)) list.push(box(pod.x - 1.45, pod.x + 1.45, pod.z - 0.8, pod.z + 0.8))
  }
  list.push(box(-1.6, 1.6, 8.25, 8.95)) // reception
  list.push(box(-6, -1.6, 11.15, 11.75), box(1.6, 6, 11.15, 11.75)) // benches
  list.push(box(14.9, 17.1, -9.75, -9.05)) // CEO desk
  if (roomOpen('meeting', unlocked)) list.push(box(-18.3, -14.1, -9.1, -7.9))
  if (roomOpen('lounge', unlocked)) {
    list.push(box(-19.8, -19.0, -1.9, 1.9), box(-17.6, -13.6, 4.15, 4.85), box(-17.1, -15.9, -0.4, 1.4))
  }
  if (roomOpen('server', unlocked)) {
    for (let i = 0; i < 4; i++) list.push(box(18.6, 19.6, -2.2 + i * 1.6, -1.2 + i * 1.6))
  }
  if (unlocked.includes('arcade')) list.push(box(-17.6, -16.4, 8.6, 9.6))
  return list
}

export function collides(list, x, z, r) {
  for (const b of list) {
    if (x + r > b.x0 && x - r < b.x1 && z + r > b.z0 && z - r < b.z1) return true
  }
  return false
}

// Move a circle by (dx, dz), sliding along whatever it hits.
export function slide(list, pos, dx, dz, r) {
  if (!collides(list, pos.x + dx, pos.z, r)) pos.x += dx
  if (!collides(list, pos.x, pos.z + dz, r)) pos.z += dz
  return pos
}

// --- walk grid ------------------------------------------------------------

const CELL = 0.4
const INFLATE = 0.26

export function buildGrid(list) {
  const { minX, maxX, minZ, maxZ } = BUILDING
  const cols = Math.ceil((maxX - minX) / CELL)
  const rows = Math.ceil((maxZ - minZ) / CELL)
  const blocked = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = minX + (c + 0.5) * CELL
      const z = minZ + (r + 0.5) * CELL
      if (collides(list, x, z, INFLATE)) blocked[r * cols + c] = 1
    }
  }
  return { cols, rows, blocked }
}

function cellOf(grid, x, z) {
  const c = Math.max(0, Math.min(grid.cols - 1, Math.floor((x - BUILDING.minX) / CELL)))
  const r = Math.max(0, Math.min(grid.rows - 1, Math.floor((z - BUILDING.minZ) / CELL)))
  return r * grid.cols + c
}

function centre(grid, index) {
  const c = index % grid.cols
  const r = Math.floor(index / grid.cols)
  return { x: BUILDING.minX + (c + 0.5) * CELL, z: BUILDING.minZ + (r + 0.5) * CELL }
}

function nearestFree(grid, index) {
  if (!grid.blocked[index]) return index
  const c0 = index % grid.cols
  const r0 = Math.floor(index / grid.cols)
  for (let radius = 1; radius < 12; radius++) {
    let best = -1
    let bestD = Infinity
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue
        const i = r * grid.cols + c
        const d = dr * dr + dc * dc
        if (!grid.blocked[i] && d < bestD) {
          best = i
          bestD = d
        }
      }
    }
    if (best >= 0) return best
  }
  return index
}

function lineFree(grid, a, b) {
  const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (CELL * 0.5))
  for (let i = 1; i < steps; i++) {
    const t = i / steps
    if (grid.blocked[cellOf(grid, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)]) return false
  }
  return true
}

// A* over the grid, then string-pulled. Returns waypoints ending at `to`.
export function findPath(grid, from, to) {
  const start = nearestFree(grid, cellOf(grid, from.x, from.z))
  const goal = nearestFree(grid, cellOf(grid, to.x, to.z))
  const g = new Float32Array(grid.cols * grid.rows).fill(Infinity)
  const came = new Int32Array(grid.cols * grid.rows).fill(-1)
  const open = [start]
  const inOpen = new Uint8Array(grid.cols * grid.rows)
  g[start] = 0
  inOpen[start] = 1
  const goalC = centre(grid, goal)
  const h = (i) => {
    const p = centre(grid, i)
    return Math.hypot(p.x - goalC.x, p.z - goalC.z)
  }
  const f = new Float32Array(grid.cols * grid.rows).fill(Infinity)
  f[start] = h(start)
  let found = start === goal
  let guard = 0
  while (open.length && !found && guard++ < 20000) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i
    const current = open[bi]
    open.splice(bi, 1)
    inOpen[current] = 0
    if (current === goal) {
      found = true
      break
    }
    const c = current % grid.cols
    const r = Math.floor(current / grid.cols)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue
        const nr = r + dr
        const nc = c + dc
        if (nr < 0 || nc < 0 || nr >= grid.rows || nc >= grid.cols) continue
        const n = nr * grid.cols + nc
        if (grid.blocked[n]) continue
        if (dr && dc && (grid.blocked[r * grid.cols + nc] || grid.blocked[nr * grid.cols + c])) continue
        const cost = g[current] + (dr && dc ? 1.414 : 1)
        if (cost < g[n]) {
          g[n] = cost
          came[n] = current
          f[n] = cost + h(n)
          if (!inOpen[n]) {
            open.push(n)
            inOpen[n] = 1
          }
        }
      }
    }
  }
  if (!found) return [{ x: to.x, z: to.z }]
  const cells = []
  for (let i = goal; i !== -1; i = came[i]) cells.push(centre(grid, i))
  cells.reverse()
  const points = [{ x: from.x, z: from.z }, ...cells.slice(1, -1), { x: to.x, z: to.z }]
  const pulled = [points[0]]
  let anchor = 0
  for (let i = 2; i < points.length; i++) {
    if (!lineFree(grid, points[anchor], points[i])) {
      pulled.push(points[i - 1])
      anchor = i - 1
    }
  }
  pulled.push(points[points.length - 1])
  return pulled.slice(1)
}
