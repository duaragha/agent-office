// Agent office hub: serves the built client, takes snapshots from each
// machine's feeder, decides who sits where, runs the shop, and relays "ask"
// questions to the feeder that can read the agent's transcript.
//
// Feeders authenticate with OFFICE_TOKEN. Browsers are trusted by the tailnet
// like the other private sites, but every websocket must come from an allowed
// origin so a stray page in the same browser cannot drive the shop or the asks.

import { createServer } from 'node:http'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, createReadStream } from 'node:fs'
import { join, extname, normalize, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { WebSocketServer } from 'ws'
import {
  CATALOG, STARTERS, REWARDS, STATE_RANK, seatsFor, SEAT_OFFSETS, LOBBY_SPOTS, LOUNGE_SPOTS, MEETING_SPOTS, NAMES, hashOf,
} from '../src/shared/office.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.OFFICE_PORT || 8825)
const HOST = process.env.OFFICE_HOST || '0.0.0.0'
const BASE = (process.env.OFFICE_BASE_PATH || '/office').replace(/\/$/, '')
const DIST = process.env.OFFICE_DIST || join(HERE, '..', 'dist')
const DATA_DIR = process.env.OFFICE_DATA || join(HERE, '..', '.data')
const TOKEN = process.env.OFFICE_TOKEN || ''
// The origin(s) the office is served from, e.g. https://office.example.com
const ALLOWED_ORIGINS = (process.env.OFFICE_ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)
const VERSION = '0.1.0'
const MACHINE_STALE_MS = 30_000
const ASK_TIMEOUT_MS = 90_000
const SEND_TIMEOUT_MS = 40 * 60_000 // a busy session gets the message when it pauses, then may work a while
const HIRE_TIMEOUT_MS = 3 * 60_000
const ASKS_PER_HOUR = 60

const STATE_FILE = join(DATA_DIR, 'office.json')
mkdirSync(DATA_DIR, { recursive: true })

function loadSaved() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { unlocked: [...STARTERS], earned: 0, spent: 0, credited: {}, ledger: [], seats: {}, firstSeen: {} }
  }
}

const saved = loadSaved()
saved.unlocked ||= [...STARTERS]
saved.credited ||= {}
saved.ledger ||= []
saved.seats ||= {}
saved.podTeams ||= {}
saved.firstSeen ||= {}
saved.names ||= {}

