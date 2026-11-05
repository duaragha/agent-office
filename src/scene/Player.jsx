// You: walk with WASD, drag to look, wheel to zoom, E to talk.
// In overview mode the camera orbits the whole floor instead.

import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import Character from './Character.jsx'
import { C } from './look.js'
import { slide } from './nav.js'
import { positions, lerpAngle } from './registry.js'
import { useOffice } from '../store.js'
import { BUILDING } from '../shared/office.js'

const PLAYER_LOOK = { skin: '#d7a07c', hair: '#1d1a20', hairStyle: 0, shirt: C.rose, blinkPhase: 0.3 }
const TALK_RANGE = 2.2
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export const keys = new Set()

function typing() {
  const el = document.activeElement
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export function useKeyTracking() {
  useEffect(() => {
    const down = (e) => {
      if (typing()) return
      keys.add(e.code)
    }
    const up = (e) => keys.delete(e.code)
    const blur = () => keys.clear()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])
}

export default function Player({ obstacles }) {
  const mode = useOffice((s) => s.mode)
  const { camera, gl } = useThree()
  const group = useRef()
  const pos = useRef({ x: 0, z: 7.3 })
  const heading = useRef(Math.PI)
  const cam = useRef({ yaw: 0, pitch: 0.42, dist: 6 })
  const [moving, setMoving] = useState(false)
  const movingRef = useRef(false)

  useEffect(() => {
    const el = gl.domElement
    let drag = null
    const down = (e) => {
      if (useOffice.getState().mode !== 'walk') return
      drag = { x: e.clientX, y: e.clientY }
    }
    const move = (e) => {
      if (!drag) return
      cam.current.yaw -= (e.clientX - drag.x) * 0.006
      cam.current.pitch = clamp(cam.current.pitch + (e.clientY - drag.y) * 0.004, 0.1, 1.3)
      drag = { x: e.clientX, y: e.clientY }
    }
    const up = () => {
      drag = null
    }
    const wheel = (e) => {
      if (useOffice.getState().mode !== 'walk') return
      cam.current.dist = clamp(cam.current.dist * (e.deltaY > 0 ? 1.1 : 0.9), 2.2, 18)
    }
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', wheel, { passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [gl])

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05)
    const walkMode = useOffice.getState().mode === 'walk'
    let mx = 0
    let mz = 0
    if (walkMode && !typing()) {
      const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
      const side = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
      const fx = -Math.sin(cam.current.yaw)
      const fz = -Math.cos(cam.current.yaw)
      mx = fx * fwd - fz * side
      mz = fz * fwd + fx * side
    }
    const len = Math.hypot(mx, mz)
    const isMoving = len > 0.01
    if (isMoving) {
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 5.6 : 3.2
      slide(obstacles, pos.current, (mx / len) * speed * step, (mz / len) * speed * step, 0.28)
      heading.current = lerpAngle(heading.current, Math.atan2(mx, mz), 1 - Math.exp(-12 * step))
    }
    if (isMoving !== movingRef.current) {
      movingRef.current = isMoving
      setMoving(isMoving)
    }
    if (group.current) {
      group.current.position.set(pos.current.x, 0, pos.current.z)
      group.current.rotation.y = heading.current
    }

    // Who is close enough to talk to.
    let nearest = null
    let best = TALK_RANGE
    if (walkMode) {
      for (const [id, p] of positions) {
        const d = Math.hypot(p.x - pos.current.x, p.z - pos.current.z)
        if (d < best) {
          best = d
          nearest = id
        }
      }
    }
    useOffice.getState().setNear(nearest)

    if (walkMode) {
      const { yaw, pitch, dist } = cam.current
      const want = new THREE.Vector3(
        pos.current.x + Math.sin(yaw) * dist * Math.cos(pitch),
        1.3 + dist * Math.sin(pitch),
        pos.current.z + Math.cos(yaw) * dist * Math.cos(pitch),
      )
      camera.position.lerp(want, 1 - Math.exp(-7 * step))
      camera.lookAt(pos.current.x, 1.15, pos.current.z)
    }
  })

  return (
    <>
      <group ref={group}>
        <Character look={PLAYER_LOOK} pose={moving ? 'walk' : 'stand'} />
      </group>
      {mode === 'overview' && <OverviewRig />}
    </>
  )
}

function OverviewRig() {
  const controls = useRef()
  const { camera } = useThree()
  const arrival = useRef(performance.now())
  const flyTo = useOffice((s) => s.flyTo)
  const goal = useRef(new THREE.Vector3(0, 0, 0.5))
  const interacting = useRef(false)

  useEffect(() => {
    if (flyTo) goal.current.set(flyTo.x, 0, flyTo.z)
  }, [flyTo])

  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    const step = Math.min(dt, 0.05)
    const settling = performance.now() - arrival.current < 900
    if (settling) {
      camera.position.lerp(new THREE.Vector3(goal.current.x, 21, goal.current.z + 17), 1 - Math.exp(-5 * step))
    }
    if (!interacting.current) c.target.lerp(goal.current, 1 - Math.exp(-4 * step))
    c.target.x = clamp(c.target.x, BUILDING.minX, BUILDING.maxX)
    c.target.z = clamp(c.target.z, BUILDING.minZ, BUILDING.maxZ)
    c.update()
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={7}
      maxDistance={52}
      maxPolarAngle={1.22}
      screenSpacePanning={false}
      onStart={() => {
        arrival.current = 0
        interacting.current = true
      }}
      onEnd={() => {
        interacting.current = false
        if (controls.current) goal.current.copy(controls.current.target)
      }}
    />
  )
}
