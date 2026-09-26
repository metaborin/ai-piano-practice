import type { Page } from '@playwright/test'

declare global {
  interface Window {
    midiTest: {
      requests: number
      denied: boolean
      failOpen: boolean
      send: (data: number[], id?: string) => void
      setConnected: (id: string, connected: boolean) => void
    }
  }
}

export async function mockMidi(page: Page, initiallyConnected = true) {
  await page.addInitScript(({ initiallyConnected }) => {
    const access = new EventTarget()
    const inputs = new Map<string, FakeInput>()
    class FakeInput extends EventTarget {
      type = 'input'
      state = 'connected'
      connection = 'closed'
      id: string
      name: string
      manufacturer: string
      constructor(id: string, name: string, manufacturer: string) {
        super()
        this.id = id
        this.name = name
        this.manufacturer = manufacturer
      }
      async open() {
        if (window.midiTest.failOpen) throw new DOMException('Unavailable', 'InvalidStateError')
        if (this.connection !== 'open') {
          this.connection = 'open'
          queueMicrotask(() => access.dispatchEvent(new Event('statechange')))
        }
        return this
      }
      async close() {
        if (this.connection !== 'closed') {
          this.connection = 'closed'
          queueMicrotask(() => access.dispatchEvent(new Event('statechange')))
        }
        return this
      }
    }
    const other = new FakeInput('other', 'Other keyboard', 'Test manufacturer')
    const cme = new FakeInput('cme', 'U2MIDI Pro MIDI 1', 'CME Pro')
    other.state = 'disconnected'
    cme.state = initiallyConnected ? 'connected' : 'disconnected'
    inputs.set('other', other)
    inputs.set('cme', cme)
    Object.defineProperty(access, 'inputs', { value: inputs })
    window.midiTest = {
      requests: 0, denied: false, failOpen: false,
      send(data, id = 'cme') {
        const event = new Event('midimessage')
        Object.defineProperty(event, 'data', { value: new Uint8Array(data) })
        inputs.get(id)!.dispatchEvent(event)
      },
      setConnected(id, connected) {
        inputs.get(id)!.state = connected ? 'connected' : 'disconnected'
        access.dispatchEvent(new Event('statechange'))
      },
    }
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => {
        window.midiTest.requests++
        if (window.midiTest.denied) throw new DOMException('Denied', 'NotAllowedError')
        return access
      },
    })
  }, { initiallyConnected })
}
