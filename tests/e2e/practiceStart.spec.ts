import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockMidi } from './midiFixture'
import { fixture, parseFixture } from '../unit/xmlFixture'
import { createPracticePlan } from '../../src/practice/PracticePlan'

const model = parseFixture('maim-maim-full-once')
async function setup(page: Page, name = 'maim-maim-full-once') {
  await page.setViewportSize({ width: 1366, height: 768 }); await page.emulateMedia({ reducedMotion: 'reduce' })
  await mockMidi(page); await page.goto('./')
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button', { name: 'MIDI接続', exact: true }).click()
  await page.locator('input[type=file]').setInputFiles({ name: name + '.musicxml', mimeType: 'application/xml', buffer: Buffer.from(fixture(name)) })
  await page.getByRole('form', { name: '曲の登録確認' }).getByRole('button', { name: '追加する', exact: true }).click()
  await page.locator('.personal-song-list > li').getByRole('button', { name: '選択', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '練習の開始位置', exact: true })).toBeEnabled()
  await expect(page.locator('.score-renderer svg')).toBeVisible()
}
async function strike(page: Page, targets: readonly (readonly number[])[]) {
  await page.evaluate(targets => { for (const pitches of targets) {
    for (const pitch of pitches) window.midiTest.send([0x90, pitch, 80])
    for (const pitch of pitches) window.midiTest.send([0x80, pitch, 0])
  } }, targets)
}
async function cursorVisible(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const cursor = document.querySelector('.score-renderer img'), view = document.querySelector('.score-view'), header = document.querySelector('.score-status')
    if (!cursor || !view || !header) return false
    const c = cursor.getBoundingClientRect(), v = view.getBoundingClientRect(), h = header.getBoundingClientRect()
    return c.height > 0 && c.top >= Math.max(h.bottom, v.top, 0) - 1 && c.bottom <= Math.min(v.bottom, innerHeight) + 1
  })).toBe(true)
}

