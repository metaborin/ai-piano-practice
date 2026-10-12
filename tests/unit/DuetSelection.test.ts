import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { DOMParser } from '@xmldom/xmldom'
import { duetSongs } from '../../src/songs/duetSongs'
import { SongSelection } from '../../src/score/SongSelection'
import { parseXml } from './xmlFixture'
import type { Song } from '../../src/songs/Song'

afterEach(()=>vi.unstubAllGlobals())
const xml=(part:string,version='once')=>readFileSync(new URL(`../../src/scores/duet/maim-maim-${part}-${version}.musicxml`,import.meta.url),'utf8')
function setup(obtain?: (song:Song)=>Promise<string>) {
  vi.stubGlobal('DOMParser',DOMParser)
  const reset=vi.fn(),apply=vi.fn(),position=vi.fn()
  const selection=new SongSelection(null,{reset,apply,position,obtain:obtain??(async song=>xml(song.partLabel.startsWith('PRIMO')?'primo':'secondo',song.id.endsWith('original')?'original':'once'))})
  const ready=(id=selection.getSnapshot().requestId)=>{ const source=selection.getSnapshot().source!;selection.ready(id,{...parseXml(source.musicXml),...source}) }
  return {selection,reset,apply,position,ready}
}
it('both originals are ready together; toggling part replaces target XML, opposite plan and all start state',async()=>{
  const c=setup()
  await c.selection.select(duetSongs[0]); c.ready()
  expect(c.selection.getSnapshot()).toMatchObject({status:'ready',duetPart:'secondo',plan:{targets:expect.any(Array)},partnerPlan:{score:{musicXml:xml('primo')}}})
  expect(c.apply.mock.calls[0][0].score.musicXml).toBe(xml('secondo'))
  c.selection.setPracticeStart({kind:'measure',measureIndex:15})
  await c.selection.setDuetPart('primo')
  expect(c.selection.getSnapshot()).toMatchObject({status:'loading',model:null,plan:null,partnerPlan:null,practiceStart:{kind:'beginning'}})
  c.ready()
  expect(c.selection.getSnapshot().plan!.targets).toHaveLength(87)
  expect(c.selection.getSnapshot().partnerPlan!.targets).toHaveLength(109)
  expect(c.position).toHaveBeenLastCalledWith(0)
})
it('rapid PRIMO→SECONDO→PRIMO ignores stale acquisition, render completion and errors from either side',async()=>{
  const pending: {song:Song;resolve:(value:string)=>void;reject:(e:Error)=>void}[]=[]
  const c=setup(song=>new Promise((resolve,reject)=>pending.push({song,resolve,reject})))
  const a=c.selection.select(duetSongs[0]),aid=c.selection.getSnapshot().requestId
  const b=c.selection.setDuetPart('primo'),bid=c.selection.getSnapshot().requestId
  const d=c.selection.setDuetPart('secondo')
  pending.slice(4).forEach(p=>p.resolve(xml(p.song.partLabel.startsWith('PRIMO')?'primo':'secondo')))
  await d;c.ready()
  const snapshot=c.selection.getSnapshot()
  pending.slice(0,2).forEach(p=>p.resolve(xml('primo')));await a
  pending.slice(2,4).forEach(p=>p.reject(new Error('old failure')));await b
  c.selection.ready(aid,{...parseXml(xml('primo')),id:duetSongs[0].id});c.selection.fail(bid,'old error')
  expect(c.selection.getSnapshot()).toBe(snapshot)
  expect(c.apply).toHaveBeenCalledTimes(1)
})
it.each(['unavailable','xml','mismatch','empty'])('partner %s failure clears both sides and another selection recovers',async failure=>{
  let fail=true
  const c=setup(async song=>{
    if(fail && song.partLabel.startsWith('PRIMO')){
      if(failure==='unavailable')throw new Error('offline')
      if(failure==='xml')return '<junk/>'
      if(failure==='empty')return xml('primo').replace(/<note>[\s\S]*?<\/note>/g,'')
      return xml('primo').replace('tempo="232"','tempo="120"')
    }
    return xml(song.partLabel.startsWith('PRIMO')?'primo':'secondo')
  })
  await c.selection.select(duetSongs[0])
  if(c.selection.getSnapshot().source)c.ready()
  expect(c.selection.getSnapshot()).toMatchObject({status:'error',source:null,model:null,plan:null,partnerPlan:null,canPractice:false})
  expect(c.apply).not.toHaveBeenCalled()
  fail=false;await c.selection.select(duetSongs[0]);c.ready()
  expect(c.selection.getSnapshot().status).toBe('ready')
})
it('changing hands at a current start seeks the next new attack in the same repeat pass',async()=>{
  const c=setup()
  await c.selection.select(duetSongs[1]);c.ready()
  const before=c.selection.getSnapshot().plan!
  const index=before.sequence.occurrences.findIndex(o=>o.repeatPass===2 && o.sourceMoment.measureNumber==='13' && o.sourceMoment.onsetBeats===49)
  expect(index).toBeGreaterThan(0)
  c.selection.setPracticeStart({kind:'current',occurrenceIndex:index})
  c.selection.setMode('right',index)
  const state=c.selection.getSnapshot()
  const selected=state.plan!.sequence.occurrences[state.startPosition!.resolvedOccurrenceIndex!]
  expect(selected.repeatPass).toBe(2)
  // Bars 13-14 are tied in the existing right-hand source: next attack is 15.
  expect(selected.sourceMoment.measureNumber).toBe('15')
  expect(selected.sourceTarget.expectedMidiNotes).toEqual([60,64])
})
