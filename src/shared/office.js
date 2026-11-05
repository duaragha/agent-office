// The office floor plan, shop and seating rules, shared by the hub (which
// decides who sits where) and the client (which draws it). Units are metres;
// y is up, north is -z, the entrance is on the south wall.

export const BUILDING = { minX: -20, maxX: 20, minZ: -12, maxZ: 12, wallHeight: 3.2 }
export const ENTRANCE = { x: 0, z: 11.2 }

// Four desks per pod, in two back-to-back rows. Each seat faces the pod's
// centre line, where the monitors sit.
export const PODS = [
  { id: 'pod-1', x: -7, z: -1.8 },
  { id: 'pod-2', x: 0, z: -1.8 },
  { id: 'pod-3', x: 7, z: -1.8 },
  { id: 'pod-4', x: -7, z: 3.6 },
  { id: 'pod-5', x: 0, z: 3.6 },
  { id: 'pod-6', x: 7, z: 3.6 },
]

export const SEAT_OFFSETS = [
  { dx: -0.72, dz: -1.12, ry: 0 },
  { dx: 0.72, dz: -1.12, ry: 0 },
  { dx: -0.72, dz: 1.12, ry: Math.PI },
  { dx: 0.72, dz: 1.12, ry: Math.PI },
]

export const ROOMS = {
  meeting: { x0: -20, x1: -12, z0: -12, z1: -5, door: { x: -14.5, z: -5, side: 'z' } },
  ceo: { x0: 12, x1: 20, z0: -12, z1: -5, door: { x: 14.5, z: -5, side: 'z' } },
  lounge: { x0: -20, x1: -12, z0: -3, z1: 5, door: { x: -12, z: 1, side: 'x' } },
  server: { x0: 12, x1: 20, z0: -3, z1: 5, door: { x: 12, z: 1, side: 'x' } },
}

export const CEO_SEAT = { x: 16, z: -10.1, ry: 0 }

// Two benches either side of the entrance, facing into the office.
export const LOBBY_SPOTS = [-2.1, -3.2, -4.3, -5.4, 2.1, 3.2, 4.3, 5.4].map((x) => ({ x, z: 11.35, ry: Math.PI }))

export const LOUNGE_SPOTS = [
  { x: -18.6, z: -1.2, ry: Math.PI / 2 },
  { x: -18.6, z: 0.0, ry: Math.PI / 2 },
  { x: -18.6, z: 1.2, ry: Math.PI / 2 },
  { x: -15.6, z: 3.9, ry: Math.PI },
  { x: -16.8, z: 3.9, ry: Math.PI },
  { x: -14.4, z: 3.9, ry: Math.PI },
]

export const MEETING_SPOTS = [
  { x: -17.4, z: -9.6, ry: 0 },
  { x: -16.2, z: -9.6, ry: 0 },
  { x: -15.0, z: -9.6, ry: 0 },
  { x: -17.4, z: -7.4, ry: Math.PI },
  { x: -16.2, z: -7.4, ry: Math.PI },
  { x: -15.0, z: -7.4, ry: Math.PI },
]

export const CATALOG = [
  { id: 'pod-1', kind: 'pod', name: 'Starter pod', cost: 0, starter: true, blurb: 'Four desks to start with' },
  { id: 'pod-2', kind: 'pod', name: 'Pod 2', cost: 1200, blurb: '+4 desks' },
  { id: 'pod-3', kind: 'pod', name: 'Pod 3', cost: 2400, requires: 'pod-2', blurb: '+4 desks' },
  { id: 'pod-4', kind: 'pod', name: 'Pod 4', cost: 4000, requires: 'pod-3', blurb: '+4 desks' },
  { id: 'pod-5', kind: 'pod', name: 'Pod 5', cost: 6500, requires: 'pod-4', blurb: '+4 desks' },
  { id: 'pod-6', kind: 'pod', name: 'Pod 6', cost: 9000, requires: 'pod-5', blurb: '+4 desks' },
  { id: 'lounge', kind: 'room', name: 'Lounge', cost: 1500, blurb: 'Sleeping agents nap on the couches instead of at their desks' },
  { id: 'meeting', kind: 'room', name: 'Meeting room', cost: 3000, blurb: 'Agents in a live multi-agent run gather around the table' },
  { id: 'server', kind: 'room', name: 'Server room', cost: 4500, blurb: 'Racks that show your Claude and Codex usage windows' },
  { id: 'plants', kind: 'decor', name: 'Plants everywhere', cost: 300, blurb: 'Greenery on every pod' },
  { id: 'coffee', kind: 'decor', name: 'Espresso bar', cost: 600, requires: 'lounge', blurb: 'Rate-limited agents queue for coffee' },
  { id: 'arcade', kind: 'decor', name: 'Arcade cabinet', cost: 900, blurb: 'For the agents who finished early' },
  { id: 'neon', kind: 'decor', name: '"ship it" neon', cost: 800, blurb: 'Over the shipping board' },
]

export const STARTERS = CATALOG.filter((item) => item.starter).map((item) => item.id)

export const REWARDS = { pr: 60, run: 250, commit: 15 }

// Lower rank gets a desk first when there are not enough to go round.
export const STATE_RANK = { waiting: 0, working: 1, blocked: 2, idle: 3, done: 4, asleep: 5 }

export function seatsFor(unlocked) {
  const owned = new Set(unlocked)
  const seats = []
  for (const pod of PODS) {
    if (!owned.has(pod.id)) continue
    SEAT_OFFSETS.forEach((offset, i) => {
      seats.push({ id: `${pod.id}:${i}`, pod: pod.id, x: pod.x + offset.dx, z: pod.z + offset.dz, ry: offset.ry })
    })
  }
  return seats
}

export function seatById(id) {
  const [podId, index] = String(id).split(':')
  const pod = PODS.find((p) => p.id === podId)
  const offset = SEAT_OFFSETS[Number(index)]
  if (!pod || !offset) return null
  return { id, pod: pod.id, x: pod.x + offset.dx, z: pod.z + offset.dz, ry: offset.ry }
}

export const NAMES = [
  'Ada', 'Arlo', 'Bea', 'Cass', 'Dex', 'Eli', 'Fern', 'Gus', 'Hana', 'Ivo', 'Juno', 'Kai', 'Lux', 'Milo',
  'Nia', 'Oren', 'Pia', 'Quin', 'Rae', 'Sol', 'Tess', 'Uma', 'Vik', 'Wren', 'Xan', 'Yara', 'Zed', 'Bo',
  'Cleo', 'Dara', 'Ezra', 'Faye', 'Gio', 'Ines', 'Jax', 'Kit', 'Lev', 'Mae', 'Nell', 'Otto', 'Remy', 'Sage',
]

// Names read as women's or men's names, and the characters dress to match.
const FEMALE = new Set([
  'Ada', 'Bea', 'Cass', 'Fern', 'Hana', 'Juno', 'Lux', 'Nia', 'Pia', 'Rae', 'Tess', 'Uma', 'Wren', 'Yara',
  'Cleo', 'Dara', 'Faye', 'Ines', 'Kit', 'Mae', 'Nell', 'Sage',
])

export function isFemaleName(name) {
  return FEMALE.has(String(name || '').split(' ')[0])
}

export function hashOf(text) {
  let h = 2166136261
  for (const ch of String(text)) {
    h ^= ch.codePointAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
