// What agents say out loud: short lines picked from what they are really
// doing (the state change, the tool they just ran, their last message), plus a
// greeting when you walk up and the odd exchange between teammates. No model
// calls; every line is a template filled from the snapshot.

import { useEffect } from 'react'
import { useOffice } from './store.js'
import { sfx, speak } from './audio.js'
import { hashOf } from './shared/office.js'

const pick = (list, seed) => list[Math.abs(seed) % list.length]
const lastBark = new Map()
let lastAny = 0

function workLine(agent, seed) {
  const now = String(agent.now || '')
  const low = now.toLowerCase()
  if (/pytest|npm (run )?test|vitest|jest|cargo test|go test|node --test/.test(low)) {
    return pick(['running the tests…', 'tests going. fingers crossed.', 'waiting on the test run.'], seed)
  }
  if (low.startsWith('editing ') || low.startsWith('writing ')) return `in ${now.split(' ').slice(1).join(' ').slice(0, 40)} now.`
  if (/^\$ (git|gh) /.test(low)) return pick(['pushing this up.', 'opening the PR.', 'sorting out git.'], seed)
  if (low.startsWith('web:') || low.startsWith('searching')) return pick(['looking into it.', 'reading up on this.'], seed)
  if (low.startsWith('delegating') || low.includes('spawning')) return 'sending a helper on this.'
  if (low.startsWith('reading')) return pick(['reading through the code.', 'getting my bearings.'], seed)
  if (low.startsWith('$ ')) return pick(['running a few things.', 'checking something in the shell.'], seed)
  return pick(['on it.', 'back at it.', 'digging in.', 'making progress.'], seed)
}

function waitingLine(agent, seed) {
  const said = String(agent.lastSaid || '')
  if (/\bDONE:/.test(said)) return pick(['shipped it.', 'done. take a look?'], seed)
  if (/\bBLOCKED:/.test(said)) return "i'm stuck. need you."
  if (/NEEDS YOU:/.test(said)) return 'one call only you can make.'
  return pick(['your turn, boss.', 'need you for a sec.', 'ready for you.'], seed)
}

const REPLIES = ['nice.', "ping me when it's green.", 'same, almost there.', 'want a second pair of eyes?', 'go go go.']

function bark(agent, text, { loud = false, force = false } = {}) {
  const now = Date.now()
  if (!force && (now - (lastBark.get(agent.id) || 0) < 20_000 || now - lastAny < 2500)) return
  lastBark.set(agent.id, now)
  lastAny = now
  const store = useOffice.getState()
  store.bark(agent.id, text)
  const heard = loud || store.selectedId === agent.id || store.nearId === agent.id
  if (store.voice && heard) speak(agent.name, text, hashOf(agent.id))
}

export function useBarks() {
  useEffect(() => {
    let previous = null
    const unsubscribe = useOffice.subscribe((state, prior) => {
      const agents = state.server?.agents
      if (agents && agents !== prior.server?.agents) {
        const before = previous
        previous = new Map(agents.map((a) => [a.id, a]))
        if (!before) return // the first snapshot is the room as it is, not news
        const seed = Math.floor(Date.now() / 1000)
        for (const agent of agents) {
          const old = before.get(agent.id)
          if (!old) {
            bark(agent, pick(['reporting in.', 'hi all.', 'new here. where do i sit?'], seed + hashOf(agent.id)))
            continue
          }
          if ((agent.helpers?.length || 0) > (old.helpers?.length || 0)) {
            const n = agent.helpers.length
            bark(agent, `sending out ${n} helper${n === 1 ? '' : 's'}.`)
          }
          if (agent.state === old.state) continue
          if (agent.state === 'working') bark(agent, workLine(agent, seed))
          else if (agent.state === 'waiting') {
            bark(agent, waitingLine(agent, seed), { loud: true, force: true })
            sfx('chime')
          } else if (agent.state === 'done') bark(agent, pick(["that's done.", 'wrapped up.'], seed))
          else if (agent.state === 'blocked') bark(agent, pick(['out of quota. coffee break.', 'rate limited again…'], seed))
        }
      }
      if (state.nearId && state.nearId !== prior.nearId) {
        const agent = state.server?.agents?.find((a) => a.id === state.nearId)
        if (agent) bark(agent, pick(['hey boss.', "what's up?", 'oh hi.', 'need something?'], Date.now() >> 10))
      }
    })

    // Desk chatter: someone working says what they're on, and now and then a
    // teammate answers.
    const chatter = setInterval(() => {
      const agents = useOffice.getState().server?.agents || []
      const working = agents.filter((a) => a.state === 'working' && a.spot?.zone === 'desk')
      if (!working.length) return
      const seed = Math.floor(Date.now() / 1000)
      const speaker = working[seed % working.length]
      bark(speaker, workLine(speaker, seed))
      const mates = agents.filter((a) => a.team === speaker.team && a.id !== speaker.id && a.spot?.zone === 'desk')
      if (mates.length && seed % 3 === 0) {
        const mate = mates[seed % mates.length]
        setTimeout(() => bark(mate, pick(REPLIES, seed)), 2800)
      }
    }, 45_000)

    return () => {
      unsubscribe()
      clearInterval(chatter)
    }
  }, [])
}
