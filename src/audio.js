// Office sound: a lo-fi loop generated with Web Audio (no audio files, no
// licences), a few small effects, and optional spoken lines through the
// browser's own speech voices. Browsers only start audio after a click or key,
// so everything waits for the first gesture.

import { isFemaleName } from './shared/office.js'

let ctx = null
let master = null
let musicBus = null
let sfxBus = null
let filter = null
let crackle = null
let timer = null
let nextBeat = 0
let beat = 0
let playing = false
let bright = false
let armed = false // set by the first click or key

const BPM = 74
const BEAT = 60 / BPM
// Fmaj7 - Em7 - Dm7 - Cmaj7, two bars each; MIDI notes.
const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
]
const SCALE = [60, 62, 64, 67, 69, 72, 74, 76]

const hz = (note) => 440 * 2 ** ((note - 69) / 12)

function ensure() {
  if (ctx) return ctx
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) return null
  ctx = new Ctx()
  master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 1400
  filter.Q.value = 0.4
  musicBus = ctx.createGain()
  musicBus.gain.value = 0
  musicBus.connect(filter)
  filter.connect(master)
  sfxBus = ctx.createGain()
  sfxBus.gain.value = 0.35
  sfxBus.connect(master)
  return ctx
}

function noiseBuffer(seconds, sparse = false) {
  const length = Math.floor(ctx.sampleRate * seconds)
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = sparse ? (Math.random() < 0.0006 ? (Math.random() * 2 - 1) * 0.9 : (Math.random() * 2 - 1) * 0.02) : Math.random() * 2 - 1
  }
  return buffer
}

function keys(note, at, length, gain) {
  const f = hz(note)
  const out = ctx.createGain()
  out.gain.setValueAtTime(0, at)
  out.gain.linearRampToValueAtTime(gain, at + 0.02)
  out.gain.exponentialRampToValueAtTime(gain * 0.35, at + 0.6)
  out.gain.exponentialRampToValueAtTime(0.0001, at + length)
  out.connect(musicBus)
  for (const [type, detune, level] of [['sine', 0, 1], ['triangle', 7, 0.35], ['sine', -5, 0.25]]) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = type === 'sine' && level < 1 ? f * 2 : f
    osc.detune.value = detune
    g.gain.value = level
    osc.connect(g).connect(out)
    osc.start(at)
    osc.stop(at + length + 0.05)
  }
}

function kick(at) {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.frequency.setValueAtTime(110, at)
  osc.frequency.exponentialRampToValueAtTime(42, at + 0.18)
  g.gain.setValueAtTime(0.55, at)
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.28)
  osc.connect(g).connect(musicBus)
  osc.start(at)
  osc.stop(at + 0.3)
}

function hiss(at, length, gain, type, freq) {
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(length)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  const g = ctx.createGain()
  g.gain.setValueAtTime(gain, at)
  g.gain.exponentialRampToValueAtTime(0.001, at + length)
  src.connect(f).connect(g).connect(musicBus)
  src.start(at)
}

function schedule() {
  while (nextBeat < ctx.currentTime + 0.15) {
    const at = nextBeat
    const bar = Math.floor(beat / 4)
    const inBar = beat % 4
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length]
    if (inBar === 0 && bar % 2 === 0) {
      chord.forEach((n, i) => keys(n, at + i * 0.012, BEAT * 7.5, 0.11))
      keys(chord[0] - 12, at, BEAT * 7.5, 0.13)
    }
    if (inBar === 0 || (inBar === 2 && Math.random() < 0.35)) kick(at)
    if (inBar === 1 || inBar === 3) hiss(at + 0.02, 0.16, 0.12, 'bandpass', 1800)
    hiss(at, 0.05, 0.035, 'highpass', 7000)
    hiss(at + BEAT * 0.58, 0.04, 0.025, 'highpass', 7500) // swung offbeat
    if (Math.random() < (bright ? 0.4 : 0.22)) {
      const note = SCALE[Math.floor(Math.random() * SCALE.length)] + (bright ? 12 : 0)
      keys(note, at + (Math.random() < 0.5 ? 0 : BEAT * 0.5), BEAT * 1.6, 0.07)
    }
    nextBeat += BEAT
    beat++
  }
}

