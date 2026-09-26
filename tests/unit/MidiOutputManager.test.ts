import { afterEach, expect, it, vi } from 'vitest'
import { MidiOutputManager } from '../../src/midi/MidiOutputManager'

afterEach(() => { vi.useRealTimers() })

function port(id = 'cme', name = 'USB MIDI', manufacturer = 'CME Pro') {
  return {
    id, name, manufacturer, state: 'connected',
    open: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(), clear: vi.fn(),
  }
}
type Port = ReturnType<typeof port>
function access(ports: Port[]) {
  return { outputs: new Map(ports.map((p) => [p.id, p])) } as unknown as MIDIAccess
}
async function setup(ports = [port()]) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
  const manager = new MidiOutputManager()
  const midiAccess = access(ports)
  manager.attachAccess(midiAccess)
  await Promise.resolve()
  return { manager, ports, midiAccess }
}

it('sends C4 on channel 1 at velocity 80 and schedules an explicit Note Off exactly 500ms later', async () => {
  const { manager, ports: [output] } = await setup()
  vi.advanceTimersByTime(100)
  manager.playTestNote()
  expect(output.send.mock.calls).toEqual([[[0x90, 60, 80]], [[0x80, 60, 0], 600]])
  expect(manager.getSnapshot().latestMessage?.type).toBe('noteon')
  expect(manager.getSnapshot().playing).toBe(true)
  vi.advanceTimersByTime(499)
  expect(manager.getSnapshot().latestMessage?.type).toBe('noteon')
  vi.advanceTimersByTime(1)
  expect(manager.getSnapshot().latestMessage).toEqual({ type: 'noteoff', data: [0x80, 60, 0], timestamp: 600 })
  expect(manager.getSnapshot().playing).toBe(false)
  // The JS timer updates display only; the port already owns the scheduled Note Off.
  expect(output.send).toHaveBeenCalledTimes(2)
})

it('ignores rapid clicks while playing and allows a new test after its Note Off', async () => {
  const { manager, ports: [output] } = await setup()
  manager.playTestNote()
  manager.playTestNote()
  expect(output.send).toHaveBeenCalledTimes(2)
  vi.advanceTimersByTime(500)
  manager.playTestNote()
  expect(output.send).toHaveBeenCalledTimes(4)
  manager.disconnect()
})

it('stop clears pending sends, sends individual Note Off and CC123, and cancels the display timer', async () => {
  const { manager, ports: [output] } = await setup()
  manager.playTestNote()
  vi.advanceTimersByTime(100)
  manager.stopAllNotes()
  expect(output.clear).toHaveBeenCalledTimes(1)
  expect(output.send.mock.calls.slice(-2)).toEqual([[[0x80, 60, 0]], [[0xb0, 123, 0]]])
  expect(output.clear.mock.invocationCallOrder[0]).toBeLessThan(output.send.mock.invocationCallOrder[2])
  vi.advanceTimersByTime(1000)
  expect(manager.getSnapshot().latestMessage?.type).toBe('allnotesoff')
  expect(manager.getSnapshot().playing).toBe(false)
  manager.stopAllNotes()
  expect(output.clear).toHaveBeenCalledTimes(2)
})

it('handles access missing, outputs missing, and explicit no selection without throwing or sending', async () => {
  const manager = new MidiOutputManager()
  expect(() => { manager.playTestNote(); manager.stopAllNotes() }).not.toThrow()
  expect(manager.getSnapshot().message).toContain('許可')
  manager.attachAccess(access([]))
  expect(manager.getSnapshot().message).toContain('見つかりません')
  expect(() => manager.playTestNote()).not.toThrow()
  const output = port()
  manager.attachAccess(access([output]))
  await Promise.resolve()
  manager.selectOutput('')
  manager.refreshOutputs()
  expect(manager.getSnapshot().selectedOutputId).toBeNull()
  expect(() => { manager.playTestNote(); manager.stopAllNotes() }).not.toThrow()
  expect(output.send).not.toHaveBeenCalled()
})

it('stops without clear() support and waits out the old Note Off before accepting another C4', async () => {
  const { manager, ports: [output] } = await setup()
  Reflect.deleteProperty(output, 'clear')
  manager.playTestNote()
  vi.advanceTimersByTime(100)
  manager.stopAllNotes()
  expect(manager.getSnapshot().status).toBe('connected')
  expect(output.send).toHaveBeenLastCalledWith([0xb0, 123, 0])
  manager.playTestNote()
  expect(output.send).toHaveBeenCalledTimes(4)
  vi.advanceTimersByTime(400)
  expect(manager.getSnapshot().playing).toBe(false)
  expect(manager.getSnapshot().latestMessage?.type).toBe('allnotesoff')
  manager.playTestNote()
  expect(output.send).toHaveBeenCalledTimes(6)
  manager.disconnect()
})

