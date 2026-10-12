import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { mockMidi } from './midiFixture'

const count = (part: string, version: string) => part === 'primo' ? version === 'once' ? 87 : 164 : version === 'once' ? 109 : 204
async function setup(page:Page,part='primo',version='once') {
  await mockMidi(page)
  await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button',{name:'MIDI接続',exact:true}).click()
  await page.getByRole('combobox',{name:'練習する曲'}).selectOption(`maim-maim-duet-${version}`)
  await expect(page.locator('.position')).toHaveText(`1 / ${count('secondo',version)} ステップ`)
  if(part==='primo')await page.getByRole('combobox',{name:'練習対象パート'}).selectOption(part)
  await expect(page.locator('.position')).toHaveText(`1 / ${count(part,version)} ステップ`)
}
async function freeze(page:Page) {
  await page.clock.install()
  await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)))
}
async function strike(page:Page,notes:readonly number[]) {
  await page.evaluate(notes=>{for(const n of notes)window.midiTest.send([0x90,n,80]);for(const n of notes)window.midiTest.send([0x80,n,0])},notes)
}
const attacks=(page:Page)=>page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90))
const auto=(page:Page)=>page.getByRole('combobox',{name:'相手パート自動再生'}).selectOption('on')

for(const part of ['primo','secondo'])for(const version of ['once','original']) {
  test(`${part} ${version}: chosen score, grading, own demo and opposite accompaniment agree`,async({page})=>{
    await setup(page,part,version)
    await expect(page.locator('.subtitle')).toContainText(part.toUpperCase())
    await expect(page.locator('.score-overview')).toHaveAttribute('data-state','ready')
    await freeze(page)
    await page.getByRole('button',{name:'手本を聴く',exact:true}).click()
    expect((await attacks(page))[0].data[1]).toBe(part==='primo'?79:50)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','demoPlaying')
    await strike(page,[part==='primo'?79:50])
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
    await page.getByRole('button',{name:'停止',exact:true}).click()
    await auto(page)
    await page.getByRole('button',{name:'練習開始',exact:true}).click()
    expect((await attacks(page)).at(-1)!.data[1]).toBe(part==='primo'?50:79)
    await strike(page,[part==='primo'?50:79]) // The automatically played part is not the target.
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
    await page.clock.runFor(700)
    await expect(page.locator('.duet-controls')).toHaveAttribute('data-duet-status','waiting')
    await strike(page,[part==='primo'?79:50])
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','1')
    await expect(page.locator('.position')).toHaveText(`2 / ${count(part,version)} ステップ`)
    await page.getByRole('button',{name:'連弾練習を停止',exact:true}).click()
    const n=(await attacks(page)).length
    await page.clock.runFor(60000)
    expect(await attacks(page)).toHaveLength(n)
    expect(await page.evaluate(()=>window.midiTest.outputMessages.some(m=>m.data.join(',')==='176,123,0'))).toBe(true)
    await expect(page.getByRole('combobox',{name:'出力機器'})).toHaveValue('cme-out')
    expect(await page.evaluate(()=>window.midiTest.requests)).toBe(1)
    expect(await page.evaluate(()=>window.midiTest.inputListenerCount())).toBe(1)
  })
  test(`${part} ${version}: timed run-through finishes on silence, repeats and records every selected target`,async({page})=>{
    await setup(page,part,version)
    await page.getByRole('button',{name:'通し練習',exact:true}).click()
    await auto(page); await freeze(page)
    await page.evaluate(()=>{window.midiTest.loopback=true})
    await page.getByRole('button',{name:'練習開始',exact:true}).click()
    await page.clock.runFor(31035)
    if(version==='original') {
      await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','practicing')
      await expect(page.locator('.current-measure')).toHaveText('5小節目')
      await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
      await page.clock.runFor(27000)
    }
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','completed')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count',String(count(part,version)))
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
    await expect(page.locator('.practice-feedback')).toHaveText('通し練習が終わりました')
    expect((await attacks(page)).every(m=>part==='primo'?m.data[1]<=65:m.data[1]>=68)).toBe(true)
    await page.getByText('ステップごとの正解・不足・余分を見る',{exact:true}).click()
    await expect(page.locator('.attempt-review li')).toHaveCount(count(part,version))
    await expect(page.locator('.attempt-review li').first()).toContainText('不足')
    const n=(await attacks(page)).length
    await page.clock.runFor(2000)
    expect(await attacks(page)).toHaveLength(n)
    await page.getByRole('button',{name:'もう一度',exact:true}).click()
    await expect(page.locator('.position')).toHaveText(`1 / ${count(part,version)} ステップ`)
  })
}