let saveTimer = null
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const tmp = `${STATE_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify(saved))
    renameSync(tmp, STATE_FILE)
  }, 800)
}

const machines = new Map() // machine -> { at, receivedAt, snapshot }
const conversations = new Map(Object.entries(saved.conversations || {})) // agentId -> [{q, a, at, mode}]
const jobs = new Map() // id -> job
const waiters = new Map() // machine -> [res]
const askTimes = []
const answers = new Map() // agent + its last activity + question -> answer, so a repeat costs nothing
let merged = emptyState()

function emptyState() {
  return { agents: [], ceo: { state: 'idle' }, runs: [], usage: {}, tasks: [], machines: {}, capabilities: {} }
}

// --- economy --------------------------------------------------------------

function coins() {
  return Math.max(0, Math.round(saved.earned - saved.spent))
}

function credit(economy) {
  const fresh = []
  for (const pr of economy?.prs || []) {
    const key = `pr:${pr.key}`
    if (saved.credited[key]) continue
    saved.credited[key] = Date.now()
    fresh.push({ kind: 'pr', amount: REWARDS.pr, text: `PR merged: ${pr.title || pr.key}`, at: pr.at })
  }
  for (const commit of economy?.commits || []) {
    const key = `commit:${commit.key}`
    if (saved.credited[key]) continue
    saved.credited[key] = Date.now()
    fresh.push({ kind: 'commit', amount: REWARDS.commit, text: `Commit: ${commit.title || commit.key}`, at: commit.at })
  }
  for (const run of economy?.runs || []) {
    const key = `run:${run.id}`
    if (saved.credited[key]) continue
    saved.credited[key] = Date.now()
    fresh.push({ kind: 'run', amount: REWARDS.run, text: `Run delivered: ${run.task}`, at: run.at })
  }
  if (!fresh.length) return
  const total = fresh.reduce((sum, item) => sum + item.amount, 0)
  saved.earned += total
  const welcome = !saved.welcomed
  saved.welcomed = true
  if (welcome) {
    const prs = fresh.filter((f) => f.kind === 'pr').length
    const runs = fresh.filter((f) => f.kind === 'run').length
    const commits = fresh.filter((f) => f.kind === 'commit').length
    const text = `Opening bonus: ${prs} PRs, ${runs} runs and ${commits} commits this week`
    saved.ledger.unshift({ text, amount: total, at: Date.now() })
    broadcast({ type: 'toast', text, amount: total })
  } else {
    for (const item of fresh) {
      saved.ledger.unshift({ text: item.text, amount: item.amount, at: Date.now() })
      broadcast({ type: 'toast', text: item.text, amount: item.amount })
    }
  }
  saved.ledger = saved.ledger.slice(0, 30)
  save()
}

function buy(itemId) {
  const item = CATALOG.find((c) => c.id === itemId)
  if (!item) return { ok: false, error: 'No such item' }
  if (saved.unlocked.includes(item.id)) return { ok: false, error: 'Already built' }
  if (item.requires && !saved.unlocked.includes(item.requires)) {
    const needed = CATALOG.find((c) => c.id === item.requires)
    return { ok: false, error: `Build ${needed?.name || item.requires} first` }
  }
  if (coins() < item.cost) return { ok: false, error: `Needs ${item.cost - coins()} more coins` }
  saved.spent += item.cost
  saved.unlocked.push(item.id)
  saved.ledger.unshift({ text: `Built ${item.name}`, amount: -item.cost, at: Date.now() })
  saved.ledger = saved.ledger.slice(0, 30)
  save()
  recompute()
  broadcast({ type: 'toast', text: `Built ${item.name}`, amount: -item.cost, built: item.id })
  return { ok: true }
}

// --- merging and seating --------------------------------------------------

function rank(agent) {
  return STATE_RANK[agent.state] ?? 6
}

function recompute() {
  const now = Date.now()
  const byId = new Map()
  let ceo = { state: 'idle', lastActive: 0 }
  const usage = {}
  const usageAt = {}
  let tasks = []
  const runs = []
  const capabilities = {}
  const machineInfo = {}
  for (const [name, entry] of machines) {
    const online = now - entry.receivedAt < MACHINE_STALE_MS
    machineInfo[name] = {
      online, at: entry.receivedAt, agents: entry.snapshot.agents?.length || 0, capabilities: entry.snapshot.capabilities || {},
    }
    if (!online) continue
    const snap = entry.snapshot
    for (const agent of snap.agents || []) {
      const prior = byId.get(agent.id)
      // A chat can show up on both machines (transcripts sync). The machine
      // whose pane hosts it knows its real state; otherwise the fresher one wins.
      if (!prior || (agent.pane && !prior.pane) || (agent.pane === prior.pane && agent.lastActive > prior.lastActive)) {
        byId.set(agent.id, agent)
      }
    }
    if (snap.ceo?.state === 'working') ceo = snap.ceo
    // Both machines share the same accounts; keep whichever reading actually has windows.
    for (const [provider, reading] of Object.entries(snap.usage || {})) {
      const known = Object.keys(reading?.windows || {}).length > 0
      const have = Object.keys(usage[provider]?.windows || {}).length > 0
      if (known && (!have || entry.receivedAt >= (usageAt[provider] || 0))) {
        usage[provider] = reading
        usageAt[provider] = entry.receivedAt
      } else if (!have && !usage[provider]) {
        usage[provider] = reading
      }
    }
    if (snap.tasks?.length) tasks = snap.tasks
    runs.push(...(snap.runs || []))
    for (const [key, on] of Object.entries(snap.capabilities || {})) if (on) capabilities[key] = true
  }

  const agents = [...byId.values()]
  for (const agent of agents) {
    saved.firstSeen[agent.id] ||= now
    agent.firstSeen = saved.firstSeen[agent.id]
    agent.conversation = conversations.get(agent.id) || []
  }
  nameAgents(agents)
  assignRoles(agents)
  place(agents)
  merged = { agents, ceo, runs, usage, tasks, machines: machineInfo, capabilities, podTeams: { ...saved.podTeams } }
}

// Everyone present gets a distinct first name, and keeps it between visits.
function nameAgents(agents) {
  const used = new Set()
  const ordered = [...agents].sort((a, b) => a.firstSeen - b.firstSeen)
  for (const agent of ordered) {
    const kept = saved.names[agent.id]
    if (kept && !used.has(kept)) {
      agent.name = kept
      used.add(kept)
    }
  }
  for (const agent of ordered) {
    if (agent.name) continue
    let index = hashOf(agent.id) % NAMES.length
    for (let tries = 0; used.has(NAMES[index]) && tries < NAMES.length; tries++) index = (index + 1) % NAMES.length
    agent.name = used.has(NAMES[index]) ? `${NAMES[index]} ${agent.id.slice(0, 2)}` : NAMES[index]
    used.add(agent.name)
    saved.names[agent.id] = agent.name
  }
  const ids = Object.keys(saved.names)
  if (ids.length > 600) for (const id of ids.slice(0, ids.length - 600)) delete saved.names[id]
}

function assignRoles(agents) {
  const teams = new Map()
  for (const agent of agents) {
    const team = agent.run ? `run:${agent.run.runId}` : agent.project
    agent.team = team
    if (!teams.has(team)) teams.set(team, [])
    teams.get(team).push(agent)
  }
  for (const members of teams.values()) {
    const lead = members.length > 1
      ? [...members].sort((a, b) => (b.pane - a.pane) || (a.firstSeen - b.firstSeen))[0]
      : null
    for (const agent of members) agent.role = agent === lead ? 'lead' : 'employee'
    for (const agent of members) {
      if (agent.parent && members.some((m) => m.id === agent.parent)) agent.role = 'employee'
    }
  }
}

// Each pod belongs to one team (a repository, or a multi-agent run), so agents
// on different repositories never share a table. A team keeps its pods while any
// of its agents is present; teams without a pod wait in the lobby.
function place(agents) {
  const seats = seatsFor(saved.unlocked)
  const pods = [...new Set(seats.map((s) => s.pod))]
  const meetingOpen = saved.unlocked.includes('meeting')
  const loungeOpen = saved.unlocked.includes('lounge')
  const deskless = (a) => meetingOpen && a.run
  const teams = new Map()
  for (const agent of agents) {
    if (deskless(agent)) continue
    if (!teams.has(agent.team)) teams.set(agent.team, [])
    teams.get(agent.team).push(agent)
  }
  for (const members of teams.values()) {
    members.sort((a, b) => rank(a) - rank(b) || (b.lastActive || 0) - (a.lastActive || 0))
  }

  // Pods stay with the team that had them, unless that team left.
  for (const [pod, team] of Object.entries(saved.podTeams)) {
    if (!pods.includes(pod) || !teams.has(team)) delete saved.podTeams[pod]
  }
  const podsOf = (team) => pods.filter((pod) => saved.podTeams[pod] === team)
  const freePods = () => pods.filter((pod) => !saved.podTeams[pod])
  const ordered = [...teams.entries()].sort(
    ([, a], [, b]) => rank(a[0]) - rank(b[0]) || b.length - a.length,
  )
  for (const [team, members] of ordered) {
    const want = Math.ceil(members.length / SEAT_OFFSETS.length)
    while (podsOf(team).length < want && freePods().length) saved.podTeams[freePods()[0]] = team
  }
  // A team left in the lobby takes a pod from the team with the fewest people
  // working or waiting, if it has more of them. Strictly more, so pods don't flap.
  const active = (team) => (teams.get(team) || []).filter((a) => rank(a) <= STATE_RANK.blocked).length
  for (const [team] of ordered) {
    if (podsOf(team).length || !active(team)) continue
    const victim = Object.entries(saved.podTeams)
      .map(([pod, other]) => ({ pod, score: active(other) }))
      .filter((v) => v.score < active(team))
      .sort((a, b) => a.score - b.score)[0]
    if (victim) saved.podTeams[victim.pod] = team
  }

  for (const id of Object.keys(saved.seats)) {
    const agent = agents.find((a) => a.id === id)
    const pod = String(saved.seats[id]).split(':')[0]
    if (!agent || deskless(agent) || saved.podTeams[pod] !== agent.team) delete saved.seats[id]
  }
  const taken = new Set(Object.values(saved.seats))
  for (const [team, members] of teams) {
    const mine = seats.filter((s) => saved.podTeams[s.pod] === team)
    for (const agent of members) {
      if (saved.seats[agent.id]) continue
      const seat = mine.find((s) => !taken.has(s.id))
      if (!seat) break
      taken.add(seat.id)
      saved.seats[agent.id] = seat.id
    }
  }

  let lobby = 0
  let lounge = 0
  let meeting = 0
  for (const agent of agents) {
    const seat = saved.seats[agent.id] || null
    agent.seat = seat
    if (deskless(agent) && meeting < MEETING_SPOTS.length) {
      agent.spot = { zone: 'meeting', index: meeting++ }
    } else if (seat && !(loungeOpen && agent.state === 'asleep' && lounge < LOUNGE_SPOTS.length)) {
      agent.spot = { zone: 'desk', seat }
    } else if (loungeOpen && rank(agent) >= STATE_RANK.done && lounge < LOUNGE_SPOTS.length) {
      agent.spot = { zone: 'lounge', index: lounge++ }
    } else {
      agent.spot = { zone: 'lobby', index: lobby++ % LOBBY_SPOTS.length }
    }
  }
  save()
}

function publicState() {
  return {
    ...merged,
    office: {
      unlocked: saved.unlocked,
      coins: coins(),
      earned: Math.round(saved.earned),
      ledger: saved.ledger.slice(0, 12),
      desks: seatsFor(saved.unlocked).length,
    },
    catalog: CATALOG,
    version: VERSION,
  }
}

// --- asks -----------------------------------------------------------------

function ask(agentId, question, reqId, mode = 'ask') {
  const agent = merged.agents.find((a) => a.id === agentId)
  if (!agent) return { ok: false, error: 'That agent left the office' }
  if (mode === 'send' && !agent.pane) return { ok: false, error: `${agent.name} has no open pane to type into` }
  const now = Date.now()
  while (askTimes.length && now - askTimes[0] > 3_600_000) askTimes.shift()
  if (askTimes.length >= ASKS_PER_HOUR) return { ok: false, error: 'Too many questions this hour' }
  if ([...jobs.values()].some((j) => j.agentId === agentId && !j.done)) {
    return { ok: false, error: `${agent.name} is still answering` }
  }
  const text = String(question || 'What are you working on?').slice(0, 600)
  const history = (conversations.get(agentId) || []).slice(-6)
  const key = mode === 'ask'
    ? `${agentId}|${agent.lastActive}|${agent.state}|${history.length}|${text.trim().toLowerCase()}`
    : null
  const cached = key && answers.get(key)
  if (cached) {
    finish({ id: randomUUID(), agentId, question: text, reqId, mode, done: false }, cached)
    return { ok: true }
  }
  askTimes.push(now)
  const job = {
    id: randomUUID(),
    machine: agent.machine,
    agentId,
    question: text,
    name: agent.name,
    mode,
    history,
    key,
    reqId,
    at: now,
    done: false,
    claimed: false,
  }
  jobs.set(job.id, job)
  broadcast({ type: 'thinking', agentId, reqId, mode, queued: mode === 'send' && agent.state === 'working' })
  wake(job.machine)
  setTimeout(() => {
    if (job.done) return
    finish(job, mode === 'send'
      ? `(No reply from ${agent.name} yet. The message is in the real session on the ${agent.machine}; check the pane.)`
      : `(${agent.name} couldn't be reached on the ${agent.machine}.) Last seen: ${agent.now || 'nothing yet'}.`)
  }, mode === 'send' ? SEND_TIMEOUT_MS : ASK_TIMEOUT_MS)
  return { ok: true }
}

