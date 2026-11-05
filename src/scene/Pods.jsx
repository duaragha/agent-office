// Desk pods: four desks, chairs, a divider with the team's name, and a
// monitor per desk showing what its agent is doing right now.

import { Html, Text } from '@react-three/drei'
import { GEO, mat, C, SCREEN, STATE_LABEL, useTheme } from './look.js'
import { FONT } from './fonts.js'
import { PODS, SEAT_OFFSETS, CATALOG } from '../shared/office.js'
import { buyItem } from '../net.js'
import { useOffice } from '../store.js'

export function Block({ position, size, color, opts, cast = true, receive = true, ...rest }) {
  return (
    <mesh geometry={GEO.box} material={mat(color, opts)} position={position} scale={size}
      castShadow={cast} receiveShadow={receive} {...rest} />
  )
}

export default function Pods({ unlocked, agents, building, podTeams = {} }) {
  const bySeat = new Map()
  for (const agent of agents) if (agent.spot?.zone === 'desk') bySeat.set(agent.spot.seat, agent)
  const plants = unlocked.includes('plants')
  return (
    <group>
      {PODS.map((pod) =>
        unlocked.includes(pod.id) ? (
          <Pod key={pod.id} pod={pod} bySeat={bySeat} plants={plants} team={podTeams[pod.id]} />
        ) : (
          <LockedPod key={pod.id} pod={pod} building={building} unlocked={unlocked} />
        ),
      )}
    </group>
  )
}

function Pod({ pod, bySeat, plants, team: owner }) {
  const T = useTheme()
  const team = !owner ? 'open desks' : owner.startsWith('run:') ? 'team run' : owner
  return (
    <group position={[pod.x, 0, pod.z]}>
      {SEAT_OFFSETS.map((offset, i) => (
        <Desk key={i} offset={offset} agent={bySeat.get(`${pod.id}:${i}`)} />
      ))}
      <Block position={[0, 0.96, 0]} size={[2.86, 0.42, 0.04]} color={T.deskEdge} />
      <Block position={[0, 1.18, 0]} size={[2.86, 0.02, 0.06]} color={C.accent}
        opts={{ emissive: C.accent, emissiveIntensity: 0.55 }} cast={false} />
      {[1, -1].map((side) => (
        <Text key={side} font={FONT.mono} fontSize={0.085} color={C.accent} anchorX="center" anchorY="middle"
          position={[0, 1.06, side * 0.025]} rotation={[0, side > 0 ? 0 : Math.PI, 0]} maxWidth={2.6}>
          {team.toLowerCase()}
        </Text>
      ))}
      {plants && (
        <>
          <Plant position={[1.75, 0, -0.6]} />
          <Plant position={[-1.75, 0, 0.6]} />
        </>
      )}
    </group>
  )
}

function Desk({ offset, agent }) {
  const T = useTheme()
  const toward = offset.dz < 0 ? 1 : -1 // from the seat toward the pod's centre line
  const deskZ = offset.dz + toward * 0.68
  const state = agent?.state || 'empty'
  const screen = SCREEN[state] || { bg: '#08070b', fg: '#3a3446' }
  const lines = agent ? screenLines(agent) : 'available'
  return (
    <group>
      <Block position={[offset.dx, 0.74, deskZ]} size={[1.36, 0.05, 0.7]} color={T.desk} />
      <Block position={[offset.dx - 0.64, 0.36, deskZ]} size={[0.04, 0.72, 0.62]} color={T.deskEdge} />
      <Block position={[offset.dx + 0.64, 0.36, deskZ]} size={[0.04, 0.72, 0.62]} color={T.deskEdge} />
      <Block position={[offset.dx, 0.775, deskZ - toward * 0.13]} size={[0.44, 0.02, 0.14]} color="#16141b" />
      <group position={[offset.dx, 0, deskZ + toward * 0.2]} rotation={[0, offset.ry + Math.PI, 0]}>
        <Block position={[0, 0.86, -0.03]} size={[0.06, 0.2, 0.05]} color={C.bezel} />
        <Block position={[0, 1.07, 0]} size={[0.66, 0.4, 0.035]} color={C.bezel} />
        <mesh geometry={GEO.plane} position={[0, 1.07, 0.019]} scale={[0.62, 0.36, 1]}>
          <meshBasicMaterial color={screen.bg} toneMapped={false} />
        </mesh>
        <Text font={FONT.mono} fontSize={0.027} lineHeight={1.3} color={screen.fg} anchorX="left" anchorY="top"
          position={[-0.29, 1.235, 0.022]} maxWidth={0.58} clipRect={[-0.01, -0.33, 0.6, 0.01]}
          overflowWrap="break-word">
          {lines}
        </Text>
      </group>
      <Chair x={offset.dx} z={offset.dz} toward={toward} />
    </group>
  )
}

