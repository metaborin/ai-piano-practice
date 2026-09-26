import { afterEach, expect, it, vi } from 'vitest'
import { MidiManager } from '../../src/midi/MidiManager'

afterEach(() => { vi.unstubAllGlobals() })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function environment(requestMIDIAccess: () => Promise<MIDIAccess>) {
  vi.stubGlobal('window', { isSecureContext: true })
  vi.stubGlobal('navigator', { requestMIDIAccess })
}

function emptyAccess() {
  return Object.assign(new EventTarget(), { inputs: new Map(), outputs: new Map() }) as unknown as MIDIAccess
}

it('does not request permission until connect is called and ignores a permission result after unmount', async () => {
  const pending = deferred<MIDIAccess>()
  const request = vi.fn(() => pending.promise)
  environment(request)
  const manager = new MidiManager()
  expect(request).not.toHaveBeenCalled()
  const connecting = manager.connect()
  const secondConnect = manager.connect()
  expect(request).toHaveBeenCalledTimes(1)
  manager.disconnect()
  pending.resolve(emptyAccess())
  await Promise.all([connecting, secondConnect])
  expect(manager.getSnapshot().status).toBe('disconnected')
})

it('a cancelled permission request cannot replace a newer connection', async () => {
  const first = deferred<MIDIAccess>()
  const second = deferred<MIDIAccess>()
  const request = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  environment(request)
  const manager = new MidiManager()
  const oldConnection = manager.connect()
  manager.disconnect()
  const newConnection = manager.connect()
  second.resolve(emptyAccess())
  await newConnection
  const snapshot = manager.getSnapshot()
  first.resolve(emptyAccess())
  await oldConnection
  expect(manager.getSnapshot()).toBe(snapshot)
  expect(snapshot.status).toBe('waiting')
  manager.disconnect()
})

it('closes a port whose pending open finishes after disconnect and stops listening', async () => {
  const opened = deferred<MIDIInput>()
  const port = Object.assign(new EventTarget(), {
    id: 'cme', name: 'U2MIDI Pro MIDI 1', manufacturer: 'CME Pro', state: 'connected',
    open: vi.fn(() => opened.promise), close: vi.fn(() => Promise.resolve()),
  }) as unknown as MIDIInput
  const access = Object.assign(new EventTarget(), { inputs: new Map([['cme', port]]), outputs: new Map() }) as unknown as MIDIAccess
  environment(() => Promise.resolve(access))
  const manager = new MidiManager()
  const listener = vi.fn()
  const unsubscribe = manager.subscribe(listener)
  await manager.connect()
  manager.disconnect()
  unsubscribe()
  listener.mockClear()
  opened.resolve(port)
  await opened.promise
  const message = new Event('midimessage')
  Object.defineProperty(message, 'data', { value: new Uint8Array([0x90, 60, 72]) })
  port.dispatchEvent(message)
  access.dispatchEvent(new Event('statechange'))
  expect(port.close).toHaveBeenCalledTimes(2)
  expect(listener).not.toHaveBeenCalled()
  expect(manager.getSnapshot().latestEvent).toBeNull()
  expect(manager.getSnapshot().status).toBe('disconnected')
})
