import { useOffice } from './store.js'
import { sfx, speak } from './audio.js'
import { hashOf } from './shared/office.js'

let socket = null
let retry = 0

function socketUrl() {
  const url = new URL('ws', window.location.href.replace(/[^/]*$/, ''))
  url.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return url
}

export function connect() {
  const store = useOffice.getState()
  socket = new WebSocket(socketUrl())
  socket.onopen = () => {
    retry = 0
    store.setConnected(true)
  }
  socket.onclose = () => {
    store.setConnected(false)
    setTimeout(connect, Math.min(10000, 600 * 2 ** retry++))
  }
  socket.onmessage = (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }
    handle(message)
  }
}

function handle(message) {
  const store = useOffice.getState()
  switch (message.type) {
    case 'state':
      store.setServer(message.state)
      break
    case 'toast':
      store.toast(message.text, message.amount, message.tone || (message.amount < 0 ? 'accent' : 'ok'))
      if (message.built) sfx('build')
      else if (message.amount > 0) sfx('coin')
      break
    case 'thinking':
      if (message.queued) store.queueAsk(message.agentId)
      break
    case 'hired':
      store.setHire({ pending: false, ok: message.ok, text: message.text })
      break
    case 'answer': {
      store.finishAsk(message.agentId, { q: message.q, a: message.a, at: message.at })
      const agent = store.server?.agents?.find((a) => a.id === message.agentId)
      if (agent && store.voice && store.selectedId === agent.id) speak(agent.name, message.a, hashOf(agent.id))
      sfx('pop')
      break
    }
    case 'askError':
      store.failAsk(message.agentId, message.error)
      break
    case 'buyResult':
      if (!message.ok) store.toast(message.error || 'Could not build that', null, 'bad')
      break
    default:
      break
  }
}

export function send(message) {
  if (socket?.readyState === 1) {
    socket.send(JSON.stringify(message))
    return true
  }
  return false
}

// mode 'ask' reads the agent's transcript; 'send' types into its real session.
export function askAgent(agentId, question, mode = 'ask') {
  const store = useOffice.getState()
  const reqId = store.startAsk(agentId, question, mode)
  if (!send({ type: 'ask', agentId, question, reqId, mode })) store.failAsk(agentId, 'Not connected to the office')
}

export function buyItem(item) {
  if (!send({ type: 'buy', item })) useOffice.getState().toast('Not connected to the office', null, 'bad')
}

export function hireAgent({ machine, agent, project, task }) {
  const store = useOffice.getState()
  store.setHire({ pending: true, ok: null, text: '' })
  if (!send({ type: 'hire', machine, agent, project, task, reqId: `h${Date.now()}` })) {
    store.setHire({ pending: false, ok: false, text: 'Not connected to the office' })
  }
}
