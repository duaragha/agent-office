import { useEffect, useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { useOffice } from './store.js'
import Building from './scene/Building.jsx'
import Pods from './scene/Pods.jsx'
import Agents from './scene/Agents.jsx'
import Player, { useKeyTracking } from './scene/Player.jsx'
import { buildObstacles, buildGrid } from './scene/nav.js'
import Hud from './hud/Hud.jsx'
import { PODS, STARTERS } from './shared/office.js'
import { isDaytime, THEMES } from './scene/look.js'
import { armAudio, setDaylight, sfx, startMusic, stopMusic } from './audio.js'
import { useBarks } from './barks.js'

function useSound(day) {
  const music = useOffice((s) => s.music)
  useEffect(() => {
    armAudio(() => {
      useOffice.getState().setAudioArmed()
      if (useOffice.getState().music) {
        startMusic()
        sfx('build') // so it's obvious sound works
      }
    })
  }, [])
  useEffect(() => {
    if (music) startMusic()
    else stopMusic()
  }, [music])
  useEffect(() => setDaylight(day), [day])
}

function typing() {
  const el = document.activeElement
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e) => {
      if (typing() || e.metaKey || e.ctrlKey || e.altKey) return
      const store = useOffice.getState()
      if (e.code === 'Tab') {
        e.preventDefault()
        store.toggleMode()
      } else if (e.code === 'KeyB') {
        store.setShop(!store.shopOpen)
      } else if (e.code === 'KeyM') {
        store.toggleMusic()
      } else if (e.code === 'KeyH') {
        store.setHireOpen(!store.hireOpen)
      } else if (e.code === 'KeyE' && store.mode === 'walk' && store.nearId) {
        store.select(store.nearId)
      } else if (e.code === 'Escape') {
        if (store.selectedId) store.select(null)
        else if (store.shopOpen) store.setShop(false)
        else if (store.hireOpen) store.setHireOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function Lights({ unlocked, day }) {
  return (
    <>
      <color attach="background" args={[day ? THEMES.day.bg : THEMES.night.bg]} />
      <hemisphereLight args={day ? ['#ffffff', '#d4c8b8', 1.5] : ['#d6ccff', '#1a1522', 1.15]} />
      <ambientLight intensity={day ? 0.5 : 0.3} />
      <directionalLight
        castShadow
        position={day ? [16, 30, 4] : [12, 22, 10]}
        intensity={day ? 3.2 : 2.1}
        color={day ? '#fff3de' : '#f3eeff'}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-camera-near={1}
        shadow-camera-far={70}
        shadow-bias={-0.0004}
      />
      {!day && PODS.filter((p) => unlocked.includes(p.id)).map((p) => (
        <pointLight key={p.id} position={[p.x, 2.7, p.z]} intensity={14} distance={9} decay={2} color="#ffe6cc" />
      ))}
      {!day && <pointLight position={[16, 2.6, -8.5]} intensity={6} distance={8} decay={2} color="#d9c9ff" />}
      {!day && <pointLight position={[0, 2.6, 9.5]} intensity={5} distance={9} decay={2} color="#d9c9ff" />}
    </>
  )
}

export default function App() {
  const server = useOffice((s) => s.server)
  const shopOpen = useOffice((s) => s.shopOpen)
  const day = useOffice((s) => isDaytime(s.light, s.hour))
  const unlocked = server?.office?.unlocked || STARTERS
  const key = unlocked.join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const obstacles = useMemo(() => buildObstacles(unlocked), [key])
  const grid = useMemo(() => buildGrid(obstacles), [obstacles])
  useKeyTracking()
  useHotkeys()
  useSound(day)
  useBarks()

  return (
    <div className="app">
      <Canvas
        shadows="percentage"
        dpr={[1, 1.75]}
        camera={{ fov: 45, position: [0, 21, 17], near: 0.1, far: 200 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={(e) => {
          if (e.button === 0 && useOffice.getState().mode === 'overview') useOffice.getState().select(null)
        }}
      >
        <Lights unlocked={unlocked} day={day} />
        <Building unlocked={unlocked} building={shopOpen} />
        <Pods unlocked={unlocked} agents={server?.agents || []} building={shopOpen} podTeams={server?.podTeams} />
        <Agents grid={grid} />
        <Player obstacles={obstacles} />
      </Canvas>
      <Hud />
    </div>
  )
}
