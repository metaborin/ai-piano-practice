import type { Page } from '@playwright/test'

declare global {
  interface Window {
    midiTest: {
      requests: number
      denied: boolean
      failOpen: boolean
      failOutputOpen: boolean
      failSend: boolean
      loopback: boolean
      outputMessages: { id: string; data: number[]; timestamp: number; requestedAt: number }[]
      outputClears: string[]
      send: (data: number[], id?: string) => void
      setConnected: (id: string, connected: boolean) => void
      setOutputConnected: (id: string, connected: boolean) => void
      disableOutputClear: () => void
      inputListenerCount: () => number
    }
  }
}

export async function mockMidi(page: Page, initiallyConnected = true) {
  await page.addInitScript(({ initiallyConnected }) => {
    const access = new EventTarget()
    const inputs = new Map<string, FakeInput>()
    const outputs = new Map<string, FakeOutput>()
    class FakeInput extends EventTarget {
      type = 'input'
      state = 'connected'
      connection = 'closed'
      id: string
      name: string
      manufacturer: string
      midiListeners = new Set<EventListenerOrEventListenerObject>()
      addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        if (type === 'midimessage' && listener) this.midiListeners.add(listener)
        super.addEventListener(type, listener, options)
      }
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
        if (type === 'midimessage' && listener) this.midiListeners.delete(listener)
        super.removeEventListener(type, listener, options)
      }
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
    class FakeOutput extends FakeInput {
      type = 'output'
      async open() {
        if (window.midiTest.failOutputOpen) throw new DOMException('Unavailable', 'InvalidStateError')
        if (this.connection !== 'open') {
          this.connection = 'open'
          queueMicrotask(() => access.dispatchEvent(new Event('statechange')))
        }
        return this
      }
      send(data: number[], timestamp = 0) {
        if (this.state !== 'connected' || window.midiTest.failSend) throw new DOMException('Unavailable', 'InvalidStateError')
        window.midiTest.outputMessages.push({ id: this.id, data: [...data], timestamp, requestedAt: performance.now() })
        if (window.midiTest.loopback) window.midiTest.send(data)
      }
      clear() { window.midiTest.outputClears.push(this.id) }
    }
    const other = new FakeInput('other', 'Other keyboard', 'Test manufacturer')
    const cme = new FakeInput('cme', 'U2MIDI Pro MIDI 1', 'CME Pro')
    other.state = 'disconnected'
    cme.state = initiallyConnected ? 'connected' : 'disconnected'
    inputs.set('other', other)
    inputs.set('cme', cme)
    Object.defineProperty(access, 'inputs', { value: inputs })
    const cmeOutput = new FakeOutput('cme-out', 'USB MIDI port 1', 'CME Pro')
    const otherOutput = new FakeOutput('other-out', 'Other MIDI output', 'Test manufacturer')
    cmeOutput.state = initiallyConnected ? 'connected' : 'disconnected'
    otherOutput.state = 'disconnected'
    outputs.set(cmeOutput.id, cmeOutput)
    outputs.set(otherOutput.id, otherOutput)
    Object.defineProperty(access, 'outputs', { value: outputs })
    window.midiTest = {
      requests: 0, denied: false, failOpen: false,
      inputListenerCount: () => [...inputs.values()].reduce((count, input) => count + input.midiListeners.size, 0),
      failOutputOpen: false, failSend: false, loopback: false, outputMessages: [], outputClears: [],
      send(data, id = 'cme') {
        const event = new Event('midimessage')
        Object.defineProperty(event, 'data', { value: new Uint8Array(data) })
        inputs.get(id)!.dispatchEvent(event)
      },
      setConnected(id, connected) {
        inputs.get(id)!.state = connected ? 'connected' : 'disconnected'
        access.dispatchEvent(new Event('statechange'))
      },
      setOutputConnected(id, connected) {
        outputs.get(id)!.state = connected ? 'connected' : 'disconnected'
        access.dispatchEvent(new Event('statechange'))
      },
      disableOutputClear() {
        outputs.forEach((port) => Object.defineProperty(port, 'clear', { value: undefined }))
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