test('until-correct waits quietly, resumes on a correct input and stops on part/song/flow changes',async({page})=>{
  await setup(page);await auto(page);await freeze(page)
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await strike(page,[60]);await page.clock.runFor(600)
  await expect(page.locator('.duet-controls')).toHaveAttribute('data-duet-status','waiting')
  const waiting=(await attacks(page)).length
  await page.clock.runFor(4000)
  expect(await attacks(page)).toHaveLength(waiting)
  await strike(page,[79])
  await expect(page.locator('.position')).toHaveText('2 / 87 ステップ')
  await page.getByRole('combobox',{name:'練習対象パート'}).selectOption('secondo')
  await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','idle')
  const changed=(await attacks(page)).length
  await page.clock.runFor(10000)
  expect(await attacks(page)).toHaveLength(changed)
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await page.getByRole('button',{name:'通し練習',exact:true}).click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','idle')
  const stopped=(await attacks(page)).length
  await page.clock.runFor(10000)
  expect(await attacks(page)).toHaveLength(stopped)
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await page.getByRole('combobox',{name:'練習する曲'}).selectOption('twinkle-opening')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await expect(page.locator('.duet-controls')).toHaveCount(0)
  const final=(await attacks(page)).length
  await page.clock.runFor(10000)
  expect(await attacks(page)).toHaveLength(final)
  await page.getByRole('button',{name:'できるまで',exact:true}).click()
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await strike(page,[60])
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','1')
})

for(const part of ['primo','secondo'])test(`${part}: measure 30 -> repeat pass 2 -> current start preserves pass; demo can replace accompaniment`,async({page})=>{
  await setup(page,part,'original');await auto(page)
  await page.getByRole('button',{name:'通し練習',exact:true}).click()
  await page.getByRole('combobox',{name:'練習の開始位置'}).selectOption('measure:29')
  await freeze(page)
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await page.clock.runFor(1035)
  await expect(page.locator('.current-measure')).toHaveText('5小節目')
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  const index=await page.locator('.practice-controls').getAttribute('data-practice-index')
  await page.getByRole('button',{name:'連弾練習を停止',exact:true}).click()
  await page.getByRole('combobox',{name:'練習の開始位置'}).selectOption('current')
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index',index!)
  await expect(page.locator('.repeat-position')).toHaveText('反復 2回目')
  await page.clock.runFor(600)
  const later=await page.locator('.practice-controls').getAttribute('data-practice-index')
  expect(later).not.toBe(index)
  await page.getByRole('button',{name:'連弾練習を停止',exact:true}).click()
  // The select still says current: starting reads the latest stopped cursor,
  // rather than the older index captured when current was first selected.
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index',later!)
  await page.getByRole('button',{name:'手本を聴く',exact:true}).click()
  await expect(page.locator('.duet-controls')).toHaveAttribute('data-duet-status','stopped')
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status','playing')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','demoPlaying')
  await page.getByRole('button',{name:'停止',exact:true}).click()
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','practicing')
})