// Hiring opens a new chat on a machine; the agent then shows up through that
// machine's feeder like any other.
function hire({ machine, agent, project, task, reqId }) {
  const desks = seatsFor(saved.unlocked).length
  const seated = merged.agents.filter((a) => a.seat).length
  if (seated >= desks) return { ok: false, error: 'Every desk is taken. Build another pod first.' }
  if (!merged.machines[machine]?.online) return { ok: false, error: `The ${machine} isn't feeding the office` }
  const text = String(task || '').trim().slice(0, 4000)
  if (!text) return { ok: false, error: 'Give the new hire a task' }
  const job = {
    id: randomUUID(), machine, mode: 'hire', agent: agent === 'codex' ? 'codex' : 'claude',
    project: String(project || '').slice(0, 120), task: text, reqId, at: Date.now(), done: false, claimed: false,
  }
  jobs.set(job.id, job)
  wake(machine)
  setTimeout(() => finish(job, '(The hire did not start in time. Check the feeder on that machine.)'), HIRE_TIMEOUT_MS)
  return { ok: true }
}

function finish(job, text) {
  if (job.done) return
  job.done = true
  if (job.mode === 'hire') {
    const ok = !String(text).startsWith('(')
    broadcast({ type: 'hired', reqId: job.reqId, ok, text })
    broadcast({ type: 'toast', text: String(text).replace(/^\(|\)$/g, ''), amount: null, tone: ok ? 'ok' : 'bad' })
    setTimeout(() => jobs.delete(job.id), 60_000)
    return
  }
  const entry = { q: job.question, a: String(text).slice(0, 4000), at: Date.now(), mode: job.mode || 'ask' }
  const list = conversations.get(job.agentId) || []
  list.push(entry)
  conversations.set(job.agentId, list.slice(-10))
  // Keep conversations across restarts, for the agents seen most recently.
  saved.conversations = Object.fromEntries([...conversations.entries()].slice(-150))
  save()
  broadcast({ type: 'answer', agentId: job.agentId, reqId: job.reqId, ...entry })
  recompute()
  scheduleBroadcast()
  setTimeout(() => jobs.delete(job.id), 60_000)
}

