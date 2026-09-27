import { afterEach, expect, it, vi } from 'vitest'
import { parseFixture, parseXml, noteXml } from './xmlFixture'
import { buildPlaybackSequence, MAX_SEQUENCE_OCCURRENCES } from '../../src/score/ScoreNavigation'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { PracticeSession } from '../../src/practice/PracticeSession'
import { resolvePracticeStart } from '../../src/practice/PracticeStartResolver'
import { resolveDemoStart } from '../../src/audio/DemoStart'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import { DemoPlayer } from '../../src/audio/DemoPlayer'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'
import { missingSourceNoteIds } from '../../src/score/ScoreNoteRenderMap'
import { createValidationReport } from '../../src/score/validationReport'
import { SongSelection } from '../../src/score/SongSelection'
import { recheckCompatibility } from '../../src/songs/inspectMusicXml'
import { DOMParser } from '@xmldom/xmldom'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
const original = () => parseFixture('maim-maim-full-original')
const bar = (direction: string, location = direction === 'forward' ? 'left' : 'right', attrs = '') => `<barline location="${location}"><repeat direction="${direction}" ${attrs}/></barline>`
const xml = (bars: readonly [string, string][]) => `<score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${bars.map(([before, after], i) => `<measure number="${i+1}"><attributes><divisions>1</divisions></attributes>${before}${noteXml(i % 2 ? 'D' : 'C')}${after}</measure>`).join('')}</part></score-partwise>`
const order = (source: string) => buildPlaybackSequence(parseXml(source)).measures.map(m => m.source.index + 1)
function strike(session: PracticeSession, pitches: readonly number[]) {
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteon', midiNote, velocity: 80, timestamp: performance.now(), channel: 1 })
  for (const midiNote of pitches) session.handleMidiEvent({ type: 'noteoff', midiNote, velocity: 0, timestamp: performance.now(), channel: 1 })
}

it('once retains written order and source identities; original derives 5–30 and 56 measure occurrences', () => {
  const once = parseFixture('maim-maim-full-once'), score = original()
  expect(once.navigation).toEqual({ repeats: [], reasons: [] })
  expect(buildPlaybackSequence(once).moments.map(o => o.sourceMoment)).toEqual(once.moments)
  expect(score.practiceCompatibility).toBe('pitchPractice')
  expect(score.navigation.repeats).toEqual([{ id: 'repeat:4:29', startMeasureIndex: 4, endMeasureIndex: 29, totalPasses: 2 }])
  const seq = buildPlaybackSequence(score)
  expect(seq.measures.map(o => o.source.index+1)).toEqual([...Array.from({length:30}, (_,i)=>i+1), ...Array.from({length:26}, (_,i)=>i+5)])
  expect(score.measures).toHaveLength(30); expect(score.moments).toHaveLength(109)
  expect(new Set(seq.moments.map(o=>o.id)).size).toBe(seq.moments.length)
  const occurrences = seq.moments.filter(o=>o.sourceMoment === score.moments.find(m=>m.measureNumber === '5'))
  expect(occurrences.map(o=>o.repeatPass)).toEqual([1,2])
  expect(occurrences[0].sourceMoment).toBe(occurrences[1].sourceMoment)
  expect(createValidationReport(score)).toMatchObject({ supported:true, expandedMeasures: seq.measures.map(o=>o.source.number), steps:{right:88,left:144,both:204} })
})
it.each([
  [[['',''],['',bar('backward')]], [1,2,1,2]],
  [[[bar('forward'),''],['',bar('backward','right','times="3"')]], [1,2,1,2,1,2]],
  [[[bar('forward'),bar('backward','right','times="1"')]], [1]],
  [[[bar('forward'),bar('backward')],[bar('forward'),bar('backward')]], [1,1,2,2]],
  [[['',bar('forward','right')],['',''],[bar('backward','left'),'']], [1,2,2,3]],
  [[['',''],['','<barline><repeat direction="backward"/></barline>']], [1,2,1,2]],
] as [ [string,string][], number[] ][])('parses repeat boundaries, omitted forward, total times and independent regions %j', (bars, expected) => expect(order(xml(bars))).toEqual(expected))

