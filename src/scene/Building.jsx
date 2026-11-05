// The shell and the rooms: floor, walls, glass partitions, reception, the CEO
// office (the CEO), and whatever has been bought: lounge, meeting room, server
// room, decor. The north wall carries the task board and the shipping board.

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Grid, Html, Text } from '@react-three/drei'
import Character from './Character.jsx'
import { Block, Plant } from './Pods.jsx'
import { GEO, mat, C, useTheme } from './look.js'
import { FONT } from './fonts.js'
import { roomOpen } from './nav.js'
import { BUILDING, ROOMS, CEO_SEAT, CATALOG } from '../shared/office.js'
import { useOffice } from '../store.js'
import { buyItem } from '../net.js'

const { minX, maxX, minZ, maxZ } = BUILDING
const W = maxX - minX
const D = maxZ - minZ

export default function Building({ unlocked, building }) {
  return (
    <group>
      <Floor unlocked={unlocked} />
      <OuterWalls />
      <Rooms unlocked={unlocked} building={building} />
      <Lobby />
      <CeoOffice />
      {roomOpen('meeting', unlocked) && <MeetingRoom />}
      {roomOpen('lounge', unlocked) && <Lounge coffee={unlocked.includes('coffee')} />}
      {roomOpen('server', unlocked) && <ServerRoom />}
      <Boards neon={unlocked.includes('neon')} />
      {unlocked.includes('arcade') && <Arcade />}
      {unlocked.includes('plants') && (
        <>
          <Plant position={[-10.8, 0, -4.4]} scale={1.3} />
          <Plant position={[10.8, 0, -4.4]} scale={1.3} />
          <Plant position={[-6.6, 0, 8.4]} scale={1.2} />
          <Plant position={[6.6, 0, 8.4]} scale={1.2} />
        </>
      )}
    </group>
  )
}

function Floor({ unlocked }) {
  const T = useTheme()
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color={T.floor} roughness={0.92} />
      </mesh>
      <Grid position={[0, 0.004, 0]} args={[24, 13]} cellSize={1} cellThickness={0.6} cellColor={T.gridCell}
        sectionSize={4} sectionThickness={1} sectionColor={T.gridSection} fadeDistance={80} />
      {Object.entries(ROOMS).map(([id, r]) => {
        const open = roomOpen(id, unlocked)
        const color = id === 'server' && open ? T.floorServer : open ? T.floorRoom : T.lockedRoom
        return (
          <mesh key={id} rotation={[-Math.PI / 2, 0, 0]} position={[(r.x0 + r.x1) / 2, 0.003, (r.z0 + r.z1) / 2]} receiveShadow>
            <planeGeometry args={[r.x1 - r.x0, r.z1 - r.z0]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        )
      })}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 9.6]} receiveShadow>
        <planeGeometry args={[12, 4.6]} />
        <meshStandardMaterial color={T.lobbyFloor} roughness={0.9} />
      </mesh>
    </group>
  )
}