function pendingFor(machine) {
  return [...jobs.values()].filter((j) => j.machine === machine && !j.claimed && !j.done)
}

function wake(machine) {
  const list = waiters.get(machine) || []
  waiters.set(machine, [])
  for (const res of list) respondJobs(res, machine)
}

function respondJobs(res, machine) {
  const list = pendingFor(machine)
  for (const job of list) job.claimed = true
  sendJson(res, 200, {
    jobs: list.map(({ id, agentId, name, question, mode, history, agent, project, task }) => (
      { id, agentId, name, question, mode, history, agent, project, task })),
  })
}

// --- http -----------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary',
}

const CSP = [
  "default-src 'self'", "script-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
  "font-src 'self' data:", "connect-src 'self' data: blob:", "worker-src 'self' blob:", "frame-ancestors 'self'",
].join('; ')

function sendJson(res, status, body) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(data) })
  res.end(data)
}

function authorized(req) {
  const header = String(req.headers.authorization || '')
  if (!TOKEN || !header.startsWith('Bearer ')) return false
  const given = Buffer.from(header.slice(7))
  const want = Buffer.from(TOKEN)
  return given.length === want.length && timingSafeEqual(given, want)
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function serveStatic(req, res, rel) {
  const clean = normalize(rel).replace(/^(\.\.[/\\])+/, '')
  let file = join(DIST, clean)
  if (!file.startsWith(DIST)) return sendJson(res, 403, { error: 'forbidden' })
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  if (!existsSync(file)) return sendJson(res, 404, { error: 'client not built' })
  const isIndex = file.endsWith('index.html')
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] || 'application/octet-stream',
    'Cache-Control': isIndex ? 'no-cache' : 'public, max-age=31536000, immutable',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  })
  createReadStream(file).pipe(res)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local')
  let path = url.pathname
  if (path === BASE) {
    res.writeHead(301, { Location: `${BASE}/` })
    return res.end()
  }
  if (!path.startsWith(`${BASE}/`)) return sendJson(res, 404, { error: 'not found' })
  path = path.slice(BASE.length)

  try {
    if (path === '/api/version') return sendJson(res, 200, { ok: true, version: VERSION, machines: merged.machines })
    if (path === '/api/state' && req.method === 'GET') return sendJson(res, 200, publicState())

    if (path === '/api/ingest' && req.method === 'POST') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const snapshot = await readBody(req)
      const machine = String(snapshot.machine || '').slice(0, 40)
      if (!machine) return sendJson(res, 400, { error: 'machine required' })
      machines.set(machine, { receivedAt: Date.now(), snapshot })
      credit(snapshot.economy)
      recompute()
      scheduleBroadcast()
      return sendJson(res, 200, { ok: true })
    }

    if (path === '/api/jobs' && req.method === 'GET') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const machine = String(url.searchParams.get('machine') || '')
      if (pendingFor(machine).length) return respondJobs(res, machine)
      const list = waiters.get(machine) || []
      list.push(res)
      waiters.set(machine, list)
      const timer = setTimeout(() => {
        const current = waiters.get(machine) || []
        const index = current.indexOf(res)
        if (index >= 0) {
          current.splice(index, 1)
          sendJson(res, 200, { jobs: [] })
        }
      }, 25_000)
      res.on('close', () => clearTimeout(timer))
      return
    }

    const jobMatch = path.match(/^\/api\/jobs\/([0-9a-f-]{36})$/)
    if (jobMatch && req.method === 'POST') {
      if (!authorized(req)) return sendJson(res, 401, { error: 'unauthorized' })
      const job = jobs.get(jobMatch[1])
      if (!job) return sendJson(res, 404, { error: 'no such job' })
      const body = await readBody(req, 64_000)
      // Only a real answer from a feeder is worth reusing; timeouts are not.
      if (job.key && body.text && !job.done) {
        answers.set(job.key, String(body.text))
        if (answers.size > 300) answers.delete(answers.keys().next().value)
      }
      finish(job, body.text || '')
      return sendJson(res, 200, { ok: true })
    }

    if (path.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' })
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method not allowed' })
    return serveStatic(req, res, path === '/' ? 'index.html' : path.slice(1))
  } catch (error) {
    return sendJson(res, 400, { error: String(error.message || error) })
  }
})