it.each([
  [[bar('forward'),''],[bar('forward'),bar('backward')],['',bar('backward')]],
  [[bar('forward'),'']],
  [[bar('backward','left'),'']],
  [[bar('forward','middle'),bar('backward')]],
  [['',bar('backward')],['',bar('backward')]],
  [['','<barline><ending number="1" type="start"/></barline>']],
  [['<direction><sound dacapo="yes"/></direction>','']],
  [['<direction><direction-type><words>D.S. al Coda</words></direction-type></direction>','']],
  [['<direction><direction-type><segno/></direction-type></direction>','']],
  [['<direction><sound fine="yes"/></direction>','']],
  [['',bar('backward','right','times="0"')]],
  [['',bar('backward','right','times="1.5"')]],
  [['',bar('backward','right','times="999999999999999999"')]],
] .map(bars => ({ bars: bars as [string,string][] })))('keeps unsupported / malformed navigation display-only: %j', ({bars}) => {
  const score = parseXml(xml(bars))
  expect(score.practiceCompatibility).toBe('unsupported'); expect(createPracticePlan(score)).toBeNull()
  expect(score.practiceReasons.join()).toContain('現在未対応の演奏順記号あり')
})
it('caps expanded notes as well as measures without looping on a malicious repeat count', () => {
  const score = parseXml(xml([['',bar('backward','right',`times="${MAX_SEQUENCE_OCCURRENCES+1}"`)]]))
  expect(score.practiceCompatibility).toBe('unsupported')
  const valid = original()
  expect(()=>buildPlaybackSequence({...valid,navigation:{repeats:[{...valid.navigation.repeats[0],totalPasses:MAX_SEQUENCE_OCCURRENCES}],reasons:[]}})).toThrow('上限')
  expect(()=>buildPlaybackSequence({...valid,navigation:{repeats:[{...valid.navigation.repeats[0],endMeasureIndex:-1}],reasons:[]}})).toThrow('不正')
})
it.each(['right','left','both'] as const)('%s practices both passes with expanded progress, fresh feedback, exact completion and retry', mode => {
  const plan = createPracticePlan(original(),mode)!, occurrences = plan.sequence.occurrences, session = new PracticeSession()
  session.loadPlan(plan); session.start()
  expect(session.getSnapshot().totalNotes).toBe(mode==='right'?88:mode==='left'?144:204)
  const second = occurrences.findIndex(o=>o.repeatPass===2)
  for (const o of occurrences.slice(0,second)) strike(session,o.sourceTarget.expectedMidiNotes)
  expect(session.getSnapshot()).toMatchObject({status:'practicing',currentNoteIndex:second,feedback:null,matchFeedback:null})
  expect(occurrences[second].sourceTarget.measureNumber).toBe('5')
  strike(session,[127]); expect(session.getSnapshot().feedback).toBe('incorrect')
  expect(missingSourceNoteIds(plan,session.getSnapshot().matchFeedback)).not.toHaveLength(0)
  strike(session,occurrences[second].sourceTarget.expectedMidiNotes)
  expect(missingSourceNoteIds(plan,session.getSnapshot().matchFeedback)).toEqual([])
  for (const o of occurrences.slice(second+1)) strike(session,o.sourceTarget.expectedMidiNotes)
  expect(session.getSnapshot()).toMatchObject({status:'completed',correctNoteCount:occurrences.length,currentNoteIndex:occurrences.length-1})
  session.restart(); expect(session.getSnapshot().currentNoteIndex).toBe(0)
  const position = resolvePracticeStart(plan,{kind:'measure',measureIndex:9})
  const first = occurrences[position.resolvedOccurrenceIndex!]
  expect(first.repeatPass).toBe(1)
  const secondPosition = resolvePracticeStart(plan,{kind:'measure',measureIndex:9},{repeatRegionId:first.repeatRegionId,repeatPass:2})
  session.setStartTarget(secondPosition.resolvedOccurrenceIndex); session.start(); strike(session,session.getSnapshot().expectedMidiNotes); session.restart()
  expect(session.getSnapshot().currentNoteIndex).toBe(secondPosition.resolvedOccurrenceIndex)
  expect(plan.targets[first.sourceTargetIndex]).toBe(first.sourceTarget)
})
it.each(['right','left','both'] as const)('%s demo follows the same occurrences with monotonic time and bounded note-offs at the jump', mode => {
  const plan = createPracticePlan(original(),mode)!, notes = buildDemoPlan(plan), occurrences = plan.sequence.occurrences
  const second = occurrences.findIndex(o=>o.repeatPass===2), jump = notes.find(n=>n.index===second)!.startMs
  expect([...new Set(notes.map(n=>n.index))]).toEqual(occurrences.map(o=>o.sequenceIndex))
  for(let i=1;i<notes.length;i++) expect(notes[i].startMs).toBeGreaterThanOrEqual(notes[i-1].startMs)
  expect(notes.filter(n=>n.index<second).every(n=>n.noteOffMs<=jump)).toBe(true)
  expect(jump).toBeCloseTo((plan.score.totalBeats + occurrences[second].sourceMoment.onsetBeats - plan.score.measures[4].onsetBeats)*60000/232)
  expect(notes.filter(n=>n.index<second).every(n=>n.noteOffMs<=plan.score.totalBeats*60000/232+1e-8)).toBe(true)
  const firstStart = resolveDemoStart(plan,{kind:'measure',measureIndex:9})
  expect(occurrences[firstStart.index].repeatPass).toBe(1)
  const secondTen = occurrences.find(o=>o.repeatPass===2 && o.sourceMoment.measureNumber==='10')!
  const remaining = buildDemoPlan(plan,{kind:'occurrence',occurrenceId:secondTen.id})
  expect(remaining[0].index).toBe(secondTen.sequenceIndex); expect(remaining[0].startMs).toBe(0)
  expect(remaining.every(n=>occurrences[n.index].repeatPass===2)).toBe(true)
  expect(buildDemoPlan(plan,{kind:'measure',measureIndex:9}).length).toBeGreaterThan(remaining.length)
})
it('tie-only practice starts still seek new attacks in the requested pass; demo reconstructs the boundary tie', () => {
  const plan = createPracticePlan(original(),'right')!
  const position = resolvePracticeStart(plan,{kind:'measure',measureIndex:13},{repeatRegionId:'repeat:4:29',repeatPass:2})
  expect(position).toMatchObject({resolvedTargetIndex:25,resolvedMeasure:{number:'15'},reason:'next-measure'})
  expect(plan.sequence.occurrences[position.resolvedOccurrenceIndex!].repeatPass).toBe(2)
  const demo = buildDemoPlan(plan,{kind:'measure',measureIndex:13})
  expect(demo.filter(n=>n.startMs===0).map(n=>n.midiNote)).toEqual([62,65])
  expect(demo[0].cursorMomentId).toBe(plan.score.moments.find(m=>m.measureNumber==='14')!.id)
})
it('mode changes retain the requested bar and current repeat pass where that start can be resolved', async () => {
  const score=original(), session=new PracticeSession()
  const song={id:score.id,title:score.title,partLabel:'',source:'builtin' as const,musicXml:{type:'text' as const,value:score.musicXml}}
  const selection = new SongSelection(song,{reset:()=>session.loadPlan(null),apply:session.loadPlan,position:session.setStartTarget})
  await selection.select(song); selection.ready(selection.getSnapshot().requestId,score)
  selection.setPracticeStart({kind:'measure',measureIndex:9})
  const second=selection.getSnapshot().plan!.sequence.occurrences.find(o=>o.repeatPass===2 && o.sourceMoment.measureNumber==='10')!
  selection.setMode('right',second.sequenceIndex)
  expect(selection.getSnapshot().practiceStart).toEqual({kind:'measure',measureIndex:9})
  expect(selection.getSnapshot().plan!.sequence.occurrences[session.getSnapshot().currentNoteIndex].repeatPass).toBe(2)
  selection.setPracticeStart({kind:'measure',measureIndex:9})
  expect(selection.getSnapshot().plan!.sequence.occurrences[session.getSnapshot().currentNoteIndex].repeatPass).toBe(1)
})
it.each([true,false])('real MIDI manager schedules both passes, releases before jump, restores practice and cancels future output (clear=%s)', async clear => {
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']})
  const port={id:'cme',name:'CME',state:'connected',open:vi.fn().mockResolvedValue(undefined),close:vi.fn(),send:vi.fn(),clear:clear?vi.fn():undefined}
  const output=new MidiOutputManager(); output.attachAccess({outputs:new Map([['cme',port]])} as unknown as MIDIAccess); await Promise.resolve()
  const plan=createPracticePlan(original())!, session=new PracticeSession(); session.loadPlan(plan)
  const practiceIndex=plan.sequence.occurrences.findIndex(o=>o.repeatPass===2 && o.sourceMoment.measureNumber==='10')
  session.setStartTarget(practiceIndex); session.start()
  const player=new DemoPlayer(output,session.beginDemo); player.subscribe(()=>{if(player.getSnapshot().status!=='playing')session.endDemo()});player.loadPlan(plan)
  player.start({kind:'measure',measureIndex:29})
  vi.advanceTimersByTime(1100)
  expect(plan.sequence.occurrences[player.getSnapshot().currentNoteIndex].repeatPass).toBe(2)
  expect(plan.sequence.occurrences[player.getSnapshot().currentNoteIndex].sourceMoment.measureNumber).toBe('5')
  strike(session,session.getSnapshot().expectedMidiNotes);expect(session.getSnapshot().correctNoteCount).toBe(0)
  const ons=port.send.mock.calls.filter(([data])=>data[0]===0x90)
  for(let i=1;i<ons.length;i++)expect(ons[i][1]).toBeGreaterThanOrEqual(ons[i-1][1])
  player.stop();expect(session.getSnapshot()).toMatchObject({status:'practicing',currentNoteIndex:practiceIndex})
  expect(port.send.mock.calls.at(-1)![0]).toEqual([0xb0,123,0])
  const count=port.send.mock.calls.length;vi.advanceTimersByTime(120000);expect(port.send).toHaveBeenCalledTimes(count)
  player.playFromOccurrence(plan.sequence.occurrences[practiceIndex].id);vi.advanceTimersByTime(120000)
  expect(player.getSnapshot().status).toBe('completed');expect(session.getSnapshot().currentNoteIndex).toBe(practiceIndex)
})
it('rechecks a previously unsupported stored original from unchanged XML', () => {
  vi.stubGlobal('DOMParser',DOMParser)
  const score=original()
  const song = recheckCompatibility({id:'old',title:'Original',partLabel:'',source:'imported',musicXml:{type:'text',value:score.musicXml},originalFileName:'original.musicxml',compatibility:{version:3,status:'unsupported',reasons:['反復・演奏順の指定']}})
  expect(song.compatibility?.status).toBe('supported');expect(song.musicXml.value).toBe(score.musicXml)
})
it('clips a tie at the backward jump, then retains its normal continuation on the final pass', () => {
  const source=xml([[bar('forward'),''],['',bar('backward')],['','']])
    .replace(noteXml('D'),noteXml('D',1,'<tie type="start"/>'))
    .replace(`<measure number="3"><attributes><divisions>1</divisions></attributes>${noteXml('C')}`,`<measure number="3"><attributes><divisions>1</divisions></attributes>${noteXml('D',1,'<tie type="stop"/>')}`)
  const plan=createPracticePlan(parseXml(source))!, notes=buildDemoPlan(plan)
  expect(plan.sequence.playback.measures.map(o=>o.source.number)).toEqual(['1','2','1','2','3'])
  expect(notes.map(n=>[n.midiNote,n.startMs,n.noteOffMs])).toEqual([[60,0,540],[62,600,1200],[60,1200,1740],[62,1800,2940]])
  expect(notes[1].noteOffMs).toBeLessThanOrEqual(notes[2].startMs)
  // A tie-only bar after the repeat follows the final pass, not its first attack.
  expect(resolveDemoStart(plan,{kind:'measure',measureIndex:2})).toMatchObject({index:3,measureOccurrenceIndex:4})
  expect(buildDemoPlan(plan,{kind:'measure',measureIndex:2})).toMatchObject([{index:3,midiNote:62,startMs:0,noteOffMs:540}])
})
it('replays written tempo changes and rests on a continuous timeline on every pass', () => {
  const source=xml([[bar('forward'),''],['',bar('backward','right','times="3"')]])
    .replace('<divisions>1</divisions></attributes>', '<divisions>1</divisions></attributes><sound tempo="60"/>')
    .replace('<measure number="2">','<measure number="2"><sound tempo="120"/>')
  const plan=createPracticePlan(parseXml(source))!
  expect(buildDemoPlan(plan).map(n=>n.startMs)).toEqual([0,1000,1500,2500,3000,4000])
  const silent=source.replace(noteXml('C'),'<note><rest/><duration>1</duration></note>')
  expect(buildDemoPlan(createPracticePlan(parseXml(silent))!).map(n=>n.startMs)).toEqual([1000,2500,4000])
})
it('the note occurrence cap rejects dense repeats even when measure and moment counts are below the cap', () => {
  const source=xml([['',bar('backward','right','times="50001"')]]).replace(noteXml('C'),noteXml('C')+noteXml('E').replace('<note>','<note><chord/>'))
  const score=parseXml(source)
  expect(score.practiceCompatibility).toBe('unsupported');expect(score.practiceReasons.join()).toContain('展開上限')
})
it('constructs a large one-measure-repeat demo within the bounded sequence without repeated full scans', () => {
  const plan=createPracticePlan(parseXml(xml([['',bar('backward','right','times="20000"')]])))!
  const notes=buildDemoPlan(plan)
  expect(notes).toHaveLength(20000);expect(notes.at(-1)).toMatchObject({index:19999,startMs:19999*600,noteOffMs:19999*600+540})
})
