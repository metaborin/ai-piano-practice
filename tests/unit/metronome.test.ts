import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { buildMetronomePlan } from '../../src/audio/buildMetronomePlan'
import { Metronome } from '../../src/audio/Metronome'
import { ClickAudio } from '../../src/audio/ClickAudio'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { DuetController } from '../../src/practice/DuetController'
import { buildDuetTimeline } from '../../src/practice/DuetPlan'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { PLAYBACK_RATES } from '../../src/audio/playbackRate'
import { parseXml, noteXml, scoreXml } from './xmlFixture'

afterEach(() => { vi.clearAllTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })
const builtIn = (name: string) => createPracticePlan(parseXml(readFileSync(`src/scores/${name}.musicxml`, 'utf8')))!
const xmlPlan = (body: string) => createPracticePlan(parseXml(scoreXml(body)))!
const time = (beats: number, unit: number) => `<time><beats>${beats}</beats><beat-type>${unit}</beat-type></time>`
const model = (bars: string) => parseXml(`<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars}</part></score-partwise>`)
function fakeSound() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const clicks: { at: number; accent: boolean }[] = []
  const sound = { prepare: vi.fn().mockResolvedValue(undefined), play: vi.fn((accent: boolean) => clicks.push({ at: performance.now(), accent })), stop: vi.fn() }
  return { metro: new Metronome(sound), sound, clicks }
}
function strike(session: PracticeSession, pitches: readonly number[]) {
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteon', midiNote, channel: 1, velocity: 80, timestamp: performance.now() })
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteoff', midiNote, channel: 1, velocity: 0, timestamp: performance.now() })
}
async function midi() {
  const port = { id: 'out', name: 'PX', state: 'connected', open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined), send: vi.fn(), clear: vi.fn() }
  const output = new MidiOutputManager()
  output.attachAccess({ outputs: new Map([['out', port]]) } as unknown as MIDIAccess)
  await Promise.resolve()
  return { output, port, session: new PracticeSession() }
}

