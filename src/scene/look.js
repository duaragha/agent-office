// Shared colours, geometries and materials. One instance of each, so twenty
// people and twenty-four desks do not mean hundreds of GPU buffers.

import * as THREE from 'three'
import { hashOf, isFemaleName } from '../shared/office.js'
import { useOffice } from '../store.js'

export const C = {
  void: '#050407',
  floor: '#221e2a',
  floorRoom: '#272033',
  floorServer: '#1a1e24',
  wall: '#2a2533',
  wallTop: '#2b2735',
  desk: '#3d3649',
  deskEdge: '#4d4559',
  chair: '#332d3f',
  bezel: '#0a090d',
  ink: '#ece8f2',
  dim: '#a8a1b6',
  faint: '#8a8399',
  accent: '#c9b3ff',
  rose: '#ffb8da',
  sky: '#9fcfff',
  ok: '#8fdcaf',
  warn: '#eec77a',
  bad: '#ff9aa8',
  claude: '#d97757',
  codex: '#d9dde3',
  pants: '#2b2735',
  plant: '#5f9e7a',
  pot: '#3a3446',
}

// The building's own colours, by time of day. People, screens and boards keep
// their colours either way.
export const THEMES = {
  night: {
    bg: '#050407', floor: '#221e2a', floorRoom: '#272033', floorServer: '#1a1e24', lockedRoom: '#0c0a10',
    lobbyFloor: '#120f17', wall: '#2a2533', wallTop: '#2b2735', desk: '#3d3649', deskEdge: '#4d4559',
    chair: '#332d3f', bench: '#121017', gridCell: '#231f2c', gridSection: '#2e2939', window: '#0b1022',
    rug: '#2a1f3a', couch: '#3b2f52', label: '#8a8399', lockedDoor: '#1a1622',
  },
  day: {
    bg: '#cfe6fb', floor: '#d9d3e1', floorRoom: '#cdc5da', floorServer: '#c3c9d1', lockedRoom: '#b7b0c1',
    lobbyFloor: '#cac2d5', wall: '#efebf3', wallTop: '#d6cfe0', desk: '#f6f3f9', deskEdge: '#d8d1e2',
    chair: '#4a4360', bench: '#8d84a0', gridCell: '#c9c2d3', gridSection: '#b6aec3', window: '#a8d8ff',
    rug: '#b9a6d9', couch: '#7d6aa8', label: '#5b5370', lockedDoor: '#a59db2',
  },
}

export function isDaytime(light, hour) {
  return light === 'day' || (light === 'auto' && hour >= 7 && hour < 19)
}

export function useTheme() {
  return useOffice((s) => (isDaytime(s.light, s.hour) ? THEMES.day : THEMES.night))
}

const SKIN = ['#f2d3bd', '#e8bf9f', '#d7a07c', '#b77e5a', '#8c5b3e', '#64412c']
const HAIR = ['#1d1a20', '#3b2a20', '#6b4a2e', '#a8774a', '#d8c3a0', '#8d8a96', '#3a2850', '#7a3b3b']
const WOMAN_HAIR = ['#1d1a20', '#3b2a20', '#6b4a2e', '#a8774a', '#e0c79c', '#7a3b3b', '#b5523b', '#2d1f3d']
const SKIRTS = ['#2b2735', '#3a2f52', '#26324a', '#5a2c45', '#1f3a33', '#6b5a9c']

export function looksFor(id, agent, name) {
  const h = hashOf(id)
  const fem = isFemaleName(name)
  return {
    fem,
    skin: SKIN[h % SKIN.length],
    hair: fem ? WOMAN_HAIR[(h >>> 3) % WOMAN_HAIR.length] : HAIR[(h >>> 3) % HAIR.length],
    hairStyle: (h >>> 7) % 3,
    beard: !fem && (h >>> 11) % 4 === 0,
    skirt: fem,
    skirtColor: SKIRTS[(h >>> 15) % SKIRTS.length],
    shirt: agent === 'codex' ? C.codex : C.claude,
    blinkPhase: (h % 1000) / 1000,
  }
}

const cache = new Map()
export function mat(color, options = {}) {
  const key = `${color}|${JSON.stringify(options)}`
  if (!cache.has(key)) {
    cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.02, ...options }))
  }
  return cache.get(key)
}

export const GEO = {
  torso: new THREE.CapsuleGeometry(0.19, 0.24, 6, 14),
  arm: new THREE.CapsuleGeometry(0.052, 0.24, 4, 8),
  leg: new THREE.CapsuleGeometry(0.07, 0.28, 4, 8),
  head: new THREE.SphereGeometry(0.2, 22, 16),
  hairCap: new THREE.SphereGeometry(0.212, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55),
  hairBun: new THREE.SphereGeometry(0.085, 12, 10),
  lock: new THREE.CapsuleGeometry(0.052, 0.3, 4, 8),
  tail: new THREE.CapsuleGeometry(0.06, 0.26, 4, 8),
  skirt: new THREE.CylinderGeometry(0.17, 0.29, 0.3, 18, 1, true),
  eye: new THREE.SphereGeometry(0.024, 8, 6),
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16),
  sphere: new THREE.SphereGeometry(1, 16, 12),
  plane: new THREE.PlaneGeometry(1, 1),
}

export const SCREEN = {
  working: { bg: '#141024', fg: C.accent },
  waiting: { bg: '#1a1409', fg: C.warn },
  blocked: { bg: '#200b11', fg: C.bad },
  idle: { bg: '#0f0d14', fg: C.dim },
  done: { bg: '#0a1a11', fg: C.ok },
  asleep: { bg: '#060509', fg: '#4a4456' },
}

export const STATE_LABEL = {
  working: 'working',
  waiting: 'needs you',
  blocked: 'rate limited',
  idle: 'idle',
  done: 'done',
  asleep: 'asleep',
}
