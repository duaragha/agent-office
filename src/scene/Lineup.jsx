// A row of people facing the camera, for checking how characters look.
// Open the office with #lineup in the URL.

import { Canvas } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import Character from './Character.jsx'
import { looksFor, C } from './look.js'
import { FONT } from './fonts.js'
import { NAMES } from '../shared/office.js'

const PICKS = ['Tess', 'Arlo', 'Nia', 'Milo', 'Dara', 'Remy', 'Sage', 'Ivo', 'Cleo', 'Oren']

export default function Lineup() {
  const people = PICKS.filter((n) => NAMES.includes(n)).map((name, i) => ({
    name,
    look: looksFor(`lineup-${name}-${i}`, i % 3 === 0 ? 'codex' : 'claude', name),
    x: (i - (PICKS.length - 1) / 2) * 0.95,
  }))
  return (
    <Canvas camera={{ position: [0, 1.25, 5.2], fov: 45 }} shadows="percentage">
      <color attach="background" args={['#cfe6fb']} />
      <hemisphereLight args={['#ffffff', '#d4c8b8', 1.5]} />
      <directionalLight position={[3, 6, 5]} intensity={2.6} castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[20, 10]} />
        <meshStandardMaterial color="#d9d3e1" />
      </mesh>
      {people.map((p) => (
        <group key={p.name} position={[p.x, 0, 0]}>
          <Character look={p.look} pose="stand" />
          <Text font={FONT.mono} fontSize={0.12} color={C.bezel} position={[0, 1.62, 0]} anchorX="center">
            {p.name.toLowerCase()}
          </Text>
        </group>
      ))}
    </Canvas>
  )
}
