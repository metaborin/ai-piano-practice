import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { resolvePracticeStart } from '../../src/practice/PracticeStartResolver'
import type { PracticeStart } from '../../src/practice/PracticeStartResolver'
import { buildDuetTimeline, validateDuetPair } from '../../src/practice/DuetPlan'
import { DuetController } from '../../src/practice/DuetController'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { parseXml } from './xmlFixture'

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })
function plans(part: 'primo' | 'secondo' = 'primo', version = 'original') {
  const model = (id: string) => parseXml(readFileSync(new URL(`../../src/scores/duet/maim-maim-${id}-${version}.musicxml`, import.meta.url), 'utf8'))
  return [createPracticePlan(model(part))!, createPracticePlan(model(part === 'primo' ? 'secondo' : 'primo'))!] as const
}
async function setup(part: 'primo' | 'secondo' = 'primo', version = 'original', clear = true) {
  vi.useFakeTimers({ toFake: ['setTimeout','clearTimeout','performance'] })
  const port = { id:'out',name:'CME',manufacturer:'CME',state:'connected',open:vi.fn().mockResolvedValue(undefined),close:vi.fn().mockResolvedValue(undefined),send:vi.fn(),clear:clear?vi.fn():undefined }
  const output = new MidiOutputManager()
  output.attachAccess({outputs:new Map([['out',port]])} as unknown as MIDIAccess)
  await Promise.resolve()
  const session = new PracticeSession(), controller = new DuetController(output, session)
  const [own,partner] = plans(part, version), timeline=buildDuetTimeline(own,partner)
  session.loadPlan(own); controller.loadPlans(own,partner)
  const ons = () => port.send.mock.calls.filter(([data]) => data[0]===0x90)
  return { port, output, session, controller, own, partner, timeline, ons }
}
function strike(session: PracticeSession, notes: readonly number[]) {
  for (const midiNote of notes) session.handleMidiEvent({type:'noteon',midiNote,channel:1,velocity:80,timestamp:performance.now()})
  for (const midiNote of notes) session.handleMidiEvent({type:'noteoff',midiNote,channel:1,velocity:0,timestamp:performance.now()})
}
function from(context: Awaited<ReturnType<typeof setup>>, start: PracticeStart) {
  context.session.setStartTarget(resolvePracticeStart(context.own,start).resolvedOccurrenceIndex)
  return context.controller.start(start,true)
}

