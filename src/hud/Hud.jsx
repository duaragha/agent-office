// Everything drawn over the 3D view: status bar, alerts, the agent panel,
// the shop, toasts and the mode switcher.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useOffice } from '../store.js'
import { askAgent, buyItem, hireAgent } from '../net.js'
import { positions } from '../scene/registry.js'
import { STATE_LABEL } from '../scene/look.js'
import { CATALOG, REWARDS, LOBBY_SPOTS, isFemaleName } from '../shared/office.js'

const QUICK = ['What are you working on?', 'Are you stuck on anything?', "What's left before you're done?"]

function ago(seconds) {
  if (!seconds) return 'unknown'
  const s = Math.max(0, Date.now() / 1000 - seconds)
  if (s < 60) return `${Math.round(s)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

function until(epoch) {
  if (!epoch) return ''
  const s = epoch - Date.now() / 1000
  if (s <= 0) return 'resetting'
  if (s < 3600) return `resets in ${Math.round(s / 60)}m`
  if (s < 86400) return `resets in ${Math.round(s / 3600)}h`
  return `resets in ${Math.round(s / 86400)}d`
}

function focusAgent(id) {
  const p = positions.get(id)
  useOffice.getState().select(id, p ? { x: p.x, z: p.z } : undefined)
}

export default function Hud() {
  const connected = useOffice((s) => s.connected)
  const server = useOffice((s) => s.server)
  const selectedId = useOffice((s) => s.selectedId)
  const shopOpen = useOffice((s) => s.shopOpen)
  return (
    <div className="hud">
      <TopBar connected={connected} server={server} />
      <Alerts server={server} />
      {selectedId === '__ceo__' && <CeoPanel server={server} />}
      {selectedId && selectedId !== '__ceo__' && <AgentPanel id={selectedId} />}
      {shopOpen && <Shop server={server} />}
      <HirePanel server={server} />
      <NearPrompt />
      <SoundPrompt />
      <ModeBar />
      <Toasts />
      {!connected && <div className="banner">connecting to the office…</div>}
      {connected && server && !Object.values(server.machines || {}).some((m) => m.online) && (
        <div className="banner">no feeders online · run feeder/feeder.py on a machine with agents</div>
      )}
    </div>
  )
}

function TopBar({ connected, server }) {
  const office = server?.office
  const agents = server?.agents || []
  const counts = useMemo(() => {
    const c = { working: 0, waiting: 0, lobby: 0 }
    for (const a of agents) {
      if (a.state === 'working') c.working++
      if (a.state === 'waiting') c.waiting++
      if (a.spot?.zone === 'lobby') c.lobby++
    }
    return c
  }, [agents])
  const seated = agents.filter((a) => a.seat).length
  const [bump, setBump] = useState(false)
  const last = useRef(office?.coins)
  useEffect(() => {
    if (office?.coins !== last.current) {
      last.current = office?.coins
      setBump(true)
      const t = setTimeout(() => setBump(false), 700)
      return () => clearTimeout(t)
    }
    return undefined
  }, [office?.coins])
  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">agent office</span>
        <span className={`pill ${connected ? 'pill-ok' : 'pill-bad'}`}>{connected ? 'live' : 'offline'}</span>
        {Object.entries(server?.machines || {}).map(([name, m]) => (
          <span key={name} className={`pill ${m.online ? '' : 'pill-bad'}`}>{`${name} · ${m.agents}`}</span>
        ))}
      </div>
      <div className="stats">
        <div className={`stat coins${bump ? ' bump' : ''}`}>
          <span className="label">coins</span>
          <b>{(office?.coins ?? 0).toLocaleString()}</b>
        </div>
        <div className="stat">
          <span className="label">desks</span>
          <b>{`${seated}/${office?.desks ?? 0}`}</b>
        </div>
        <div className="stat">
          <span className="label">working</span>
          <b>{counts.working}</b>
        </div>
        <div className={`stat${counts.waiting ? ' warn' : ''}`}>
          <span className="label">need you</span>
          <b>{counts.waiting}</b>
        </div>
      </div>
      <Energy usage={server?.usage} />
    </header>
  )
}

function Energy({ usage }) {
  const rows = []
  for (const provider of ['claude', 'codex']) {
    const windows = usage?.[provider]?.windows || {}
    for (const [name, label] of [['five_hour', '5h'], ['seven_day', '7d']]) {
      const w = windows[name]
      if (!w || typeof w.used !== 'number') continue
      rows.push({ key: `${provider}-${name}`, label: `${provider} ${label}`, used: w.used, resets: w.resetsAt })
    }
  }
  if (!rows.length) return <div className="energy"><span className="label">usage unknown</span></div>
  return (
    <div className="energy">
      {rows.map((r) => {
        const tone = r.used >= 95 ? 'bad' : r.used >= 80 ? 'warn' : 'ok'
        return (
          <div key={r.key} className="meter" title={until(r.resets)}>
            <span className="label">{r.label}</span>
            <span className="bar"><i className={`fill fill-${tone}`} style={{ width: `${Math.min(100, r.used)}%` }} /></span>
            <span className={`num tone-${tone}`}>{`${Math.round(r.used)}%`}</span>
          </div>
        )
      })}
    </div>
  )
}

function Alerts({ server }) {
  const agents = server?.agents || []
  const waiting = agents.filter((a) => a.state === 'waiting').slice(0, 5)
  const blocked = agents.filter((a) => a.state === 'blocked').slice(0, 3)
  const lobby = agents.filter((a) => a.spot?.zone === 'lobby')
  const setShop = useOffice((s) => s.setShop)
  if (!waiting.length && !blocked.length && !lobby.length) return null
  return (
    <aside className="alerts">
      {waiting.map((a) => (
        <button type="button" key={a.id} className="alert alert-warn" onClick={() => focusAgent(a.id)}>
          <span className="label">needs you</span>
          <span className="alert-text">{`${a.name.toLowerCase()} · ${a.title}`}</span>
        </button>
      ))}
      {blocked.map((a) => (
        <button type="button" key={a.id} className="alert alert-bad" onClick={() => focusAgent(a.id)}>
          <span className="label">rate limited</span>
          <span className="alert-text">{`${a.name.toLowerCase()} · ${a.title}`}</span>
        </button>
      ))}
      {lobby.length > 0 && (
        <button type="button" className="alert" onClick={() => setShop(true)}>
          <span className="label">{`${lobby.length} without a desk`}</span>
          <span className="alert-text">
            {lobby.length > LOBBY_SPOTS.length ? 'the lobby is full · build a pod' : 'build another pod to seat them'}
          </span>
        </button>
      )}
    </aside>
  )
}

function Row({ label, children }) {
  if (!children) return null
  return (
    <div className="row">
      <span className="label">{label}</span>
      <span className="value">{children}</span>
    </div>
  )
}

function AgentPanel({ id }) {
  const agent = useOffice((s) => s.server?.agents?.find((a) => a.id === id))
  const ask = useOffice((s) => s.asks[id])
  const select = useOffice((s) => s.select)
  const [question, setQuestion] = useState('')
  const log = useRef()
  const conversation = agent?.conversation || []
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [conversation.length, ask?.pending])

  if (!agent) {
    return (
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">gone</span>
          <button type="button" className="ghost" onClick={() => select(null)}>close</button>
        </div>
        <p className="muted">That agent left the office.</p>
      </section>
    )
  }
  const place = agent.spot?.zone === 'desk' ? `desk ${agent.seat}` : agent.spot?.zone
  const name = agent.name.toLowerCase()
  const pronoun = isFemaleName(agent.name) ? 'she' : 'he'
  // Talking goes into the real session; peeking reads it without interrupting.
  const canSend = !!agent.pane
  const busy = agent.state === 'working'
  const send = (text, mode = canSend ? 'send' : 'ask') => {
    const q = String(text || '').trim()
    if (!q || ask?.pending) return
    if (mode === 'send' && !canSend) return
    askAgent(agent.id, q, mode)
    setQuestion('')
  }
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">{agent.name.toLowerCase()}</span>
          <span className={`pill pill-${agent.state}`}>{STATE_LABEL[agent.state] || agent.state}</span>
          <span className="pill">{agent.role}</span>
        </div>
        <button type="button" className="ghost" onClick={() => select(null)}>close</button>
      </div>
      <h2 className="agent-title">{agent.title}</h2>
      <div className="rows">
        <Row label="agent">{`${agent.agent}${agent.model ? ` · ${agent.model}` : ''}`}</Row>
        <Row label="machine">{`${agent.machine}${agent.pane ? ' · open pane' : ' · background'}`}</Row>
        <Row label="project">{`${agent.project}${agent.branch ? ` @ ${agent.branch}` : ''}`}</Row>
        <Row label="sits">{place}</Row>
        <Row label="last active">{ago(agent.lastActive)}</Row>
        <Row label="now">{agent.now}</Row>
      </div>
      {agent.lastPrompt && (
        <div className="block">
          <span className="label">you asked</span>
          <p className="clamp">{agent.lastPrompt}</p>
        </div>
      )}
      {agent.lastSaid && (
        <div className="block">
          <span className="label">it said</span>
          <p className="clamp">{agent.lastSaid}</p>
        </div>
      )}
      {agent.helpers?.length > 0 && (
        <div className="block">
          <span className="label">{`helpers out (${agent.helpers.length})`}</span>
          <ol className="activity">
            {agent.helpers.map((task, i) => <li key={i} className="act act-tool">{task}</li>)}
          </ol>
        </div>
      )}
      {agent.files?.length > 0 && (
        <div className="block">
          <span className="label">files touched</span>
          <div className="chips">{agent.files.map((f) => <span key={f} className="chip">{f}</span>)}</div>
        </div>
      )}
      {agent.activity?.length > 0 && (
        <div className="block">
          <span className="label">recent activity</span>
          <ol className="activity">
            {agent.activity.slice(-8).map((item, i) => (
              <li key={i} className={`act act-${item.kind}`}>{item.text}</li>
            ))}
          </ol>
        </div>
      )}
      <div className="block talk">
        <span className="label">talk</span>
        <div className="log" ref={log}>
          {conversation.map((c, i) => (
            <div key={i} className={`qa${c.mode === 'send' ? ' qa-live' : ''}`}>
              <p className="q">{c.mode === 'send' ? `sent: ${c.q}` : c.q}</p>
              <p className="a">
                {c.mode === 'send' && <span className="live-tag">{`${name} · live session`}</span>}
                {c.a}
              </p>
            </div>
          ))}
          {ask?.pending && (
            <p className="a pending">
              {ask.mode !== 'send'
                ? 'peeking at the session…'
                : ask.queued
                  ? `queued · ${name} gets it as soon as ${pronoun} pauses`
                  : `${name} is on it · waiting for the real reply…`}
            </p>
          )}
          {ask?.error && <p className="a error">{ask.error}</p>}
        </div>
        <div className="quick">
          {QUICK.map((q) => (
            <button type="button" key={q} className="chip-button" disabled={ask?.pending}
              title="a quick peek at the session; doesn't interrupt" onClick={() => send(q, 'ask')}>
              {q.toLowerCase()}
            </button>
          ))}
        </div>
        <form className="ask" onSubmit={(e) => { e.preventDefault(); send(question) }}>
          <textarea value={question} maxLength={4000} rows={2}
            placeholder={canSend ? `tell ${name} what to do` : `${name} has no open pane · peek only`}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(question)
              }
            }} />
          <div className="ask-buttons">
            <button type="submit" className="send" disabled={ask?.pending || !question.trim() || !canSend}
              title="goes into the real session; the agent does it and replies">
              {busy ? 'queue' : 'send'}
            </button>
            <button type="button" disabled={ask?.pending || !question.trim()} onClick={() => send(question, 'ask')}
              title="Sonnet reads the session and answers in character; the agent is not interrupted">
              peek
            </button>
          </div>
        </form>
        <p className="fine">
          {canSend
            ? `send goes into ${name}'s real session: ${pronoun} does the work and the real reply comes back here${busy ? `, once ${pronoun} pauses` : ''}. peek answers from the session log without interrupting.`
            : `${name}'s feeder can't type into its session, so you can only peek.`}
        </p>
      </div>
    </section>
  )
}

