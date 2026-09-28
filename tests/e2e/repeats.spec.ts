import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'
import { buildDemoPlan } from '../../src/audio/buildDemoPlan'
import JSZip from 'jszip'

const score = parseFixture('maim-maim-full-original')
async function setup(page: Page, xml = fixture('maim-maim-full-original'), compressed = false) {
  await page.setViewportSize({width:1366,height:768}); await page.emulateMedia({reducedMotion:'reduce'})
  await mockMidi(page); await page.goto('./'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button',{name:'MIDI接続',exact:true}).click()
  const buffer = compressed ? await new JSZip().file('META-INF/container.xml','<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>').file('score.musicxml',xml).generateAsync({type:'nodebuffer'}) : Buffer.from(xml)
  await page.locator('input[type=file]').setInputFiles({name:compressed?'original.mxl':'original.musicxml',mimeType:compressed?'application/vnd.recordare.musicxml':'application/xml',buffer})
  await page.getByRole('form',{name:'曲の登録確認'}).getByRole('button',{name:'追加する',exact:true}).click()
  await page.locator('.personal-song-list > li').getByRole('button',{name:'選択',exact:true}).click()
  await expect(page.locator('.score-renderer svg')).toBeVisible()
}
async function strike(page:Page, targets:readonly (readonly number[])[]) {
  await page.evaluate(targets=>{for(const pitches of targets){
    for(const pitch of pitches)window.midiTest.send([0x90,pitch,80])
    for(const pitch of pitches)window.midiTest.send([0x80,pitch,0])
  }},targets)
}
async function visible(page:Page) {
  await expect.poll(()=>page.evaluate(()=>{
    const c=document.querySelector('.score-renderer img')?.getBoundingClientRect(),v=document.querySelector('.score-view')?.getBoundingClientRect(),h=document.querySelector('.score-status')?.getBoundingClientRect()
    return !!(c&&v&&h&&c.height>0&&c.top>=Math.max(v.top,h.bottom,0)-1&&c.bottom<=Math.min(v.bottom,innerHeight)+1)
  })).toBe(true)
}
async function clock(page:Page){await page.clock.install();await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)))}
const button=(page:Page,name:string)=>page.getByRole('button',{name,exact:true})

