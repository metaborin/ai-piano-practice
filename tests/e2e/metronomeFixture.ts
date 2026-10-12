import type { Page } from '@playwright/test'

declare global {
  interface Window {
    clickTest: {
      contexts: number; failResume: boolean
      clicks: { at: number; frequency: number }[]
      stops: { at: number; immediate: boolean }[]
      states: string[]
    }
  }
}

/** Observe native Web Audio, keeping its actual oscillator, envelope and gesture unlock. */
export async function observeClicks(page: Page) {
  await page.addInitScript(() => {
    window.clickTest = { contexts: 0, failResume: false, clicks: [], stops: [], states: [] }
    const NativeAudioContext = window.AudioContext
    window.AudioContext = class extends NativeAudioContext {
      constructor() { super(); window.clickTest.contexts++ }
      async resume() {
        if (window.clickTest.failResume) throw new Error('test audio failure')
        await super.resume(); window.clickTest.states.push(this.state)
      }
      createOscillator() {
        const oscillator = super.createOscillator(), start = oscillator.start.bind(oscillator), stop = oscillator.stop.bind(oscillator)
        const setFrequency = oscillator.frequency.setValueAtTime.bind(oscillator.frequency)
        let frequency = oscillator.frequency.value
        // AudioParam.value can still reflect the previous rendering quantum.
        oscillator.frequency.setValueAtTime = (value, when) => { frequency = value; return setFrequency(value, when) }
        oscillator.start = when => { window.clickTest.clicks.push({ at: performance.now(), frequency }); start(when) }
        oscillator.stop = when => { window.clickTest.stops.push({ at: performance.now(), immediate: when === undefined }); stop(when) }
        return oscillator
      }
    }
  })
}

export const clicks = (page: Page) => page.evaluate(() => window.clickTest.clicks)
export const metronomeToggle = (page: Page) => page.getByRole('checkbox', { name: /^メトロノーム/ })