for (const rate of PLAYBACK_RATES) {
  it(`${rate}: meters and accents use the same scaled XML timeline for all built-ins`, () => {
    for (const [name, count, unit] of [['twinkle', 16, 1], ['harvest-time', 114, 1.5], ['duet/maim-maim-primo-once', 60, 2], ['duet/maim-maim-secondo-original', 112, 2]] as const) {
      const plan = builtIn(name), clicks = buildMetronomePlan(plan, rate), normal = buildMetronomePlan(plan)
      expect(clicks).toHaveLength(count)
      expect(clicks[0]).toMatchObject({ atMs: 0, accent: true, beatInMeasure: 1 })
      expect(clicks[1]).toMatchObject({ accent: false, beatInMeasure: 2 })
      clicks.forEach((click, i) => { expect(click.atMs).toBeCloseTo(normal[i].atMs / rate, 6); expect(click.accent).toBe(normal[i].accent) })
      const bpm = plan.score.tempoBpm ?? 100
      expect(clicks[1].atMs).toBeCloseTo(unit * 60_000 / bpm / rate, 6)
    }
  })

  it(`${rate}: demo clicks align with attacks/cursor and end at the same stop without altering grading`, async () => {
    const c = fakeSound(), m = await midi(), plan = builtIn('twinkle')
    await c.metro.setEnabled(true)
    m.session.loadPlan(plan); m.session.start(); strike(m.session, [60])
    const player = new DemoPlayer(m.output, m.session.beginDemo, update => update(), c.metro)
    player.subscribe(() => { if (player.getSnapshot().status !== 'playing') m.session.endDemo() })
    player.loadPlan(plan); player.start({ kind: 'beginning' }, rate)
    const notes = buildDemoPlan(plan, { kind: 'beginning' }, rate)
    const end = Math.max(...notes.map(note => note.noteOffMs))
    vi.advanceTimersByTime(Math.ceil(end) + 1)
    expect(player.getSnapshot().status).toBe('completed')
    const expected = buildMetronomePlan(plan, rate).filter(beat => beat.atMs < end)
    expect(c.clicks).toHaveLength(expected.length)
    c.clicks.forEach((click, i) => { expect(click.at).toBeCloseTo(expected[i].atMs, 0); expect(click.accent).toBe(expected[i].accent) })
    expect(m.port.send.mock.calls.filter(([d]) => d[0] === 0x90).map(([d]) => d[1])).toEqual(notes.map(n => n.midiNote))
    expect(m.session.getSnapshot()).toMatchObject({ status: 'practicing', correctNoteCount: 1, currentNoteIndex: 1 })
    expect(c.metro.getSnapshot()).toMatchObject({ enabled: true, status: 'ready' })
    expect(c.metro.getDiagnostics().scheduledTimers).toBe(0)
    const quiet = c.clicks.length; vi.advanceTimersByTime(60000); expect(c.clicks).toHaveLength(quiet)
  })

  it(`${rate}: paced duet stops clicks while waiting and resumes at the next musical beat`, async () => {
    const c = fakeSound(), m = await midi(), own = builtIn('duet/maim-maim-primo-original'), partner = builtIn('duet/maim-maim-secondo-original')
    await c.metro.setEnabled(true)
    m.session.loadPlan(own)
    const controller = new DuetController(m.output, m.session, c.metro)
    controller.loadPlans(own, partner); controller.start({ kind: 'beginning' }, true, rate)
    const timeline = buildDuetTimeline(own, partner, rate)
    expect(c.clicks).toEqual([{ at: 0, accent: true }])
    strike(m.session, [60]); vi.advanceTimersByTime(Math.ceil(timeline.targetStarts[1]) + 1)
    expect(controller.getSnapshot().status).toBe('waiting')
    const quiet = c.clicks.length; vi.advanceTimersByTime(5000); expect(c.clicks).toHaveLength(quiet)
    const resumedAt = performance.now(); strike(m.session, [79])
    expect(m.session.getSnapshot().correctNoteCount).toBe(1)
    expect(controller.getSnapshot().status).toBe('playing')
    // This target is halfway through the first half-note beat: do not reset its phase.
    expect(c.clicks).toHaveLength(quiet)
    strike(m.session, own.sequence.occurrences[1].sourceTarget.expectedMidiNotes)
    vi.advanceTimersByTime(Math.ceil(timeline.targetStarts[2] - timeline.targetStarts[1]) + 1)
    expect(c.clicks.at(-1)!.at - resumedAt - (timeline.clicks[1].atMs - timeline.targetStarts[1])).toBeGreaterThanOrEqual(-1e-7)
    expect(c.clicks.at(-1)!.at - resumedAt - (timeline.clicks[1].atMs - timeline.targetStarts[1])).toBeLessThan(1.01)
    expect(m.session.getSnapshot().correctNoteCount).toBe(2)
    controller.stop(); expect(c.metro.getSnapshot().status).toBe('ready')
    const stopped = c.clicks.length; vi.advanceTimersByTime(60000); expect(c.clicks).toHaveLength(stopped)
  })

  for (const partnerEnabled of [false, true]) it(`${rate}: original timed duet clicks keep both passes with partner=${partnerEnabled}`, async () => {
    const c = fakeSound(), m = await midi(), own = builtIn('duet/maim-maim-secondo-original'), partner = builtIn('duet/maim-maim-primo-original')
    await c.metro.setEnabled(true)
    m.session.loadPlan(own); m.session.setFlowMode('run-through')
    const controller = new DuetController(m.output, m.session, c.metro)
    controller.loadPlans(own, partner); controller.start({ kind: 'beginning' }, partnerEnabled, rate)
    const timeline = buildDuetTimeline(own, partner, rate)
    vi.advanceTimersByTime(Math.ceil(timeline.endMs) + 1)
    expect(c.clicks).toHaveLength(112)
    c.clicks.forEach((click, i) => { expect(click.at - timeline.clicks[i].atMs).toBeGreaterThanOrEqual(-1e-7); expect(click.at - timeline.clicks[i].atMs).toBeLessThan(1.01); expect(click.accent).toBe(timeline.clicks[i].accent) })
    expect(c.clicks[60].accent).toBe(true)
    expect(m.session.getSnapshot()).toMatchObject({ status: 'completed', correctNoteCount: 0 })
    expect(c.metro.getDiagnostics()).toEqual({ scheduledTimers: 0, hasWindow: false })
    expect(m.port.clear).not.toHaveBeenCalled()
  })
}

it('inherits meter changes; groups 6/8 and 9/8 but not 3/8, and preserves missing/complex meter quarter fallback', () => {
  const score = model(`<measure number="1"><attributes><divisions>1</divisions>${time(6, 8)}</attributes>${noteXml('C', 3)}</measure><measure number="2">${noteXml('D', 3)}</measure><measure number="3"><attributes>${time(3, 8)}</attributes>${noteXml('E', 1.5)}</measure><measure number="4"><attributes>${time(9, 8)}</attributes>${noteXml('F', 4.5)}</measure>`)
  expect(score.measures.map(m => m.meter)).toEqual([{ beats: 6, beatType: 8 }, { beats: 6, beatType: 8 }, { beats: 3, beatType: 8 }, { beats: 9, beatType: 8 }])
  const clicks = buildMetronomePlan(createPracticePlan(score)!)
  expect(clicks.map(c => c.atMs)).toEqual([0, 900, 1800, 2700, 3600, 3900, 4200, 4500, 5400, 6300])
  for (const meter of ['', '<time><beats>3+2</beats><beat-type>8</beat-type></time>', '<time><senza-misura/></time>']) {
    const plan = xmlPlan(`<attributes>${meter}</attributes>${noteXml('C', 4)}`)
    expect(buildMetronomePlan(plan)).toHaveLength(4)
    expect(buildMetronomePlan(plan).every(c => !c.accent)).toBe(true)
    expect(plan.score.practiceCompatibility).toBe('simpleMelody')
  }
})

