// A small person built from capsules and spheres, animated by pose:
// type | wave | sleep | relax | fret | idle | sit | walk | stand.

import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { GEO, mat, C } from './look.js'

const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt))

export default function Character({ look, pose = 'idle', accent = null, scale = 1, onClick, onOver, onOut }) {
  const body = useRef()
  const head = useRef()
  const armL = useRef()
  const armR = useRef()
  const legL = useRef()
  const legR = useRef()
  const eyes = useRef()
  const poseRef = useRef(pose)
  poseRef.current = pose

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const p = poseRef.current
    const seated = p !== 'walk' && p !== 'stand' && p !== 'wave-stand'
    const step = Math.min(dt, 0.05)

    let legX = seated ? -1.45 : 0
    let legSwing = 0
    let armLX = -0.12
    let armRX = -0.12
    let armLZ = 0.08
    let armRZ = -0.08
    let headX = 0
    let headY = Math.sin(t * 0.45 + look.blinkPhase * 6) * 0.25
    let bodyX = 0
    let bob = 0

    if (p === 'walk') {
      legSwing = Math.sin(t * 9) * 0.55
      armLX = -Math.sin(t * 9) * 0.45
      armRX = Math.sin(t * 9) * 0.45
      bob = Math.abs(Math.sin(t * 9)) * 0.035
      headY = 0
    } else if (p === 'type') {
      armLX = -1.15 + Math.sin(t * 17) * 0.07
      armRX = -1.15 + Math.sin(t * 17 + 1.7) * 0.07
      armLZ = 0.32
      armRZ = -0.32
      headX = 0.12
      headY = Math.sin(t * 0.7) * 0.06
    } else if (p === 'wave' || p === 'wave-stand') {
      armRX = 0
      armRZ = -2.55 + Math.sin(t * 9) * 0.35
      armLX = -0.2
      bob = Math.abs(Math.sin(t * 4.5)) * 0.03
      headY = 0
      headX = -0.12
    } else if (p === 'sleep') {
      bodyX = 0.32
      headX = 0.45
      headY = 0.2
      armLX = -1.3
      armRX = -1.3
      armLZ = 0.5
      armRZ = -0.5
      bob = Math.sin(t * 1.4) * 0.006
    } else if (p === 'relax') {
      bodyX = -0.14
      armLX = -2.7
      armRX = -2.7
      armLZ = -0.35
      armRZ = 0.35
      headX = -0.15
    } else if (p === 'fret') {
      armLX = -0.95
      armRX = -0.95
      armLZ = 0.95
      armRZ = -0.95
      headY = Math.sin(t * 2.4) * 0.3
    } else if (p === 'sit') {
      armLX = -0.65
      armRX = -0.65
      armLZ = 0.25
      armRZ = -0.25
      headX = 0.08
    }

    const b = body.current
    if (!b) return
    b.position.y = damp(b.position.y, bob, 20, step)
    b.rotation.x = damp(b.rotation.x, bodyX, 6, step)
    head.current.rotation.x = damp(head.current.rotation.x, headX, 6, step)
    head.current.rotation.y = damp(head.current.rotation.y, headY, 4, step)
    armL.current.rotation.x = damp(armL.current.rotation.x, armLX, 12, step)
    armR.current.rotation.x = damp(armR.current.rotation.x, armRX, 12, step)
    armL.current.rotation.z = damp(armL.current.rotation.z, armLZ, 12, step)
    armR.current.rotation.z = damp(armR.current.rotation.z, armRZ, 12, step)
    legL.current.rotation.x = damp(legL.current.rotation.x, legX + legSwing, 14, step)
    legR.current.rotation.x = damp(legR.current.rotation.x, legX - legSwing, 14, step)
    const blink = ((t + look.blinkPhase * 4) % 4.2) < 0.12 || p === 'sleep'
    eyes.current.scale.y = blink ? 0.15 : 1
  })

  const skin = mat(look.skin)
  const hair = mat(look.hair)
  const shirt = mat(look.shirt)
  const pants = mat(C.pants)
  const dark = mat('#141018')
  const fem = !!look.fem

  return (
    <group scale={scale} onClick={onClick} onPointerOver={onOver} onPointerOut={onOut}>
      <group ref={body}>
        <group ref={legL} position={[0.09, 0.46, 0]}>
          <mesh geometry={GEO.leg} material={fem && look.skirt ? skin : pants} position={[0, -0.2, 0]}
            scale={fem ? [0.85, 1, 0.85] : 1} castShadow />
        </group>
        <group ref={legR} position={[-0.09, 0.46, 0]}>
          <mesh geometry={GEO.leg} material={fem && look.skirt ? skin : pants} position={[0, -0.2, 0]}
            scale={fem ? [0.85, 1, 0.85] : 1} castShadow />
        </group>
        {fem && look.skirt && (
          <mesh geometry={GEO.skirt} material={mat(look.skirtColor, { side: 2 })} position={[0, 0.47, 0]} castShadow />
        )}
        <mesh geometry={GEO.torso} material={shirt} position={[0, 0.78, 0]} scale={fem ? [0.88, 1, 0.9] : 1} castShadow />
        {accent && (
          <mesh geometry={GEO.box} material={mat(accent, { emissive: accent, emissiveIntensity: 0.35 })}
            position={[0, 0.8, 0.175]} scale={[0.06, 0.2, 0.02]} />
        )}
        <group ref={armL} position={[fem ? 0.225 : 0.245, 0.96, 0]}>
          <mesh geometry={GEO.arm} material={shirt} position={[0, -0.15, 0]} scale={fem ? 0.88 : 1} castShadow />
          <mesh geometry={GEO.sphere} material={skin} position={[0, -0.32, 0]} scale={0.052} />
        </group>
        <group ref={armR} position={[fem ? -0.225 : -0.245, 0.96, 0]}>
          <mesh geometry={GEO.arm} material={shirt} position={[0, -0.15, 0]} scale={fem ? 0.88 : 1} castShadow />
          <mesh geometry={GEO.sphere} material={skin} position={[0, -0.32, 0]} scale={0.052} />
        </group>
        <group ref={head} position={[0, 1.21, 0]}>
          <mesh geometry={GEO.head} material={skin} castShadow />
          {fem ? <WomanHair look={look} hair={hair} /> : <ManHair look={look} hair={hair} />}
          <group ref={eyes} position={[0, 0.02, 0.182]}>
            <mesh geometry={GEO.eye} material={dark} position={[0.068, 0, 0]} scale={fem ? 1.2 : 1} />
            <mesh geometry={GEO.eye} material={dark} position={[-0.068, 0, 0]} scale={fem ? 1.2 : 1} />
          </group>
          {fem ? (
            <>
              <mesh geometry={GEO.box} material={dark} position={[0.1, 0.05, 0.172]} rotation={[0, 0.3, -0.5]} scale={[0.045, 0.01, 0.01]} />
              <mesh geometry={GEO.box} material={dark} position={[-0.1, 0.05, 0.172]} rotation={[0, -0.3, 0.5]} scale={[0.045, 0.01, 0.01]} />
              <mesh geometry={GEO.sphere} material={mat('#f29bb2', { transparent: true, opacity: 0.75 })} position={[0.112, -0.05, 0.158]} scale={[0.042, 0.026, 0.012]} />
              <mesh geometry={GEO.sphere} material={mat('#f29bb2', { transparent: true, opacity: 0.75 })} position={[-0.112, -0.05, 0.158]} scale={[0.042, 0.026, 0.012]} />
              <mesh geometry={GEO.box} material={mat('#c4566e')} position={[0, -0.09, 0.184]} scale={[0.05, 0.014, 0.012]} />
            </>
          ) : (
            <>
              <mesh geometry={GEO.box} material={hair} position={[0.07, 0.078, 0.18]} rotation={[0, 0, 0.12]} scale={[0.065, 0.016, 0.012]} />
              <mesh geometry={GEO.box} material={hair} position={[-0.07, 0.078, 0.18]} rotation={[0, 0, -0.12]} scale={[0.065, 0.016, 0.012]} />
              {look.beard && <mesh geometry={GEO.sphere} material={hair} position={[0, -0.135, 0.105]} scale={[0.12, 0.07, 0.09]} />}
            </>
          )}
        </group>
      </group>
    </group>
  )
}