for(const [mode,label] of [['right','右手'],['left','左手'],['both','両手']] as const){
  const plan=createPracticePlan(score,mode)!, occurrences=plan.sequence.occurrences, second=occurrences.findIndex(o=>o.repeatPass===2)
  test(`original ${label}: written score once, 30→5 practice, backwards follow, second-pass feedback and completion`,async({page})=>{
    await setup(page);await button(page,label).click()
    await expect(page.locator('.position')).toHaveText(`1 / ${occurrences.length} ステップ`)
    await expect(page.locator('.repeat-position')).toHaveCount(0)
    const heads=await page.locator('.score-renderer [data-score-notes]').count()
    await button(page,'練習開始').click()
    await strike(page,occurrences.slice(0,second-1).map(o=>o.sourceTarget.expectedMidiNotes))
    await expect(page.locator('.current-measure')).toHaveText('30小節目');await visible(page)
    await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
    const bottom=await page.locator('.score-view').evaluate(el=>el.scrollTop)
    await strike(page,[occurrences[second-1].sourceTarget.expectedMidiNotes])
    await expect(page.locator('.current-measure')).toHaveText('5小節目');await expect(page.locator('.repeat-position')).toHaveText('反復 2回目');await visible(page)
    expect(await page.locator('.score-view').evaluate(el=>el.scrollTop)).toBeLessThan(bottom)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','practicing')
    await expect(page.locator('.position')).toHaveText(`${second+1} / ${occurrences.length} ステップ`)
    await expect(page.locator('.score-renderer [data-missing-note]')).toHaveCount(0)
    await strike(page,[[127]])
    await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪');await expect(page.locator('.score-renderer [data-missing-note]')).not.toHaveCount(0)
    await strike(page,[occurrences[second].sourceTarget.expectedMidiNotes]);await expect(page.locator('.score-renderer [data-missing-note]')).toHaveCount(0)
    if(mode==='both')await page.screenshot({path:'test-results/phase2ed32-repeat.png'})
    await strike(page,occurrences.slice(second+1).map(o=>o.sourceTarget.expectedMidiNotes))
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','completed')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count',String(occurrences.length))
    await expect(page.locator('.score-renderer [data-score-notes]')).toHaveCount(heads)
    await button(page,'もう一度').click();await expect(page.locator('.position')).toHaveText(`1 / ${occurrences.length} ステップ`);await visible(page)
    await page.getByText('開発者用',{exact:true}).click()
    await expect(page.getByRole('region',{name:'楽譜検証レポート'})).toContainText('Repeat range：5〜30 ／ Repeat total passes：2')
    await expect(page.getByRole('region',{name:'楽譜検証レポート'})).toContainText('Expanded measures（56小節）')
    expect(await page.evaluate(()=>window.midiTest.requests)).toBe(1);expect(await page.evaluate(()=>window.midiTest.inputListenerCount())).toBe(1)
  })
  test(`original ${label}: demo shares full order and MIDI timestamps, reverse cursor, stop and completion restore occurrence`,async({page})=>{
    await setup(page);await button(page,label).click();await clock(page)
    await page.getByRole('combobox',{name:'練習の開始位置',exact:true}).selectOption('measure:9')
    await button(page,'練習開始').click()
    const practicePosition=await page.locator('.position').innerText()
    await page.evaluate(()=>window.midiTest.loopback=true)
    await button(page,'手本を聴く').click()
    const notes=buildDemoPlan(plan),last=notes.find(n=>n.index===second-1)!,jump=notes.find(n=>n.index===second)!
    // Inspect before the look-ahead event (which can start 1 ms after this attack).
    await page.clock.runFor(Math.ceil(last.startMs));await expect(page.locator('.current-measure')).toHaveText('30小節目');await visible(page)
    const bottom=await page.locator('.score-view').evaluate(el=>el.scrollTop)
    await page.clock.runFor(Math.ceil(jump.startMs)-Math.ceil(last.startMs)+1)
    await expect(page.locator('.current-measure')).toHaveText('5小節目');await expect(page.locator('.repeat-position')).toHaveText('反復 2回目');await visible(page)
    expect(await page.locator('.score-view').evaluate(el=>el.scrollTop)).toBeLessThan(bottom)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
    await button(page,'停止').click();await expect(page.locator('.position')).toHaveText(practicePosition);await visible(page)
    const stopped=await page.evaluate(()=>window.midiTest.outputMessages.length);await page.clock.runFor(120000)
    expect(await page.evaluate(()=>window.midiTest.outputMessages.length)).toBe(stopped)
    await page.evaluate(()=>window.midiTest.outputMessages=[])
    await button(page,'手本を聴く').click();await page.clock.runFor(120000)
    await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status','completed')
    await expect(page.locator('.position')).toHaveText(practicePosition);await visible(page)
    const messages=await page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90))
    expect(messages.map(m=>m.data[1])).toEqual(notes.map(n=>n.midiNote))
    for(let i=0;i<messages.length;i++)expect(messages[i].timestamp-messages[0].timestamp).toBeCloseTo(notes[i].startMs-notes[0].startMs,5)
  })
}
test('measure selects first pass, current demo and mode changes keep second pass, retry returns the resolved start',async({page})=>{
  await setup(page)
  const plan=createPracticePlan(score)!, occurrences=plan.sequence.occurrences
  const select=page.getByRole('combobox',{name:'練習の開始位置',exact:true}), demoSelect=page.getByRole('combobox',{name:'手本の開始位置',exact:true})
  await select.selectOption('measure:9');await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
  await button(page,'練習開始').click()
  const first=occurrences.findIndex(o=>o.sourceMoment.measureNumber==='10'),second=occurrences.findIndex(o=>o.sourceMoment.measureNumber==='10'&&o.repeatPass===2)
  await strike(page,occurrences.slice(first,second).map(o=>o.sourceTarget.expectedMidiNotes));await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  await expect(page.locator('.current-measure')).toHaveText('10小節目')
  await clock(page);await demoSelect.selectOption('current');await button(page,'手本を聴く').click()
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  await page.clock.runFor(120000);await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status','completed')
  const ons=await page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90).map(m=>m.data[1]))
  expect(ons).toEqual(buildDemoPlan(plan,{kind:'occurrence',occurrenceId:occurrences[second].id}).map(n=>n.midiNote))
  await expect(page.locator('.position')).toHaveText(`${second+1} / 204 ステップ`);await visible(page)
  await button(page,'右手').click();await expect(select).toHaveValue('measure:9');await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const rightPosition=await page.locator('.position').innerText()
  await button(page,'練習開始').click();await strike(page,[[55,59]]);await button(page,'もう一度').click();await expect(page.locator('.position')).toHaveText(rightPosition)
  await select.selectOption('measure:13');await expect(page.locator('.current-measure')).toHaveText('15小節目');await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
  await demoSelect.selectOption('measure:13');await page.evaluate(()=>window.midiTest.outputMessages=[]);await button(page,'手本を聴く').click()
  await expect(page.locator('.current-measure')).toHaveText('14小節目')
  expect(await page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90).map(m=>m.data[1]))).toEqual([62,65])
  await page.clock.runFor(19000);await expect(page.locator('.repeat-position')).toHaveText('反復 2回目');await button(page,'停止').click()
  await expect(page.locator('.current-measure')).toHaveText('15小節目');await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
})
test('unsupported ending remains display-only and a different song recovers',async({page})=>{
  await setup(page,fixture('maim-maim-full-original').replace('<repeat direction="backward"', '<ending number="1" type="stop"/><repeat direction="backward"'))
  await expect(button(page,'練習開始')).toBeDisabled();await expect(button(page,'手本を聴く')).toBeDisabled()
  await expect(page.locator('.score-message')).toContainText('現在未対応の演奏順記号あり')
  await page.getByRole('combobox',{name:'練習する曲',exact:true}).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音');await expect(button(page,'練習開始')).toBeEnabled()
})
test('original MXL registers, persists and restores repeat compatibility without rewriting XML',async({page})=>{
  await setup(page,fixture('maim-maim-full-original'),true)
  await expect(page.locator('.position')).toHaveText('1 / 204 ステップ')
  await page.reload();await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.locator('.personal-song-list > li').getByRole('button',{name:'選択',exact:true}).click()
  await expect(page.locator('.position')).toHaveText('1 / 204 ステップ')
  await page.getByRole('combobox',{name:'練習の開始位置',exact:true}).selectOption('measure:4')
  await expect(page.locator('.repeat-position')).toHaveText('反復 1回目')
})