for (const [mode, label, indices] of [
  ['right', '右手', [25,26,27,28]], ['left','左手',[28,36,44,52]], ['both','両手',[47,55,63,71]],
] as const) for (const [offset, number] of [14,16,18,20].entries()) {
  test(`once XML ${label} ${number}: resolved cursor, wrong/correct input, completion and retry`, async ({ page }) => {
    await setup(page); await page.getByRole('button', { name: label, exact: true }).click()
    const plan = createPracticePlan(model, mode)!, index = indices[offset], resolved = mode === 'right' ? number + 1 : number
    await page.getByRole('combobox', { name: '練習の開始位置', exact: true }).selectOption(`measure:${number - 1}`)
    await expect(page.locator('.position')).toHaveText(`${index + 1} / ${plan.targets.length} ステップ`)
    await expect(page.locator('.current-measure')).toHaveText(`${resolved}小節目`)
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','idle')
    if (mode === 'right') await expect(page.locator('.practice-start-message')).toContainText(`${number}小節目には右手の新しい音がないため、${number+1}小節目から開始します`)
    await cursorVisible(page)
    await page.getByRole('button', { name: '練習開始', exact: true }).click()
    await strike(page, [[127]])
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', String(index))
    await expect(page.locator('.practice-feedback')).toHaveText('もう一度♪')
    await expect(page.locator('.score-renderer [data-missing-note]')).not.toHaveCount(0)
    await strike(page, [plan.targets[index].expectedMidiNotes])
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index', String(index+1))
    await strike(page, plan.targets.slice(index+1).map(t=>t.expectedMidiNotes))
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status', 'completed')
    await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count', String(plan.targets.length-index))
    await page.getByRole('button', { name: 'もう一度', exact: true }).click()
    await expect(page.locator('.position')).toHaveText(`${index+1} / ${plan.targets.length} ステップ`)
    await expect(page.locator('.score-renderer [data-missing-note]')).toHaveCount(0); await cursorVisible(page)
    await page.locator('.score-view').evaluate(el=>el.scrollTo({top:0,behavior:'instant'}))
    await page.getByRole('button', { name: '現在位置へ戻る', exact: true }).click(); await cursorVisible(page)
    if (mode === 'right' && number === 14) await page.screenshot({ path: 'test-results/phase2ed31-start.png' })
  })
}
test('same requested measure survives mode changes; a new choice clears pending input, old feedback and timers; song resets the choice', async ({ page }) => {
  await setup(page); await page.getByRole('button',{name:'右手',exact:true}).click()
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)))
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await page.evaluate(()=>window.midiTest.send([0x90,55,80]))
  await expect(page.locator('.practice-feedback')).toHaveText('音をそろえてみよう')
  const select = page.getByRole('combobox',{name:'練習の開始位置',exact:true})
  await select.selectOption('measure:13'); await page.clock.runFor(1000)
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index','25')
  await expect(page.locator('.score-renderer [data-missing-note]')).toHaveCount(0)
  await page.getByRole('button',{name:'練習開始',exact:true}).click(); await strike(page,[[60,64]])
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-index','26')
  await page.getByRole('button',{name:'左手',exact:true}).click()
  await expect(select).toHaveValue('measure:13'); await expect(page.locator('.position')).toHaveText('29 / 76 ステップ')
  await page.getByRole('button',{name:'両手',exact:true}).click()
  await expect(select).toHaveValue('measure:13'); await expect(page.locator('.position')).toHaveText('48 / 109 ステップ')
  await page.getByRole('combobox',{name:'練習する曲',exact:true}).selectOption('twinkle-opening')
  await expect(select).toHaveValue('beginning'); await expect(page.locator('.position')).toHaveText('1 / 14 音')
  expect(await page.evaluate(()=>window.midiTest.requests)).toBe(1)
  expect(await page.evaluate(()=>window.midiTest.inputListenerCount())).toBe(1)
})
test('right-hand demo reconstructs a tie-only bar before MIDI and restores the partial practice origin on stop/end', async ({ page }) => {
  await setup(page); await page.getByRole('button',{name:'右手',exact:true}).click()
  await page.getByRole('combobox',{name:'練習の開始位置',exact:true}).selectOption('measure:13')
  await page.getByRole('button',{name:'練習開始',exact:true}).click()
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)))
  await page.evaluate(()=>{
    window.midiTest.loopback=true
    const messages=window.midiTest.outputMessages, push=messages.push.bind(messages)
    messages.push=(...items)=>{
      for (const item of items) if(item.data[0]===0x90 && !document.body.dataset.firstMeasure) {
        document.body.dataset.firstMeasure=document.querySelector('.current-measure')!.textContent!
        const c=document.querySelector('.score-renderer img')!.getBoundingClientRect(), v=document.querySelector('.score-view')!.getBoundingClientRect()
        document.body.dataset.firstVisible=String(c.top>=v.top && c.bottom<=Math.min(v.bottom,innerHeight))
      }
      return push(...items)
    }
  })
  const demoStart=page.getByRole('combobox',{name:'手本の開始位置',exact:true})
  await demoStart.selectOption('measure:13'); await page.getByRole('button',{name:'手本を聴く',exact:true}).click()
  expect(await page.evaluate(()=>document.body.dataset.firstMeasure)).toBe('14小節目')
  expect(await page.evaluate(()=>document.body.dataset.firstVisible)).toBe('true')
  expect(await page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90).map(m=>m.data[1]))).toEqual([62,65])
  await page.clock.runFor(1100); await expect(page.locator('.current-measure')).toHaveText('15小節目')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
  await page.getByRole('button',{name:'停止',exact:true}).click(); await cursorVisible(page)
  await expect(page.locator('.position')).toHaveText('26 / 48 ステップ')
  const count=await page.evaluate(()=>window.midiTest.outputMessages.length); await page.clock.runFor(120000)
  expect(await page.evaluate(()=>window.midiTest.outputMessages.length)).toBe(count)
  await demoStart.selectOption('measure:29'); await page.getByRole('button',{name:'手本を聴く',exact:true}).click(); await page.clock.runFor(4000)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status','completed')
  await expect(page.locator('.position')).toHaveText('26 / 48 ステップ'); await cursorVisible(page)
  await demoStart.selectOption('measure:13'); await page.getByRole('button',{name:'手本を聴く',exact:true}).click()
  await page.getByRole('combobox',{name:'練習の開始位置',exact:true}).selectOption('measure:15')
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','idle')
  await expect(page.locator('.position')).toHaveText('27 / 48 ステップ')
  const changed=await page.evaluate(()=>window.midiTest.outputMessages.length); await page.clock.runFor(120000)
  expect(await page.evaluate(()=>window.midiTest.outputMessages.length)).toBe(changed)
})
test('no remaining attack is explained, does not start, and can recover in another hand or another measure', async ({ page }) => {
  await setup(page,'start-f-empty'); await page.getByRole('button',{name:'右手',exact:true}).click()
  const demoStart=page.getByRole('combobox',{name:'手本の開始位置',exact:true}); await demoStart.selectOption('current')
  const start=page.getByRole('combobox',{name:'練習の開始位置',exact:true}); await start.selectOption('measure:3')
  await expect(page.getByRole('button',{name:'練習開始',exact:true})).toBeDisabled()
  await expect(page.locator('.practice-start-message')).toContainText('新しい音がありません')
  await expect(page.getByRole('button',{name:'手本を聴く',exact:true})).toBeDisabled()
  await demoStart.selectOption('beginning'); await expect(page.getByRole('button',{name:'手本を聴く',exact:true})).toBeEnabled()
  await strike(page,[[72]]); await expect(page.locator('.practice-controls')).toHaveAttribute('data-correct-count','0')
  await page.getByRole('button',{name:'左手',exact:true}).click(); await expect(start).toHaveValue('measure:3')
  await expect(page.getByRole('button',{name:'練習開始',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'練習開始',exact:true}).click(); await strike(page,[[53]])
  await expect(page.locator('.practice-controls')).toHaveAttribute('data-practice-status','completed')
  await start.selectOption('beginning'); await expect(page.locator('.position')).toHaveText('1 / 4 ステップ')
})
test('a moment containing only tie continuations maps to OSMD for demo while practice skips it', async ({ page }) => {
  await setup(page,'start-a-tie')
  await page.getByRole('combobox',{name:'練習の開始位置',exact:true}).selectOption('measure:1')
  await expect(page.locator('.current-measure')).toHaveText('4小節目')
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(()=>Date.now()+100)))
  await page.getByRole('combobox',{name:'手本の開始位置',exact:true}).selectOption('measure:1')
  await page.getByRole('button',{name:'手本を聴く',exact:true}).click()
  await expect(page.locator('.current-measure')).toHaveText('2小節目'); await cursorVisible(page)
  await expect(page.locator('.demo-controls')).toHaveAttribute('data-demo-status','playing')
  expect(await page.evaluate(()=>window.midiTest.outputMessages.filter(m=>m.data[0]===0x90).map(m=>m.data[1]))).toEqual([60])
  await page.getByRole('button',{name:'停止',exact:true}).click()
  await expect(page.locator('.current-measure')).toHaveText('4小節目')
})
