import { create } from 'zustand'

let toastSeq = 0
let reqSeq = 0

function savedLight() {
  try {
    const value = window.localStorage.getItem('office.light')
    return value === 'day' || value === 'night' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

function savedFlag(key, fallback) {
  try {
    const value = window.localStorage.getItem(key)
    return value == null ? fallback : value === '1'
  } catch {
    return fallback
  }
}

function keep(key, on) {
  try {
    window.localStorage.setItem(key, on ? '1' : '0')
  } catch {
    // private window: lasts until reload
  }
}

export const useOffice = create((set, get) => ({
  music: savedFlag('office.music', true),
  audioArmed: false,
  setAudioArmed: () => set({ audioArmed: true }),
  voice: savedFlag('office.voice', false),
  toggleMusic: () => {
    keep('office.music', !get().music)
    set({ music: !get().music })
  },
  toggleVoice: () => {
    keep('office.voice', !get().voice)
    set({ voice: !get().voice })
  },
  // A short line over someone's head; real replies are never overwritten by one.
  bark: (agentId, text) => {
    const current = get().bubbles[agentId]
    if (current && !current.bark && current.until > performance.now()) return
    set({ bubbles: { ...get().bubbles, [agentId]: { text, bark: true, until: performance.now() + 5500 } } })
  },
  connected: false,
  server: null,
  mode: 'overview', // 'overview' | 'walk'
  shopOpen: false,
  hireOpen: false,
  hire: { pending: false, ok: null, text: '' },
  selectedId: null,
  nearId: null,
  toasts: [],
  asks: {}, // agentId -> { reqId, question, pending, error }
  bubbles: {}, // agentId -> { text, until }
  flyTo: null, // { x, z, at } for the overview camera
  light: savedLight(), // 'auto' follows the clock: day 07:00-19:00
  hour: new Date().getHours(),

  setConnected: (connected) => set({ connected }),
  cycleLight: () => {
    const next = { auto: 'day', day: 'night', night: 'auto' }[get().light] || 'auto'
    try {
      window.localStorage.setItem('office.light', next)
    } catch {
      // private window: the choice lasts until reload
    }
    set({ light: next })
  },
  tick: () => {
    const hour = new Date().getHours()
    if (hour !== get().hour) set({ hour })
  },
  setServer: (server) => set({ server }),
  setMode: (mode) => set({ mode }),
  toggleMode: () => set({ mode: get().mode === 'walk' ? 'overview' : 'walk' }),
  setShop: (shopOpen) => set(shopOpen ? { shopOpen, hireOpen: false } : { shopOpen }),
  setHireOpen: (hireOpen) => set(hireOpen ? { hireOpen, shopOpen: false } : { hireOpen }),
  setHire: (hire) => set({ hire }),
  queueAsk: (agentId) => set({ asks: { ...get().asks, [agentId]: { ...(get().asks[agentId] || {}), queued: true } } }),
  setNear: (nearId) => {
    if (get().nearId !== nearId) set({ nearId })
  },
  select: (selectedId, position) =>
    set(position ? { selectedId, flyTo: { ...position, at: performance.now() } } : { selectedId }),
  toast: (text, amount = null, tone = 'ok') => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts, { id, text, amount, tone }].slice(-5) })
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), 6500)
  },
  startAsk: (agentId, question, mode = 'ask') => {
    const reqId = `q${++reqSeq}`
    set({ asks: { ...get().asks, [agentId]: { reqId, question, mode, pending: true, error: null } } })
    return reqId
  },
  finishAsk: (agentId, answer) => {
    set({
      asks: { ...get().asks, [agentId]: { ...(get().asks[agentId] || {}), pending: false, error: null, last: answer } },
      bubbles: { ...get().bubbles, [agentId]: { text: answer.a, until: performance.now() + 14000 } },
    })
  },
  failAsk: (agentId, error) =>
    set({ asks: { ...get().asks, [agentId]: { ...(get().asks[agentId] || {}), pending: false, error } } }),
}))

export function agentById(id) {
  return useOffice.getState().server?.agents?.find((a) => a.id === id) || null
}