it('does not invent an accented downbeat in a pickup; respects tempo changes through rests/ties and partial starts', () => {
  const score = model(`<measure number="0" implicit="yes"><attributes><divisions>1</divisions>${time(4, 4)}</attributes><direction><sound tempo="120"/></direction>${noteXml('C', 1)}</measure><measure number="1">${noteXml('D', 1, '<tie type="start"/>')}<direction><sound tempo="60"/></direction>${noteXml('D', 1, '<tie type="stop"/>')}<note><rest/><duration>2</duration></note></measure><measure number="2">${noteXml('G', 4)}</measure>`)
  const plan = createPracticePlan(score)!, clicks = buildMetronomePlan(plan)
  expect(clicks.map(c => c.atMs)).toEqual([0, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000])
  expect(clicks[0]).toMatchObject({ accent: false, beatInMeasure: 4 })
  expect(clicks[1].accent).toBe(true)
  expect(buildMetronomePlan(plan, 1, { kind: 'measure', measureIndex: 1 })[0]).toMatchObject({ atMs: 0, accent: true })
  expect(buildMetronomePlan(plan, 1, { kind: 'current', occurrenceIndex: 2, completed: false })[0]).toMatchObject({ atMs: 0, accent: true, measureOccurrenceIndex: 2 })
  const original = builtIn('duet/maim-maim-primo-original'), pass2 = original.sequence.occurrences.findIndex(o => o.repeatPass === 2)
  const partial = buildMetronomePlan(original, 0.5, { kind: 'current', occurrenceIndex: pass2, completed: false })
  expect(partial).toHaveLength(52); expect(partial[0]).toMatchObject({ atMs: 0, accent: true, measureOccurrenceIndex: 30 })
})

it('ON/OFF during playback only joins future beats, never restarts music or plays while stopped', async () => {
  const c = fakeSound(), beats = buildMetronomePlan(builtIn('twinkle'))
  c.metro.schedule(beats, 0, 0, 0, 2400)
  vi.advanceTimersByTime(750); expect(c.clicks).toHaveLength(0)
  await c.metro.setEnabled(true)
  vi.advanceTimersByTime(450); expect(c.clicks).toEqual([{ at: 1200, accent: false }])
  await c.metro.setEnabled(false); vi.advanceTimersByTime(200); await c.metro.setEnabled(true)
  vi.advanceTimersByTime(400); expect(c.clicks.map(c => c.at)).toEqual([1200, 1800])
  c.metro.stop(); await c.metro.setEnabled(false); await c.metro.setEnabled(true)
  vi.advanceTimersByTime(10000); expect(c.clicks).toHaveLength(2)
  expect(c.sound.stop).toHaveBeenCalled()
})

it('a late resume cannot revive an OFF toggle, stopped window or old song', async () => {
  const c = fakeSound(); let resolve!: () => void
  c.sound.prepare.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
  c.metro.schedule(buildMetronomePlan(builtIn('twinkle')), 0, 0, 0, 2400)
  const enabling = c.metro.setEnabled(true)
  await c.metro.setEnabled(false); resolve(); await enabling
  vi.advanceTimersByTime(2400); expect(c.clicks).toHaveLength(0)
  c.sound.prepare.mockImplementationOnce(() => new Promise<void>(r => { resolve = r }))
  const next = c.metro.setEnabled(true); c.metro.stop(); resolve(); await next
  vi.advanceTimersByTime(2400); expect(c.clicks).toHaveLength(0)
  c.metro.schedule(buildMetronomePlan(builtIn('twinkle')), performance.now(), 0, 0, 2400)
  expect(c.clicks).toHaveLength(1)
})