function screenLines(agent) {
  const head = `${agent.name.toLowerCase()} · ${STATE_LABEL[agent.state] || agent.state}`
  const recent = (agent.activity || []).slice(-6).map((item) => {
    const mark = item.kind === 'tool' ? '›' : item.kind === 'ask' ? '?' : '“'
    return `${mark} ${item.text}`.slice(0, 64)
  })
  return [head, `${agent.agent} · ${agent.project}`.slice(0, 64), '', ...recent].join('\n')
}

function Chair({ x, z, toward }) {
  const T = useTheme()
  return (
    <group position={[x, 0, z]}>
      <Block position={[0, 0.44, 0]} size={[0.46, 0.07, 0.44]} color={T.chair} />
      <Block position={[0, 0.76, -toward * 0.24]} size={[0.44, 0.5, 0.06]} color={T.chair} />
      <mesh geometry={GEO.cyl} material={mat('#121017')} position={[0, 0.22, 0]} scale={[0.03, 0.42, 0.03]} />
      <mesh geometry={GEO.cyl} material={mat('#121017')} position={[0, 0.03, 0]} scale={[0.24, 0.04, 0.24]} />
    </group>
  )
}

export function Plant({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh geometry={GEO.cyl} material={mat(C.pot)} position={[0, 0.2, 0]} scale={[0.18, 0.4, 0.18]} castShadow />
      <mesh geometry={GEO.sphere} material={mat(C.plant)} position={[0, 0.62, 0]} scale={[0.32, 0.38, 0.32]} castShadow />
      <mesh geometry={GEO.sphere} material={mat('#4f8a68')} position={[0.12, 0.85, 0.05]} scale={[0.2, 0.24, 0.2]} castShadow />
    </group>
  )
}

function LockedPod({ pod, building, unlocked }) {
  const item = CATALOG.find((c) => c.id === pod.id)
  const ready = !item.requires || unlocked.includes(item.requires)
  const coins = useOffice((s) => s.server?.office?.coins ?? 0)
  const edge = mat(C.accent, { emissive: C.accent, emissiveIntensity: building ? 0.5 : 0.15, transparent: true, opacity: building ? 0.7 : 0.25 })
  return (
    <group position={[pod.x, 0, pod.z]}>
      {[[0, -0.95, 3.1, 0.03], [0, 0.95, 3.1, 0.03], [-1.55, 0, 0.03, 1.9], [1.55, 0, 0.03, 1.9]].map(([x, z, w, d], i) => (
        <mesh key={i} geometry={GEO.box} material={edge} position={[x, 0.01, z]} scale={[w, 0.01, d]} />
      ))}
      {building && (
        <>
          <mesh geometry={GEO.box} position={[0, 0.4, 0]} scale={[2.9, 0.8, 1.6]}>
            <meshStandardMaterial color={C.accent} transparent opacity={0.07} depthWrite={false} />
          </mesh>
          <Html position={[0, 1.3, 0]} center zIndexRange={[40, 0]}>
            <button type="button" className={`price${ready && coins >= item.cost ? ' price-ok' : ''}`}
              disabled={!ready} onClick={() => buyItem(item.id)}>
              <span>{item.name.toLowerCase()}</span>
              <b>{ready ? item.cost.toLocaleString() : 'locked'}</b>
            </button>
          </Html>
        </>
      )}
    </group>
  )
}