it('prefers a CME manufacturer without exact name matching and permits another output', async () => {
  const other = port('other', 'Other port', 'Other')
  const cme = port()
  const { manager } = await setup([other, cme])
  expect(manager.getSnapshot().selectedOutputId).toBe('cme')
  manager.selectOutput('other')
  await Promise.resolve()
  manager.playTestNote()
  expect(other.send).toHaveBeenCalledWith([0x90, 60, 80])
  expect(cme.send).not.toHaveBeenCalled()
  manager.disconnect()
})

it('stops the old playing port before switching and does not send to the new port automatically', async () => {
  const { manager, ports: [oldPort, newPort] } = await setup([port(), port('other')])
  manager.playTestNote()
  manager.selectOutput('other')
  await Promise.resolve()
  expect(oldPort.send).toHaveBeenLastCalledWith([0xb0, 123, 0])
  expect(oldPort.close).toHaveBeenCalled()
  vi.advanceTimersByTime(1000)
  expect(newPort.send).not.toHaveBeenCalled()
  expect(manager.getSnapshot().playing).toBe(false)
  expect(manager.getSnapshot().latestMessage).toBeNull()
})

it('handles unplug mid-note, waits for the chosen port, and never replays on reconnect', async () => {
  const { manager, ports: [output] } = await setup()
  manager.selectOutput(output.id)
  await Promise.resolve()
  manager.playTestNote()
  output.state = 'disconnected'
  manager.refreshOutputs()
  expect(manager.getSnapshot().message).toContain('切断')
  expect(() => manager.playTestNote()).not.toThrow()
  vi.advanceTimersByTime(1000)
  expect(output.send).toHaveBeenCalledTimes(2)
  output.state = 'connected'
  manager.refreshOutputs()
  await Promise.resolve()
  expect(manager.getSnapshot().status).toBe('connected')
  expect(output.send).toHaveBeenCalledTimes(2)
  manager.playTestNote()
  expect(output.send).toHaveBeenCalledTimes(4)
  manager.disconnect()
})

it('reports an open rejection and retries using the existing access', async () => {
  const output = port()
  output.open.mockRejectedValueOnce(new Error('open failed'))
  const { manager } = await setup([output])
  await Promise.resolve()
  expect(manager.getSnapshot().status).toBe('error')
  manager.playTestNote()
  expect(output.send).not.toHaveBeenCalled()
  manager.retry()
  await Promise.resolve()
  expect(manager.getSnapshot().status).toBe('connected')
})

it('attempts emergency Note Off and CC123 if scheduling fails, then can retry', async () => {
  const { manager, ports: [output] } = await setup()
  output.send.mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error('send failed') })
  expect(() => manager.playTestNote()).not.toThrow()
  expect(output.send).toHaveBeenLastCalledWith([0xb0, 123, 0])
  expect(manager.getSnapshot().status).toBe('error')
  expect(manager.getSnapshot().playing).toBe(false)
  manager.stopAllNotes()
  expect(manager.getSnapshot().latestMessage?.type).toBe('allnotesoff')
  manager.retry()
  await Promise.resolve()
  expect(manager.getSnapshot().status).toBe('connected')
})

it('still attempts CC123 if clearing the queue and sending individual Note Off fail', async () => {
  const { manager, ports: [output] } = await setup()
  output.clear.mockImplementationOnce(() => { throw new Error('clear failed') })
  output.send.mockImplementationOnce(() => { throw new Error('off failed') })
  expect(() => manager.stopAllNotes()).not.toThrow()
  expect(output.send).toHaveBeenLastCalledWith([0xb0, 123, 0])
  expect(manager.getSnapshot().message).toContain('停止メッセージを送信できません')
})

it('stops on disposal and has no stale timer updates', async () => {
  const { manager, ports: [output] } = await setup()
  manager.playTestNote()
  manager.disconnect()
  expect(output.send).toHaveBeenLastCalledWith([0xb0, 123, 0])
  const listener = vi.fn()
  manager.subscribe(listener)
  vi.advanceTimersByTime(1000)
  expect(listener).not.toHaveBeenCalled()
  expect(manager.getSnapshot().status).toBe('disconnected')
})

it('closes a delayed open that resolves after disposal without reviving the port', async () => {
  const output = port()
  let resolve!: () => void
  output.open.mockImplementation(() => new Promise<void>((done) => { resolve = done }))
  const { manager } = await setup([output])
  manager.disconnect()
  resolve()
  await Promise.resolve()
  expect(output.close).toHaveBeenCalledTimes(2)
  expect(manager.getSnapshot().status).toBe('disconnected')
  expect(output.send).not.toHaveBeenCalled()
})