it('blocked timers skip expired clicks without a burst and old callbacks cannot affect new playback', async () => {
  const c = fakeSound(); await c.metro.setEnabled(true)
  const callbacks: (() => void)[] = [], native = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, delay?: number) => { callbacks.push(callback); return native(callback, delay) }) as typeof setTimeout)
  const beats = buildMetronomePlan(builtIn('twinkle'))
  c.metro.schedule(beats, 0, 0, 0, 2400)
  const obsolete = callbacks.at(-1)!
  c.metro.stop(); c.metro.schedule(beats, 0, 0, 0, 1200)
  const count = c.clicks.length; obsolete(); expect(c.clicks).toHaveLength(count)
  const now = vi.spyOn(performance, 'now').mockReturnValue(2000)
  callbacks.at(-1)!(); expect(c.clicks).toHaveLength(count)
  now.mockRestore(); c.metro.stop()
})

it('audio preparation/playback failure does not stop MIDI, change grades or leave a click timer', async () => {
  const c = fakeSound(), m = await midi(), plan = builtIn('twinkle')
  c.sound.prepare.mockRejectedValueOnce(new Error('denied'))
  await c.metro.setEnabled(true); expect(c.metro.getSnapshot().status).toBe('error')
  await c.metro.setEnabled(true); c.sound.play.mockImplementation(() => { throw new Error('suspended') })
  const player = new DemoPlayer(m.output, m.session.beginDemo, fn => fn(), c.metro)
  m.session.loadPlan(plan); player.loadPlan(plan); player.start()
  expect(player.getSnapshot().status).toBe('playing')
  expect(c.metro.getSnapshot().status).toBe('error')
  expect(c.metro.getDiagnostics().scheduledTimers).toBe(0)
  expect(m.port.send.mock.calls.filter(([d]) => d[0] === 0x90)).toHaveLength(1)
  player.stop(); expect(c.sound.stop).toHaveBeenCalled()
})

it('click sound accents have bounded envelopes, natural cleanup, and synchronous active-node disconnection on OFF', async () => {
  const oscillators: { frequency: { setValueAtTime: ReturnType<typeof vi.fn> }; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
  const gains: { gain: { setValueAtTime: ReturnType<typeof vi.fn>; linearRampToValueAtTime: ReturnType<typeof vi.fn>; exponentialRampToValueAtTime: ReturnType<typeof vi.fn> }; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> }[] = []
  const constructors = vi.fn(), resume = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('AudioContext', class {
    constructor() { constructors() }
    state = 'running'; currentTime = 2; destination = {}; resume = resume
    createOscillator() { const o = { frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null }; oscillators.push(o); return o }
    createGain() { const g = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; gains.push(g); return g }
  })
  const audio = new ClickAudio(); await audio.prepare(); await audio.prepare()
  expect(constructors).toHaveBeenCalledTimes(1)
  audio.play(true); audio.play(false)
  expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(1400, 2)
  expect(oscillators[1].frequency.setValueAtTime).toHaveBeenCalledWith(900, 2)
  expect(gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.18, 2.002)
  expect(gains[1].gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 2.035)
  expect(oscillators[0].stop).toHaveBeenCalledWith(2.04)
  oscillators[0].onended!()
  audio.stop()
  expect(oscillators[0].stop).toHaveBeenCalledTimes(1) // already naturally released
  expect(oscillators[1].stop).toHaveBeenLastCalledWith()
  expect(gains[1].disconnect).toHaveBeenCalledTimes(1)
  expect(oscillators[1].onended).toBeNull()
  audio.stop(); expect(oscillators[1].stop).toHaveBeenCalledTimes(2)
})

it('oversized beat grids are bounded and disable only the click, while valid MIDI playback remains available', async () => {
  const c = fakeSound(), m = await midi(), plan = xmlPlan(noteXml('C', 100001))
  expect(() => buildMetronomePlan(plan)).toThrow('100,000')
  await c.metro.setEnabled(true)
  const player = new DemoPlayer(m.output, () => {}, fn => fn(), c.metro)
  player.loadPlan(plan); player.start()
  expect(player.getSnapshot().status).toBe('playing')
  expect(c.metro.getSnapshot().message).toContain('クリックなし')
  expect(c.metro.getDiagnostics().scheduledTimers).toBe(0)
  player.stop()
})

it('partial demo starts preserve offbeat accents and metadata/default tempo without changing XML', () => {
  const plan = builtIn('twinkle')
  const clicks = buildMetronomePlan(plan, 0.75, { kind: 'current', occurrenceIndex: 1, completed: false })
  expect(clicks.slice(0, 4).map(c => c.accent)).toEqual([false, false, false, true])
  expect(clicks[1].atMs).toBe(800)
  const unknown = xmlPlan(noteXml('C', 4))
  expect(buildMetronomePlan({ ...unknown, songTempoBpm: 80 }, 0.5)[1].atMs).toBe(1500)
  expect(buildMetronomePlan(unknown, 0.75)[1].atMs).toBe(800)
})