// --- websocket --------------------------------------------------------------

const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384 })

function originAllowed(origin) {
  if (!origin) return false
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const { hostname, protocol } = new URL(origin)
    return protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')
  } catch {
    return false
  }
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://local')
  if (url.pathname !== `${BASE}/ws` || !originAllowed(req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws))
})

wss.on('connection', (ws) => {
  ws.isAlive = true
  ws.on('pong', () => { ws.isAlive = true })
  ws.send(JSON.stringify({ type: 'state', state: publicState() }))
  ws.on('message', (raw) => {
    let message
    try {
      message = JSON.parse(String(raw))
    } catch {
      return
    }
    if (message.type === 'buy') {
      const result = buy(String(message.item || ''))
      ws.send(JSON.stringify({ type: 'buyResult', item: message.item, ...result }))
      scheduleBroadcast(0)
    } else if (message.type === 'hire') {
      const result = hire({ ...message, machine: String(message.machine || '') })
      if (!result.ok) ws.send(JSON.stringify({ type: 'hired', reqId: message.reqId, ok: false, text: result.error }))
    } else if (message.type === 'ask') {
      const result = ask(String(message.agentId || ''), message.question, message.reqId, message.mode === 'send' ? 'send' : 'ask')
      if (!result.ok) ws.send(JSON.stringify({ type: 'askError', agentId: message.agentId, reqId: message.reqId, error: result.error }))
    }
  })
})

function broadcast(message) {
  const data = JSON.stringify(message)
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data)
  }
}

let broadcastTimer = null
function scheduleBroadcast(delay = 250) {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcast({ type: 'state', state: publicState() })
  }, delay)
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate()
      continue
    }
    ws.isAlive = false
    ws.ping()
  }
  // Drop machines that stopped feeding.
  const before = JSON.stringify(merged.machines)
  recompute()
  if (JSON.stringify(merged.machines) !== before) scheduleBroadcast()
}, 10_000)

server.listen(PORT, HOST, () => {
  console.log(`[office-hub] ${VERSION} on http://${HOST}:${PORT}${BASE}/ (token ${TOKEN ? 'set' : 'MISSING'})`)
})