// Long hair, a ponytail or a bun, always with locks framing the face.
function WomanHair({ look, hair }) {
  return (
    <>
      <mesh geometry={GEO.hairCap} material={hair} position={[0, 0.02, -0.01]} rotation={[-0.18, 0, 0]} />
      <mesh geometry={GEO.lock} material={hair} position={[0.172, -0.17, 0.045]} rotation={[0.05, 0, 0.1]} />
      <mesh geometry={GEO.lock} material={hair} position={[-0.172, -0.17, 0.045]} rotation={[0.05, 0, -0.1]} />
      {look.hairStyle === 0 && (
        <mesh geometry={GEO.sphere} material={hair} position={[0, -0.17, -0.09]} scale={[0.23, 0.4, 0.16]} castShadow />
      )}
      {look.hairStyle === 1 && (
        <>
          <mesh geometry={GEO.sphere} material={mat('#c9b3ff')} position={[0, 0.06, -0.205]} scale={0.035} />
          <mesh geometry={GEO.tail} material={hair} position={[0.06, -0.14, -0.25]} rotation={[0.3, 0, 0.25]} castShadow />
        </>
      )}
      {look.hairStyle === 2 && (
        <>
          <mesh geometry={GEO.hairBun} material={hair} position={[0, 0.2, -0.07]} scale={1.15} />
          <mesh geometry={GEO.sphere} material={hair} position={[0, -0.08, -0.1]} scale={[0.2, 0.2, 0.13]} />
        </>
      )}
    </>
  )
}

function ManHair({ look, hair }) {
  return (
    <>
      <mesh geometry={GEO.hairCap} material={hair} position={[0, 0.02, -0.015]} rotation={[look.hairStyle === 2 ? -0.5 : -0.35, 0, 0]}
        scale={look.hairStyle === 2 ? 0.99 : 1} />
      {look.hairStyle === 1 && (
        <mesh geometry={GEO.sphere} material={hair} position={[0, 0.17, 0.09]} scale={[0.15, 0.07, 0.11]} />
      )}
    </>
  )
}
