// Every agent in the office: walks to its spot, sits, and wears a tag.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import Character from './Character.jsx'
import { looksFor, mat, GEO, C, STATE_LABEL } from './look.js'
import { findPath } from './nav.js'
import { positions, lerpAngle } from './registry.js'
import { useOffice } from '../store.js'
import { ENTRANCE, LOBBY_SPOTS, LOUNGE_SPOTS, MEETING_SPOTS, NAMES, hashOf, seatById } from '../shared/office.js'

export function spotFor(agent) {
  const spot = agent.spot || { zone: 'lobby', index: 0 }
  if (spot.zone === 'desk') {
    const seat = seatById(spot.seat)
    if (seat) return { ...seat, zone: 'desk' }
  }
  const list = spot.zone === 'lounge' ? LOUNGE_SPOTS : spot.zone === 'meeting' ? MEETING_SPOTS : LOBBY_SPOTS
  const base = list[(spot.index || 0) % list.length]
  return { ...base, zone: list === LOBBY_SPOTS ? 'lobby' : spot.zone }
}

export function poseFor(agent, zone, walking) {
  if (walking) return 'walk'
  if (zone === 'lobby') return agent.state === 'waiting' ? 'wave' : 'sit'
  switch (agent.state) {
    case 'working':
      return 'type'
    case 'waiting':
      return 'wave'
    case 'asleep':
      return zone === 'lounge' ? 'sleep' : 'sleep'
    case 'done':
      return 'relax'
    case 'blocked':
      return 'fret'
    default:
      return 'idle'
  }
}

const seen = new Set()

export default function Agents({ grid }) {
  const agents = useOffice((s) => s.server?.agents || [])
  const [departed, setDeparted] = useState([])
  const previous = useRef(new Map())

  useEffect(() => {
    const now = new Map(agents.map((a) => [a.id, a]))
    const gone = [...previous.current.values()].filter((a) => !now.has(a.id))
    if (gone.length) {
      setDeparted((list) => [...list.filter((d) => !now.has(d.id)), ...gone.map((a) => ({ ...a, leaving: true }))])
      setTimeout(() => setDeparted((list) => list.filter((d) => !gone.some((g) => g.id === d.id))), 9000)
    }
    previous.current = now
  }, [agents])

  return (
    <group>
      {agents.map((agent) => (
        <Agent key={agent.id} agent={agent} grid={grid} />
      ))}
      {departed.map((agent) => (
        <Agent key={`gone-${agent.id}`} agent={agent} grid={grid} leaving />
      ))}
    </group>
  )
}

function Agent({ agent, grid, leaving = false }) {
  const target = leaving ? { ...ENTRANCE, ry: 0, zone: 'exit' } : spotFor(agent)
  const firstTime = !seen.has(agent.id)
  const loaded = useOffice((s) => !!s.server)
  // Agents already here when the page opens are drawn in place; new arrivals walk in.
  const entering = firstTime && performance.now() > 4000 && loaded
  if (firstTime) seen.add(agent.id)
  const group = useRef()
  const pos = useRef(entering ? { x: ENTRANCE.x, z: ENTRANCE.z } : { x: target.x, z: target.z })
  const heading = useRef(target.ry)
  const path = useRef([])
  const [walking, setWalking] = useState(false)
  const look = useMemo(() => looksFor(agent.id, agent.agent, agent.name), [agent.id, agent.agent, agent.name])
  const selected = useOffice((s) => s.selectedId === agent.id)
  const near = useOffice((s) => s.nearId === agent.id)
  const select = useOffice((s) => s.select)
  const [hover, setHover] = useState(false)

  useEffect(() => {
    if (Math.hypot(target.x - pos.current.x, target.z - pos.current.z) < 0.05) return
    path.current = findPath(grid, pos.current, target)
    setWalking(true)
  }, [target.x, target.z, grid]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => positions.delete(agent.id), [agent.id])

  useFrame((_, dt) => {
    const g = group.current
    if (!g) return
    const step = Math.min(dt, 0.05)
    let face = target.ry
    if (path.current.length) {
      const next = path.current[0]
      const dx = next.x - pos.current.x
      const dz = next.z - pos.current.z
      const d = Math.hypot(dx, dz)
      const move = 1.8 * step
      if (d <= move) {
        pos.current.x = next.x
        pos.current.z = next.z
        path.current.shift()
        if (!path.current.length) setWalking(false)
      } else {
        pos.current.x += (dx / d) * move
        pos.current.z += (dz / d) * move
      }
      if (d > 0.02) face = Math.atan2(dx, dz)
    }
    heading.current = lerpAngle(heading.current, face, 1 - Math.exp(-9 * step))
    g.position.set(pos.current.x, 0, pos.current.z)
    g.rotation.y = heading.current
    if (!leaving) positions.set(agent.id, pos.current)
  })

  const pose = poseFor(agent, target.zone, walking)
  const click = (e) => {
    if (e.delta > 6) return
    e.stopPropagation()
    select(agent.id, { x: pos.current.x, z: pos.current.z })
  }

  return (
    <group ref={group}>
      <Character
        look={look}
        pose={pose}
        accent={agent.role === 'lead' ? C.accent : null}
        onClick={click}
        onOver={(e) => {
          e.stopPropagation()
          setHover(true)
          document.body.style.cursor = 'pointer'
        }}
        onOut={() => {
          setHover(false)
          document.body.style.cursor = ''
        }}
      />
      {(selected || hover || near) && (
        <mesh geometry={GEO.cyl} material={mat(C.accent, { emissive: C.accent, emissiveIntensity: 0.6, transparent: true, opacity: 0.55 })}
          position={[0, 0.012, 0]} scale={[0.5, 0.01, 0.5]} />
      )}
      {!leaving && <Tag agent={agent} zone={target.zone} expanded={selected || hover || near} />}
      {!leaving && !walking && target.zone !== 'lobby' && (
        <Helpers agent={agent} expanded={selected || hover || near} />
      )}
    </group>
  )
}