function CeoPanel({ server }) {
  const select = useOffice((s) => s.select)
  const tasks = server?.tasks || []
  const working = server?.ceo?.state === 'working'
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <span className="panel-title">ceo</span>
          <span className={`pill pill-${working ? 'working' : 'idle'}`}>{working ? 'thinking' : 'around'}</span>
          <span className="pill">ceo</span>
        </div>
        <button type="button" className="ghost" onClick={() => select(null)}>close</button>
      </div>
      <h2 className="agent-title">Runs the place</h2>
      <p className="muted">The corner office belongs to whatever orchestrates your agents. A feeder can report its state as <code>ceo</code> and its open tasks as <code>tasks</code>.</p>
      <ol className="tasks">
        {tasks.map((t) => (
          <li key={t.id}><span className="num">{t.id}</span> {t.text}</li>
        ))}
        {!tasks.length && <li className="muted">Nothing owed right now.</li>}
      </ol>
    </section>
  )
}

function Shop({ server }) {
  const office = server?.office
  const unlocked = new Set(office?.unlocked || [])
  const coins = office?.coins ?? 0
  const setShop = useOffice((s) => s.setShop)
  const groups = [
    ['desks', CATALOG.filter((c) => c.kind === 'pod')],
    ['rooms', CATALOG.filter((c) => c.kind === 'room')],
    ['decor', CATALOG.filter((c) => c.kind === 'decor')],
  ]
  return (
    <section className="panel shop">
      <div className="panel-head">
        <div>
          <span className="panel-title">build</span>
          <span className="pill pill-accent">{`${coins.toLocaleString()} coins`}</span>
        </div>
        <button type="button" className="ghost" onClick={() => setShop(false)}>close</button>
      </div>
      <p className="muted">{`A merged PR pays ${REWARDS.pr} coins, a finished run ${REWARDS.run} and a commit ${REWARDS.commit}. More pods seat more agents.`}</p>
      {groups.map(([title, items]) => (
        <div key={title} className="block">
          <span className="label">{title}</span>
          <div className="items">
            {items.map((item) => {
              const built = unlocked.has(item.id)
              const blocked = item.requires && !unlocked.has(item.requires)
              const short = coins < item.cost
              return (
                <div key={item.id} className="item">
                  <div>
                    <div className="item-name">{item.name}</div>
                    <div className="item-blurb">{item.blurb}</div>
                  </div>
                  {built ? (
                    <span className="pill pill-ok">built</span>
                  ) : (
                    <button type="button" disabled={blocked || short} onClick={() => buyItem(item.id)}
                      title={blocked ? `needs ${CATALOG.find((c) => c.id === item.requires)?.name}` : ''}>
                      {blocked ? 'locked' : item.cost.toLocaleString()}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <div className="block">
        <span className="label">income</span>
        <ol className="ledger">
          {(office?.ledger || []).map((l, i) => (
            <li key={i}>
              <span className={`num ${l.amount > 0 ? 'tone-ok' : 'tone-accent'}`}>{`${l.amount > 0 ? '+' : ''}${l.amount}`}</span>
              <span>{l.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function HirePanel({ server }) {
  const open = useOffice((s) => s.hireOpen)
  const setOpen = useOffice((s) => s.setHireOpen)
  const hire = useOffice((s) => s.hire)
  const machines = Object.entries(server?.machines || {}).filter(([, m]) => m.online && m.capabilities?.hire).map(([name]) => name)
  const projects = [...new Set((server?.agents || []).map((a) => a.project))].filter((p) => p && p !== 'jobs').sort()
  const [agent, setAgent] = useState('claude')
  const [machine, setMachine] = useState('')
  const [project, setProject] = useState('')
  const [task, setTask] = useState('')
  const desks = server?.office?.desks ?? 0
  const seated = (server?.agents || []).filter((a) => a.seat).length
  const free = Math.max(0, desks - seated)
  const where = machine || machines.find((m) => m.toLowerCase() === 'pc') || machines[0] || ''
  useEffect(() => {
    if (hire.ok) setTask('')
  }, [hire.ok])
  if (!open || !machines.length) return null
  const submit = (e) => {
    e.preventDefault()
    if (!task.trim() || hire.pending || !free || !where) return
    hireAgent({ machine: where, agent, project, task })
  }
  return (
    <section className="panel shop">
      <div className="panel-head">
        <div>
          <span className="panel-title">hire</span>
          <span className={`pill ${free ? 'pill-ok' : 'pill-waiting'}`}>{`${free} free desk${free === 1 ? '' : 's'}`}</span>
        </div>
        <button type="button" className="ghost" onClick={() => setOpen(false)}>close</button>
      </div>
      <p className="muted">A new hire opens as a real agent session on that machine, briefed to take the task end to end and finish with DONE, BLOCKED or NEEDS YOU.</p>
      <form className="hire" onSubmit={submit}>
        <span className="label">who</span>
        <div className="seg">
          {['claude', 'codex'].map((kind) => (
            <button type="button" key={kind} aria-pressed={agent === kind} onClick={() => setAgent(kind)}>{kind}</button>
          ))}
        </div>
        <span className="label">machine</span>
        <div className="seg">
          {machines.map((m) => (
            <button type="button" key={m} aria-pressed={where === m} onClick={() => setMachine(m)}>{m.toLowerCase()}</button>
          ))}
        </div>
        <span className="label">project</span>
        <input list="office-projects" value={project} placeholder="a repository name, or leave blank to infer"
          onChange={(e) => setProject(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <datalist id="office-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        <span className="label">task</span>
        <textarea rows={5} value={task} placeholder="what should they get done?"
          onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="submit" className="send" disabled={!task.trim() || hire.pending || !free || !where}>
          {hire.pending ? 'hiring…' : free ? 'hire' : 'no free desk · build a pod'}
        </button>
        {hire.text && <p className={`a ${hire.ok ? '' : 'error'}`}>{hire.text}</p>}
      </form>
    </section>
  )
}

function SoundPrompt() {
  const armed = useOffice((s) => s.audioArmed)
  const music = useOffice((s) => s.music)
  const voice = useOffice((s) => s.voice)
  if (armed || (!music && !voice)) return null
  return <div className="sound-prompt">click anywhere for sound</div>
}

function NearPrompt() {
  const nearId = useOffice((s) => s.nearId)
  const mode = useOffice((s) => s.mode)
  const selectedId = useOffice((s) => s.selectedId)
  const agent = useOffice((s) => s.server?.agents?.find((a) => a.id === s.nearId))
  if (mode !== 'walk' || !nearId || !agent || selectedId === nearId) return null
  return (
    <div className="near">
      <kbd>e</kbd>
      {` talk to ${agent.name.toLowerCase()}`}
    </div>
  )
}

function ModeBar() {
  const mode = useOffice((s) => s.mode)
  const setMode = useOffice((s) => s.setMode)
  const shopOpen = useOffice((s) => s.shopOpen)
  const setShop = useOffice((s) => s.setShop)
  const light = useOffice((s) => s.light)
  const cycleLight = useOffice((s) => s.cycleLight)
  const hireOpen = useOffice((s) => s.hireOpen)
  const setHireOpen = useOffice((s) => s.setHireOpen)
  const canHire = useOffice((s) => !!s.server?.capabilities?.hire)
  const music = useOffice((s) => s.music)
  const toggleMusic = useOffice((s) => s.toggleMusic)
  const voice = useOffice((s) => s.voice)
  const toggleVoice = useOffice((s) => s.toggleVoice)
  return (
    <nav className="modebar">
      <button type="button" aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>walk</button>
      <button type="button" aria-pressed={mode === 'overview'} onClick={() => setMode('overview')}>overview</button>
      <button type="button" aria-pressed={shopOpen} onClick={() => setShop(!shopOpen)}>build</button>
      {canHire && <button type="button" aria-pressed={hireOpen} onClick={() => setHireOpen(!hireOpen)}>hire</button>}
      <button type="button" className="light" onClick={cycleLight} title="auto follows your clock: day 07:00 to 19:00">
        {`light: ${light}`}
      </button>
      <button type="button" className="light" aria-pressed={music} onClick={toggleMusic} title="lo-fi loop made live in the browser (m)">
        {`music: ${music ? 'on' : 'off'}`}
      </button>
      <button type="button" className="light" aria-pressed={voice} onClick={toggleVoice}
        title="agents read their lines aloud with your browser's voices">
        {`voices: ${voice ? 'on' : 'off'}`}
      </button>
      <span className="hint">
        {mode === 'walk'
          ? 'wasd move · drag look · e talk · tab overview · b build'
          : 'drag orbit · wheel zoom · click someone · tab walk · b build'}
      </span>
    </nav>
  )
}

function Toasts() {
  const toasts = useOffice((s) => s.toasts)
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.amount != null && <b className="num">{`${t.amount > 0 ? '+' : ''}${t.amount}`}</b>}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