function OuterWalls() {
  const T = useTheme()
  const trim = { emissive: C.accent, emissiveIntensity: 0.35 }
  return (
    <group>
      <Block position={[0, 1.5, minZ]} size={[W + 0.2, 3, 0.2]} color={T.wall} />
      <Block position={[minX, 0.55, 0]} size={[0.2, 1.1, D]} color={T.wall} />
      <Block position={[maxX, 0.55, 0]} size={[0.2, 1.1, D]} color={T.wall} />
      <Block position={[(minX - 1.4) / 2, 0.45, maxZ]} size={[-1.4 - minX, 0.9, 0.2]} color={T.wall} />
      <Block position={[(maxX + 1.4) / 2, 0.45, maxZ]} size={[maxX - 1.4, 0.9, 0.2]} color={T.wall} />
      <Block position={[minX, 1.11, 0]} size={[0.22, 0.02, D]} color={C.accent} opts={trim} cast={false} />
      <Block position={[maxX, 1.11, 0]} size={[0.22, 0.02, D]} color={C.accent} opts={trim} cast={false} />
      <Block position={[0, 3.01, minZ]} size={[W, 0.02, 0.22]} color={C.accent} opts={trim} cast={false} />
      {[-17, -9, 9, 17].map((x) => (
        <mesh key={x} geometry={GEO.plane} position={[x, 1.75, minZ + 0.11]} scale={[3.2, 1.5, 1]}>
          <meshBasicMaterial color={T.window} toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}

function Glass({ position, size }) {
  const T = useTheme()
  return (
    <group>
      <mesh geometry={GEO.box} position={position} scale={size}>
        <meshStandardMaterial color={C.sky} transparent opacity={0.07} roughness={0.1} depthWrite={false} />
      </mesh>
      <Block position={[position[0], 2.62, position[2]]} size={[Math.max(size[0], 0.06), 0.05, Math.max(size[2], 0.06)]}
        color={T.wallTop} cast={false} />
    </group>
  )
}

// A partition along x (constant z) or along z (constant x), with an optional door.
function Partition({ axis, at, from, to, door, locked }) {
  const T = useTheme()
  const pieces = []
  const H = 2.6
  const segment = (a, b, key) => {
    const mid = (a + b) / 2
    const len = b - a
    if (len <= 0.01) return
    pieces.push(
      axis === 'x'
        ? <Glass key={key} position={[mid, H / 2, at]} size={[len, H, 0.06]} />
        : <Glass key={key} position={[at, H / 2, mid]} size={[0.06, H, len]} />,
    )
  }
  if (door == null) segment(from, to, 'all')
  else {
    segment(from, door - 0.85, 'a')
    segment(door + 0.85, to, 'b')
    if (locked) {
      pieces.push(
        axis === 'x'
          ? <Block key="door" position={[door, 1.1, at]} size={[1.7, 2.2, 0.08]} color={T.lockedDoor} />
          : <Block key="door" position={[at, 1.1, door]} size={[0.08, 2.2, 1.7]} color={T.lockedDoor} />,
      )
    }
  }
  return <group>{pieces}</group>
}

function Rooms({ unlocked, building }) {
  const { meeting, ceo, lounge, server } = ROOMS
  return (
    <group>
      <Partition axis="z" at={meeting.x1} from={meeting.z0} to={meeting.z1} />
      <Partition axis="x" at={meeting.z1} from={meeting.x0} to={meeting.x1} door={meeting.door.x} locked={!roomOpen('meeting', unlocked)} />
      <Partition axis="z" at={ceo.x0} from={ceo.z0} to={ceo.z1} />
      <Partition axis="x" at={ceo.z1} from={ceo.x0} to={ceo.x1} door={ceo.door.x} />
      <Partition axis="z" at={lounge.x1} from={lounge.z0} to={lounge.z1} door={lounge.door.z} locked={!roomOpen('lounge', unlocked)} />
      <Partition axis="x" at={lounge.z0} from={lounge.x0} to={lounge.x1} />
      <Partition axis="x" at={lounge.z1} from={lounge.x0} to={lounge.x1} />
      <Partition axis="z" at={server.x0} from={server.z0} to={server.z1} door={server.door.z} locked={!roomOpen('server', unlocked)} />
      <Partition axis="x" at={server.z0} from={server.x0} to={server.x1} />
      <Partition axis="x" at={server.z1} from={server.x0} to={server.x1} />
      <RoomLabel text="meeting room" x={meeting.door.x} z={meeting.z1 + 0.7} />
      <RoomLabel text="ceo" x={ceo.door.x} z={ceo.z1 + 0.7} />
      <RoomLabel text="lounge" x={lounge.x1 + 0.9} z={lounge.door.z} rotate />
      <RoomLabel text="server room" x={server.x0 - 0.9} z={server.door.z} rotate flip />
      {['meeting', 'lounge', 'server'].map((id) =>
        roomOpen(id, unlocked) ? null : <RoomForSale key={id} id={id} building={building} unlocked={unlocked} />,
      )}
    </group>
  )
}

function RoomLabel({ text, x, z, rotate = false, flip = false }) {
  const T = useTheme()
  return (
    <Text font={FONT.mono} fontSize={0.32} color={T.label} anchorX="center" anchorY="middle"
      position={[x, 0.012, z]} rotation={[-Math.PI / 2, 0, rotate ? (flip ? -Math.PI / 2 : Math.PI / 2) : 0]}>
      {text}
    </Text>
  )
}

function RoomForSale({ id, building, unlocked }) {
  const room = ROOMS[id]
  const item = CATALOG.find((c) => c.id === id)
  const coins = useOffice((s) => s.server?.office?.coins ?? 0)
  const ready = !item.requires || unlocked.includes(item.requires)
  return (
    <group position={[(room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2]}>
      <Text font={FONT.mono} fontSize={0.42} color="#3a3446" anchorX="center" anchorY="middle"
        position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        {`${item.name.toLowerCase()}\n${item.cost.toLocaleString()}`}
      </Text>
      {building && (
        <Html position={[0, 1.6, 0]} center zIndexRange={[40, 0]}>
          <button type="button" className={`price${ready && coins >= item.cost ? ' price-ok' : ''}`}
            disabled={!ready} onClick={() => buyItem(item.id)}>
            <span>{item.name.toLowerCase()}</span>
            <b>{item.cost.toLocaleString()}</b>
          </button>
        </Html>
      )}
    </group>
  )
}

function Lobby() {
  const T = useTheme()
  return (
    <group>
      <Block position={[0, 0.5, 8.6]} size={[3.2, 1.0, 0.7]} color={T.desk} />
      <Block position={[0, 1.02, 8.6]} size={[3.3, 0.05, 0.8]} color={T.deskEdge} />
      <Block position={[0, 0.55, 8.96]} size={[3.0, 0.03, 0.02]} color={C.accent} opts={{ emissive: C.accent, emissiveIntensity: 0.6 }} cast={false} />
      <Text font={FONT.mono} fontSize={0.2} color={C.accent} anchorX="center" anchorY="middle" position={[0, 0.78, 8.965]}>
        agent office
      </Text>
      {[-1, 1].map((side) => (
        <group key={side}>
          <Block position={[side * 3.8, 0.4, 11.45]} size={[4.4, 0.08, 0.55]} color={T.chair} />
          <Block position={[side * 3.8, 0.7, 11.72]} size={[4.4, 0.55, 0.08]} color={T.chair} />
          <Block position={[side * 3.8, 0.18, 11.45]} size={[4.2, 0.36, 0.4]} color={T.bench} />
        </group>
      ))}
      <Text font={FONT.mono} fontSize={0.14} color={T.label} anchorX="center" anchorY="middle"
        position={[0, 0.012, 10.3]} rotation={[-Math.PI / 2, 0, 0]}>
        lobby · agents without a desk wait here
      </Text>
    </group>
  )
}

const CEO_LOOK = { fem: true, skin: '#e8bf9f', hair: '#1d1a20', hairStyle: 0, skirt: true, skirtColor: '#2b2337', shirt: C.accent, blinkPhase: 0.71 }

function CeoOffice() {
  const ceo = useOffice((s) => s.server?.ceo)
  const select = useOffice((s) => s.select)
  const selected = useOffice((s) => s.selectedId === '__ceo__')
  const working = ceo?.state === 'working'
  return (
    <group>
      <Block position={[16, 0.74, -9.4]} size={[2.2, 0.06, 0.8]} color="#2d2638" />
      <Block position={[16, 0.37, -9.4]} size={[2.0, 0.72, 0.7]} color={C.desk} />
      <group position={[16, 0, -9.15]}>
        <Block position={[0, 1.08, 0]} size={[0.8, 0.45, 0.04]} color={C.bezel} />
        <mesh geometry={GEO.plane} position={[0, 1.08, -0.022]} rotation={[0, Math.PI, 0]} scale={[0.76, 0.41, 1]}>
          <meshBasicMaterial color={working ? '#1b1430' : '#0d0b12'} toneMapped={false} />
        </mesh>
      </group>
      <group position={[CEO_SEAT.x, 0, CEO_SEAT.z]} rotation={[0, CEO_SEAT.ry, 0]}>
        <Block position={[0, 0.44, -0.05]} size={[0.56, 0.08, 0.5]} color="#2b2337" />
        <Block position={[0, 0.85, -0.32]} size={[0.56, 0.75, 0.08]} color="#2b2337" />
        <Character look={CEO_LOOK} pose={working ? 'type' : 'idle'} accent={C.rose}
          onClick={(e) => {
            if (e.delta > 6) return
            e.stopPropagation()
            select('__ceo__', { x: CEO_SEAT.x, z: CEO_SEAT.z })
          }} />
        {selected && (
          <mesh geometry={GEO.cyl} material={mat(C.accent, { emissive: C.accent, emissiveIntensity: 0.6, transparent: true, opacity: 0.55 })}
            position={[0, 0.012, 0]} scale={[0.55, 0.01, 0.55]} />
        )}
        <Html position={[0, 1.75, 0]} center zIndexRange={[30, 0]}>
          <button type="button" className="tag tag-ceo" onClick={() => select('__ceo__', { x: CEO_SEAT.x, z: CEO_SEAT.z })}>
            <span className={`dot dot-${working ? 'working' : 'idle'}`} />
            <span className="tag-name">ceo</span>
          </button>
        </Html>
      </group>
      <Block position={[19.3, 0.32, -8.2]} size={[0.8, 0.45, 2.4]} color="#2b2337" />
      <Block position={[19.6, 0.65, -8.2]} size={[0.2, 0.6, 2.4]} color="#2b2337" />
      <Plant position={[13, 0, -11.2]} scale={1.2} />
      <Plant position={[19.2, 0, -11.2]} scale={1.1} />
    </group>
  )
}

function MeetingRoom() {
  const runs = useOffice((s) => s.server?.runs || [])
  const text = runs.length
    ? runs.map((run) => `${run.phase || run.state} · ${run.task}`).join('\n\n')
    : 'no runs live\n\nagents in a multi-agent run\ngather at this table'
  return (
    <group>
      <Block position={[-16.2, 0.74, -8.5]} size={[4.2, 0.07, 1.2]} color="#2d2638" />
      <Block position={[-16.2, 0.36, -8.5]} size={[3.6, 0.7, 0.5]} color={C.desk} />
      <group position={[-19.88, 0, -8.5]} rotation={[0, Math.PI / 2, 0]}>
        <Block position={[0, 1.6, 0]} size={[4.6, 2.0, 0.05]} color={C.bezel} />
        <mesh geometry={GEO.plane} position={[0, 1.6, 0.03]} scale={[4.4, 1.85, 1]}>
          <meshBasicMaterial color="#0f0d18" toneMapped={false} />
        </mesh>
        <Text font={FONT.mono} fontSize={0.12} color={C.accent} anchorX="left" anchorY="top" position={[-2.1, 2.45, 0.04]}>
          runs
        </Text>
        <Text font={FONT.mono} fontSize={0.085} lineHeight={1.35} color={C.dim} anchorX="left" anchorY="top"
          position={[-2.1, 2.25, 0.04]} maxWidth={4.2}>
          {text}
        </Text>
      </group>
    </group>
  )
}

function Lounge({ coffee }) {
  const T = useTheme()
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-16.4, 0.006, 1]} receiveShadow>
        <planeGeometry args={[5, 4.6]} />
        <meshStandardMaterial color={T.rug} roughness={1} />
      </mesh>
      <Block position={[-19.4, 0.3, 0]} size={[0.8, 0.4, 3.8]} color={T.couch} />
      <Block position={[-19.75, 0.65, 0]} size={[0.2, 0.6, 3.8]} color={T.couch} />
      <Block position={[-15.6, 0.3, 4.5]} size={[4, 0.4, 0.7]} color={T.couch} />
      <Block position={[-15.6, 0.65, 4.82]} size={[4, 0.6, 0.18]} color={T.couch} />
      <Block position={[-16.5, 0.22, 0.5]} size={[1.2, 0.08, 1.8]} color="#2d2638" />
      <Plant position={[-13, 0, -2.4]} />
      <Plant position={[-19.3, 0, 4.4]} scale={1.2} />
      {coffee && (
        <group position={[-13.4, 0, 3.7]}>
          <Block position={[0, 0.5, 0]} size={[0.8, 1.0, 1.6]} color={C.desk} />
          <Block position={[0, 1.2, -0.3]} size={[0.4, 0.4, 0.35]} color="#121017" />
          <Block position={[0.21, 1.2, -0.3]} size={[0.01, 0.06, 0.2]} color={C.warn} opts={{ emissive: C.warn, emissiveIntensity: 0.8 }} cast={false} />
          <Text font={FONT.mono} fontSize={0.1} color={C.warn} anchorX="center" position={[0.41, 0.8, 0]} rotation={[0, Math.PI / 2, 0]}>
            espresso
          </Text>
        </group>
      )}
    </group>
  )
}

function ServerRoom() {
  const usage = useOffice((s) => s.server?.usage || {})
  const meters = [
    ['claude 5h', usage.claude?.windows?.five_hour?.used],
    ['claude 7d', usage.claude?.windows?.seven_day?.used],
    ['codex 5h', usage.codex?.windows?.five_hour?.used],
    ['codex 7d', usage.codex?.windows?.seven_day?.used],
  ]
  return (
    <group>
      {meters.map(([label, used], i) => (
        <Rack key={label} z={-1.7 + i * 1.6} label={label} used={used} />
      ))}
      <Text font={FONT.mono} fontSize={0.16} color={C.faint} anchorX="center" position={[16, 0.012, 3.9]} rotation={[-Math.PI / 2, 0, 0]}>
        usage windows
      </Text>
    </group>
  )
}

function Rack({ z, label, used }) {
  const leds = useRef()
  const known = typeof used === 'number'
  const pct = known ? Math.max(0, Math.min(100, used)) : 0
  const color = !known ? C.faint : pct >= 95 ? C.bad : pct >= 80 ? C.warn : C.ok
  useFrame((state) => {
    if (!leds.current) return
    const t = state.clock.elapsedTime
    leds.current.children.forEach((child, i) => {
      child.material.emissiveIntensity = 0.4 + 0.6 * Math.max(0, Math.sin(t * (3 + i) + z * 3))
    })
  })
  const ledMats = useMemo(() => [0, 1, 2, 3, 4].map(() => mat(C.sky).clone()), [])
  ledMats.forEach((m) => {
    m.emissive.set(C.sky)
  })
  return (
    <group position={[19.1, 0, z]}>
      <Block position={[0, 1.05, 0]} size={[0.9, 2.1, 1.0]} color="#0e0d12" />
      <group ref={leds}>
        {ledMats.map((m, i) => (
          <mesh key={i} geometry={GEO.box} material={m} position={[-0.46, 0.4 + i * 0.12, -0.38]} scale={[0.01, 0.03, 0.05]} />
        ))}
      </group>
      <group position={[-0.46, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <Text font={FONT.mono} fontSize={0.11} color={C.dim} anchorX="center" position={[0, 1.85, 0]}>
          {label}
        </Text>
        <Text font={FONT.mono} fontSize={0.2} color={color} anchorX="center" position={[0, 1.6, 0]}>
          {known ? `${Math.round(pct)}%` : '–'}
        </Text>
        <mesh geometry={GEO.plane} position={[0, 1.3, 0.001]} scale={[0.7, 0.07, 1]}>
          <meshBasicMaterial color="#1c1924" toneMapped={false} />
        </mesh>
        <mesh geometry={GEO.plane} position={[-0.35 + (0.7 * pct) / 200, 1.3, 0.002]} scale={[Math.max(0.001, (0.7 * pct) / 100), 0.07, 1]}>
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function Boards({ neon }) {
  const tasks = useOffice((s) => s.server?.tasks || [])
  const office = useOffice((s) => s.server?.office)
  const taskText = tasks.length
    ? tasks.slice(0, 6).map((t) => `[${t.id}] ${t.text}`).join('\n\n')
    : 'nothing owed. suspicious.'
  const ledger = (office?.ledger || []).slice(0, 7)
  const ledgerText = ledger.length
    ? ledger.map((l) => `${l.amount > 0 ? '+' : ''}${l.amount}  ${l.text}`).join('\n')
    : 'waiting for the first merge'
  return (
    <group>
      <group position={[-5.6, 0, minZ + 0.13]}>
        <Block position={[0, 1.65, 0]} size={[6.2, 2.3, 0.05]} color="#16131d" />
        <Text font={FONT.mono} fontSize={0.15} color={C.accent} anchorX="left" anchorY="top" position={[-2.9, 2.65, 0.04]}>
          open tasks
        </Text>
        <Text font={FONT.mono} fontSize={0.092} lineHeight={1.3} color={C.dim} anchorX="left" anchorY="top"
          position={[-2.9, 2.4, 0.04]} maxWidth={5.8} clipRect={[-0.01, -1.85, 5.9, 0.01]}>
          {taskText}
        </Text>
      </group>
      <group position={[5.4, 0, minZ + 0.13]}>
        <Block position={[0, 1.65, 0]} size={[5.6, 2.3, 0.06]} color={C.bezel} />
        <mesh geometry={GEO.plane} position={[0, 1.65, 0.035]} scale={[5.4, 2.1, 1]}>
          <meshBasicMaterial color="#0c0f0d" toneMapped={false} />
        </mesh>
        <Text font={FONT.mono} fontSize={0.15} color={C.ok} anchorX="left" anchorY="top" position={[-2.55, 2.6, 0.04]}>
          {`shipping board · ${(office?.coins ?? 0).toLocaleString()} coins`}
        </Text>
        <Text font={FONT.mono} fontSize={0.09} lineHeight={1.45} color={C.dim} anchorX="left" anchorY="top"
          position={[-2.55, 2.35, 0.04]} maxWidth={5.1} clipRect={[-0.01, -1.6, 5.2, 0.01]}>
          {ledgerText}
        </Text>
      </group>
      {neon && (
        <Text font={FONT.mono} fontSize={0.42} color={C.rose} anchorX="center" position={[5.4, 3.12, minZ + 0.16]}
          outlineWidth={0.012} outlineColor={C.rose} outlineBlur={0.08}>
          ship it
        </Text>
      )}
    </group>
  )
}

function Arcade() {
  return (
    <group position={[-17, 0, 9.1]} rotation={[0, Math.PI / 2, 0]}>
      <Block position={[0, 0.85, 0]} size={[0.8, 1.7, 0.7]} color="#2a1f3a" />
      <mesh geometry={GEO.plane} position={[0, 1.25, 0.36]} rotation={[-0.25, 0, 0]} scale={[0.6, 0.45, 1]}>
        <meshBasicMaterial color="#3d2a66" toneMapped={false} />
      </mesh>
      <Text font={FONT.mono} fontSize={0.09} color={C.rose} anchorX="center" position={[0, 1.6, 0.36]}>
        merge conflict
      </Text>
    </group>
  )
}