for (const part of ['primo','secondo'] as const) for (const version of ['once','original']) {
  it(`${part} ${version}: timed practice finishes without input, playing only the opposite XML through all repeats`, async () => {
    const c=await setup(part,version)
    c.session.setFlowMode('run-through')
    expect(c.controller.start({kind:'beginning'},true)).toBe(true)
    vi.advanceTimersByTime(Math.ceil(c.timeline.endMs)+10)
    const snapshot=c.session.getSnapshot()
    expect(snapshot.status).toBe('completed')
    expect(snapshot.attempts).toHaveLength(c.own.sequence.occurrences.length)
    expect(snapshot.attempts.every(a=>a.result==='incorrect' && a.missingMidiNotes.length>0 && !a.playedMidiNotes.length)).toBe(true)
    expect(c.ons().map(([data])=>data[1])).toEqual(c.timeline.notes.map(n=>n.midiNote))
    c.ons().forEach(([,timestamp],i)=>expect(timestamp).toBeCloseTo(c.timeline.notes[i].startMs,7))
    expect(c.output.getSnapshot().playing).toBe(false)
    expect(c.controller.getDiagnostics().timers).toBe(0)
    expect(c.output.getDiagnostics().activeNotes).toEqual([])
    expect(c.port.clear).not.toHaveBeenCalled()
    expect(c.port.send.mock.calls.filter(([d])=>d[0]===0xb0)).toHaveLength(0)
  })
  it(`${part} ${version}: until-correct retains tempo, all pitches, long-note Offs and repeat order when answered on time`, async () => {
    const c=await setup(part,version)
    c.controller.start({kind:'beginning'},true)
    for(let i=0;i<c.own.sequence.occurrences.length;i++) {
      expect(c.session.getSnapshot().currentNoteIndex).toBe(i)
      strike(c.session,c.own.sequence.occurrences[i].sourceTarget.expectedMidiNotes)
      // Correct input does not race ahead of the current musical interval.
      expect(c.session.getSnapshot().correctNoteCount).toBe(i)
      const end=c.timeline.targetStarts[i+1]??c.timeline.endMs
      vi.advanceTimersByTime(Math.max(0,Math.ceil(end)-performance.now()))
    }
    expect(c.session.getSnapshot()).toMatchObject({status:'completed',correctNoteCount:c.own.sequence.occurrences.length})
    expect(c.ons().map(([d])=>d[1])).toEqual(c.timeline.notes.map(n=>n.midiNote))
    const offs=c.port.send.mock.calls.filter(([d])=>d[0]===0x80)
    expect(offs.map(([,t])=>t)).toEqual(c.timeline.notes.map(n=>n.noteOffMs))
    expect(c.port.clear).not.toHaveBeenCalled()
  })
}
it('wrong/missing until-correct input waits quietly and a late correct input resumes the next target', async () => {
  const c=await setup('primo','once')
  c.controller.start({kind:'beginning'},true)
  strike(c.session,[60])
  vi.advanceTimersByTime(1200)
  expect(c.controller.getSnapshot().status).toBe('waiting')
  expect(c.session.getSnapshot()).toMatchObject({currentNoteIndex:0,correctNoteCount:0,status:'practicing'})
  const attacks=c.ons().length
  vi.advanceTimersByTime(5000)
  expect(c.ons()).toHaveLength(attacks)
  expect(c.output.getDiagnostics().activeNotes).toEqual([])
  strike(c.session,c.own.sequence.occurrences[0].sourceTarget.expectedMidiNotes)
  expect(c.controller.getSnapshot().status).toBe('playing')
  expect(c.session.getSnapshot()).toMatchObject({currentNoteIndex:1,correctNoteCount:1})
  c.controller.stop()
  const stopped=c.ons().length
  vi.advanceTimersByTime(10000)
  expect(c.ons()).toHaveLength(stopped)
})
it('timed records right, missing, extra and absent attempts at the correct windows without input-driven skips', async () => {
  const c=await setup('primo','once')
  c.session.setFlowMode('run-through'); c.controller.start({kind:'beginning'},false)
  strike(c.session,[...c.own.sequence.occurrences[0].sourceTarget.expectedMidiNotes,60])
  expect(c.session.getSnapshot().currentNoteIndex).toBe(0)
  vi.advanceTimersByTime(Math.ceil(c.timeline.targetStarts[1]))
  expect(c.session.getSnapshot().attempts[0]).toMatchObject({matchedMidiNotes:[79],unexpectedMidiNotes:[60],missingMidiNotes:[],result:'incorrect'})
  strike(c.session,c.own.sequence.occurrences[1].sourceTarget.expectedMidiNotes)
  vi.advanceTimersByTime(Math.ceil(c.timeline.targetStarts[2])-performance.now())
  expect(c.session.getSnapshot().attempts[1].result).toBe('correct')
  vi.advanceTimersByTime(Math.ceil(c.timeline.endMs)-performance.now()+1)
  expect(c.session.getSnapshot().attempts[2]).toMatchObject({playedMidiNotes:[],missingMidiNotes:[77],result:'incorrect'})
  expect(c.session.getSnapshot().status).toBe('completed')
  expect(c.ons()).toHaveLength(0)
})
it.each(['primo','secondo'] as const)('%s: measure starts use pass 1; current starts preserve pass 2 and restore only still-sounding partner notes', async part => {
  const c=await setup(part)
  c.session.setFlowMode('run-through')
  expect(from(c,{kind:'measure',measureIndex:29})).toBe(true)
  vi.advanceTimersByTime(300)
  const first=c.ons()[0]
  expect(first[0][1]).toBe(c.timeline.notes.find(n=>n.startMs>=c.timeline.measureStarts[29])!.midiNote)
  c.controller.stop()
  const pass2=c.own.sequence.occurrences.findIndex(o=>o.repeatPass===2)
  const count=c.ons().length
  expect(from(c,{kind:'current',occurrenceIndex:pass2})).toBe(true)
  const offset=c.timeline.targetStarts[pass2], started=performance.now()
  vi.advanceTimersByTime(Math.ceil(c.timeline.endMs-offset)+1)
  const expected=c.timeline.notes.filter(n=>n.noteOffMs>offset)
  expect(c.ons().slice(count).map(([d])=>d[1])).toEqual(expected.map(n=>n.midiNote))
  expect(c.session.getSnapshot().attempts).toHaveLength(c.own.sequence.occurrences.length-pass2)
  expect(c.ons().slice(count).every(([,timestamp])=>timestamp>=started)).toBe(true)
})
it.each([true,false])('stop and stale callbacks never re-attack or alter a new session (MIDI clear=%s)', async clear => {
  const c=await setup('primo','once',clear)
  const spy=vi.spyOn(globalThis,'setTimeout')
  c.session.setFlowMode('run-through'); c.controller.start({kind:'beginning'},true)
  const callbacks=spy.mock.calls.map(([fn])=>fn).filter((fn):fn is ()=>void=>typeof fn==='function')
  c.controller.stop()
  expect(c.port.send.mock.calls.some(([d])=>d[0]===0xb0 && d[1]===123)).toBe(true)
  vi.advanceTimersByTime(1000)
  c.controller.start({kind:'beginning'},true)
  const count=c.ons().length, before=c.session.getSnapshot()
  callbacks.forEach(fn=>fn())
  expect(c.ons()).toHaveLength(count)
  expect(c.session.getSnapshot()).toBe(before)
  c.controller.stop(); vi.advanceTimersByTime(10000)
  expect(c.ons()).toHaveLength(count)
  expect(c.controller.getDiagnostics()).toMatchObject({timers:0,outputOwned:false})
})
it('without clear, waiting drains old Offs before resuming a long note; mode reset stops all timers', async () => {
  const c=await setup('primo','once',false)
  from(c,{kind:'measure',measureIndex:12})
  vi.advanceTimersByTime(Math.ceil(c.timeline.targetStarts[c.session.getSnapshot().currentNoteIndex+1]-c.timeline.measureStarts[12]))
  expect(c.controller.getSnapshot().status).toBe('waiting')
  strike(c.session,c.session.getSnapshot().expectedMidiNotes)
  vi.advanceTimersByTime(2000)
  expect(c.session.getSnapshot().correctNoteCount).toBe(1)
  c.controller.stop(); c.session.setFlowMode('run-through')
  const count=c.ons().length
  vi.advanceTimersByTime(10000)
  expect(c.ons()).toHaveLength(count)
})
it('synchronous MIDI loopback from the app does not grade the opposite part', async () => {
  const c=await setup('primo','once')
  c.port.send.mockImplementation(data => { if(data[0]===0x90) strike(c.session,[data[1]]) })
  c.session.setFlowMode('run-through'); c.controller.start({kind:'beginning'},true)
  vi.advanceTimersByTime(1000)
  expect(c.session.getSnapshot().attempts.every(a=>a.playedMidiNotes.length===0)).toBe(true)
  c.controller.stop()
})
it('emergency output stop, disconnection and plan/part reset cancel the transport and keep selected ports', async () => {
  const c=await setup()
  c.session.setFlowMode('run-through'); c.controller.start({kind:'beginning'},true)
  c.output.stopAllNotes()
  expect(c.session.getSnapshot().status).toBe('idle')
  expect(c.controller.getDiagnostics().timers).toBe(0)
  c.controller.start({kind:'beginning'},true)
  c.controller.loadPlans(...plans('secondo'))
  const count=c.ons().length
  vi.advanceTimersByTime(10000)
  expect(c.ons()).toHaveLength(count)
  expect(c.output.getSnapshot().selectedOutputId).toBe('out')
  c.session.loadPlan(c.own); c.controller.loadPlans(c.own,c.partner)
  c.controller.start({kind:'beginning'},true)
  c.port.state='disconnected'; c.output.refreshOutputs()
  expect(c.controller.getDiagnostics().timers).toBe(0)
  expect(c.session.getSnapshot().status).toBe('idle')
})
it('rejects mismatched repeats, measures and tempos before any output or grading', async () => {
  const c=await setup()
  const wrong=plans('secondo','once')[0]
  expect(()=>validateDuetPair(c.own.score,wrong.score)).toThrow('一致')
  expect(()=>validateDuetPair(c.own.score,{...c.partner.score,tempos:[]})).toThrow('一致')
  c.controller.loadPlans(c.own,wrong)
  expect(c.controller.start({kind:'beginning'},true)).toBe(false)
  expect(c.controller.getSnapshot().status).toBe('error')
  expect(c.session.getSnapshot().status).toBe('idle')
  expect(c.ons()).toHaveLength(0)
})