test('rapid part changes ignore old XML responses and maintain one MIDI handler',async({page})=>{
  await setup(page)
  const held:Route[]=[]
  await page.route(/maim-maim-(primo|secondo)-once.*\.musicxml/,route=>{held.push(route)})
  const selector=page.getByRole('combobox',{name:'練習対象パート'})
  for(const p of ['secondo','primo','secondo'])await selector.selectOption(p)
  await expect.poll(()=>held.length).toBe(6)
  await strike(page,[50])
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
  await expect(page.getByRole('button',{name:'練習開始',exact:true})).toBeDisabled()
  const release=async(route:Route)=>{
    const part=route.request().url().includes('primo')?'primo':'secondo'
    await route.fulfill({contentType:'application/xml',body:readFileSync(`src/scores/duet/maim-maim-${part}-once.musicxml`,'utf8')})
  }
  for(const r of held.slice(4))await release(r)
  await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
  for(const r of held.slice(0,4))await release(r)
  await expect(page.locator('.subtitle')).toContainText('SECONDO')
  await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
  expect(await page.evaluate(()=>window.midiTest.inputListenerCount())).toBe(1)
})

test('partner acquisition/parse failure clears the score and target, and another selection recovers',async({page})=>{
  await setup(page)
  await page.route(/maim-maim-primo-original.*\.musicxml/,route=>route.fulfill({contentType:'application/xml',body:'<junk/>'}))
  await page.getByRole('combobox',{name:'練習する曲'}).selectOption('maim-maim-duet-original')
  await expect(page.getByRole('alert')).toContainText('相手パートのMusicXMLを解析')
  await expect(page.locator('.position')).toHaveText('— / — 音')
  await expect(page.locator('.score-renderer')).toHaveCount(0)
  await expect(page.getByRole('button',{name:'手本を聴く',exact:true})).toBeDisabled()
  // The same broken XML is now the selected part. Failure must still name the
  // selected PRIMO, never the piece's default SECONDO or its previous score.
  await page.getByRole('combobox',{name:'練習対象パート'}).selectOption('primo')
  await expect(page.locator('.subtitle')).toContainText('PRIMO')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('.score-renderer')).toHaveCount(0)
  await expect(page.locator('.position')).toHaveText('— / — 音')
  await page.getByRole('combobox',{name:'練習する曲'}).selectOption('maim-maim-duet-once')
  await expect(page.locator('.position')).toHaveText('1 / 109 ステップ')
})

test('built-in duet downloads respect Pages base and touch layout does not overflow',async({page,request})=>{
  await setup(page)
  await page.getByText('PRIMO楽譜・合奏確認用データ',{exact:true}).click()
  for(const a of await page.locator('.duet-downloads a').all()) {
    const url=new URL((await a.getAttribute('href'))!,page.url())
    expect(url.pathname).toContain('/ai-piano-practice/')
    const response=await request.get(url.href)
    expect(response.ok()).toBe(true)
    expect((await response.body()).length).toBeGreaterThan(1000)
  }
  await page.setViewportSize({width:390,height:844})
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  expect(await page.getByRole('combobox',{name:'練習対象パート'}).evaluate(e=>e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  await page.screenshot({path:'test-results/duet-mobile.png',fullPage:true})
})

test('timed no-accompaniment review shows right, missing and extra; emergency stop ends its silent clock',async({page})=>{
  await setup(page);await page.getByRole('button',{name:'通し練習',exact:true}).click();await freeze(page)
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await strike(page,[79,60]);await page.clock.runFor(518)
  await strike(page,[83]);await page.clock.runFor(31000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','1')
  await page.getByText('ステップごとの正解・不足・余分を見る',{exact:true}).click()
  await expect(page.locator('.attempt-review li').first()).toContainText('余分 C4')
  await expect(page.locator('.attempt-review li').nth(1)).toContainText('正解')
  await expect(page.locator('.attempt-review li').nth(2)).toContainText('不足')
  expect(await attacks(page)).toHaveLength(0)
  await page.getByRole('button',{name:'もう一度',exact:true}).click()
  await page.getByRole('button',{name:'すべての音を停止',exact:true}).click()
  const n=await page.locator('.practice-controls').getAttribute('data-attempt-count')
  await page.clock.runFor(10000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-attempt-count',n!)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','idle')
})
