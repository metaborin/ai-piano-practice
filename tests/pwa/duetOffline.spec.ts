import { test, expect } from '@playwright/test'
import { ready } from './helpers'
import { mockMidi } from '../e2e/midiFixture'

test.use({serviceWorkers:'allow'})
test.setTimeout(process.env.PLAYWRIGHT_BASE_URL ? 180_000 : 90_000)
test('both duet originals, opposite playback and downloadable artifacts remain usable after an offline cold load',async({page,context})=>{
  await mockMidi(page); await page.goto('./'); await ready(page)
  await context.setOffline(true); await page.reload()
  await expect(page.locator('.position')).toHaveText('1 / 14 音')
  await page.getByRole('button',{name:'MIDI接続',exact:true}).click()
  for(const version of ['once','original']) {
    await page.getByRole('combobox',{name:'練習する曲'}).selectOption(`maim-maim-duet-${version}`)
    await expect(page.locator('.position')).toHaveText(`1 / ${version==='once'?109:204} ステップ`)
    await page.getByRole('combobox',{name:'練習対象パート'}).selectOption('primo')
    await expect(page.locator('.position')).toHaveText(`1 / ${version==='once'?118:218} ステップ`)
    await page.getByText('PRIMO楽譜・合奏確認用データ',{exact:true}).click()
    for(const a of await page.locator('.duet-downloads a').all()) {
      const href=(await a.getAttribute('href'))!
      expect(await page.evaluate(async href=>{const r=await fetch(href);return r.ok && (await r.arrayBuffer()).byteLength>1000},href)).toBe(true)
    }
    await page.getByRole('combobox',{name:'相手パート自動再生'}).selectOption('on')
    await page.getByRole('combobox',{name:'再生速度',exact:true}).selectOption('0.5')
    await page.getByRole('button',{name:'練習開始',exact:true}).click()
    await expect(page.locator('.duet-controls')).toHaveAttribute('data-duet-status','playing')
    await expect(page.getByRole('combobox',{name:'再生速度',exact:true})).toBeDisabled()
    expect(await page.evaluate(()=>window.midiTest.outputMessages.some(m=>m.data[0]===0x90 && m.data[1]===50))).toBe(true)
    await page.getByRole('button',{name:'連弾練習を停止',exact:true}).click()
  }
})