// Subagents the agent has out right now, standing behind its chair until they
// report back. Small, so the desk still reads as one person's.
function Helpers({ agent, expanded }) {
  const helpers = agent.helpers || []
  if (!helpers.length) return null
  return helpers.map((task, i) => {
    const key = `${agent.id}:helper:${i}`
    const name = NAMES[hashOf(key) % NAMES.length]
    const x = (i - (helpers.length - 1) / 2) * 0.5
    return (
      <group key={key} position={[x, 0, -0.8]}>
        <Character look={looksFor(key, agent.agent, name)} pose="stand" scale={0.62} />
        {expanded && (
          <Html position={[0, 1.15, 0]} center zIndexRange={[25, 0]}>
            <div className="helper-tag">{`helper · ${task}`}</div>
          </Html>
        )}
      </group>
    )
  })
}

function Tag({ agent, zone, expanded }) {
  const ref = useRef()
  const { camera } = useThree()
  const mode = useOffice((s) => s.mode)
  const bubble = useOffice((s) => s.bubbles[agent.id])
  const thinking = useOffice((s) => s.asks[agent.id]?.pending)
  const select = useOffice((s) => s.select)
  const [now, setNow] = useState(() => performance.now())

  useEffect(() => {
    if (!bubble) return undefined
    const timer = setTimeout(() => setNow(performance.now()), Math.max(0, bubble.until - performance.now()) + 50)
    return () => clearTimeout(timer)
  }, [bubble])

  useFrame(() => {
    const el = ref.current
    if (!el) return
    const parent = el.closest('[data-tag-root]') || el
    const world = positions.get(agent.id)
    if (!world) return
    const d = Math.hypot(camera.position.x - world.x, camera.position.z - world.z)
    const fade = mode === 'walk' ? (d < 14 ? 1 : d < 20 ? 1 - (d - 14) / 6 : 0) : 1
    parent.style.opacity = expanded ? 1 : fade.toFixed(2)
    // From far away a tag shrinks to its status dot so neighbours don't overlap.
    const far = mode === 'overview' && !expanded && camera.position.distanceTo(new THREE.Vector3(world.x, 1.5, world.z)) > 24
    parent.classList.toggle('tag-far', far)
  })

  const status = zone === 'lobby' ? (agent.state === 'waiting' ? 'waiting' : 'nodesk') : agent.state
  const label = status === 'nodesk' ? 'no desk' : STATE_LABEL[agent.state] || agent.state
  const speech = bubble && bubble.until > now ? (bubble.text.length > 220 ? `${bubble.text.slice(0, 217)}…` : bubble.text) : null

  return (
    <Html position={[0, 1.72, 0]} center zIndexRange={[30, 0]}>
      <div data-tag-root className="tag-root" ref={ref}>
        {speech && <div className={`speech${bubble.bark ? ' bark' : ''}`}>{speech}</div>}
        {thinking && !speech && <div className="speech thinking">thinking<span className="dots" /></div>}
        <button
          type="button"
          className={`tag tag-${status}${expanded ? ' tag-open' : ''}`}
          onClick={() => {
            const p = positions.get(agent.id)
            select(agent.id, p ? { x: p.x, z: p.z } : undefined)
          }}
        >
          <span className={`dot dot-${status}`} />
          <span className="tag-name">{agent.name.toLowerCase()}</span>
          {agent.role === 'lead' && <span className="tag-role">lead</span>}
          {(expanded || status === 'waiting' || status === 'nodesk' || status === 'blocked') && (
            <span className="tag-state">{label}</span>
          )}
        </button>
        {expanded && <div className="tag-title">{agent.title}</div>}
      </div>
    </Html>
  )
}