export function setDaylight(day) {
  bright = day
  if (filter && ctx) filter.frequency.setTargetAtTime(day ? 2600 : 1300, ctx.currentTime, 1.5)
}

export function startMusic() {
  if (!armed || !ensure() || playing) return
  playing = true
  ctx.resume()
  nextBeat = ctx.currentTime + 0.1
  musicBus.gain.setTargetAtTime(1.0, ctx.currentTime, 0.6)
  if (!crackle) {
    crackle = ctx.createBufferSource()
    crackle.buffer = noiseBuffer(4, true)
    crackle.loop = true
    const g = ctx.createGain()
    g.gain.value = 0.25
    crackle.connect(g).connect(musicBus)
    crackle.start()
  }
  timer = setInterval(schedule, 40)
}

export function stopMusic() {
  if (!ctx || !playing) return
  playing = false
  clearInterval(timer)
  musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
}

function tone(freq, at, length, gain, type = 'sine') {
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + length)
  osc.connect(g).connect(sfxBus)
  osc.start(at)
  osc.stop(at + length + 0.05)
}

// effect: 'coin' | 'chime' | 'build' | 'pop'
export function sfx(effect) {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime
  if (effect === 'coin') {
    tone(988, t, 0.12, 0.25, 'square')
    tone(1319, t + 0.08, 0.35, 0.22, 'square')
  } else if (effect === 'chime') {
    tone(hz(76), t, 1.1, 0.3)
    tone(hz(83), t + 0.14, 1.3, 0.22)
  } else if (effect === 'build') {
    ;[60, 64, 67, 72].forEach((n, i) => tone(hz(n), t + i * 0.07, 0.4, 0.2, 'triangle'))
  } else if (effect === 'pop') {
    tone(660, t, 0.08, 0.12)
  }
}

// Unlock audio on the first gesture.
export function armAudio(onReady) {
  const go = () => {
    armed = true
    ensure()
    ctx?.resume()
    onReady?.()
    window.removeEventListener('pointerdown', go)
    window.removeEventListener('keydown', go)
  }
  window.addEventListener('pointerdown', go)
  window.addEventListener('keydown', go)
}

// --- voices ------------------------------------------------------------------

let voices = []
function loadVoices() {
  voices = window.speechSynthesis?.getVoices?.() || []
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = loadVoices
}

const WOMAN_VOICE = /female|woman|zira|samantha|victoria|karen|moira|tessa|fiona|susan|hazel|aria|jenny|libby|sonia|f\d|\+f/i
const MAN_VOICE = /male|man\b|david|daniel|alex|fred|george|guy|ryan|mark|m\d|\+m/i

export function voicesAvailable() {
  return voices.length > 0
}

export function speak(name, text, seed = 0) {
  const synth = window.speechSynthesis
  if (!synth || !text) return
  const english = voices.filter((v) => /^en/i.test(v.lang))
  const pool = english.length ? english : voices
  const fem = isFemaleName(name)
  const matching = pool.filter((v) => (fem ? WOMAN_VOICE : MAN_VOICE).test(v.name) && !(fem ? MAN_VOICE : WOMAN_VOICE).test(v.name))
  const choices = matching.length ? matching : pool
  const utterance = new SpeechSynthesisUtterance(String(text).slice(0, 240))
  if (choices.length) utterance.voice = choices[seed % choices.length]
  utterance.pitch = (fem ? 1.25 : 0.85) + ((seed % 7) - 3) * 0.04
  utterance.rate = 1.02 + ((seed % 5) - 2) * 0.03
  utterance.volume = 0.9
  if (synth.speaking && synth.pending) synth.cancel()
  synth.speak(utterance)
}

// For checking from the console: window.__officeAudio()
if (typeof window !== 'undefined') {
  window.__officeAudio = () => ({ armed, playing, state: ctx?.state || 'none', time: ctx?.currentTime || 0, beat })
}
