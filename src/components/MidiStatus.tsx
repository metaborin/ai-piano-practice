import type { MidiConnectionStatus } from '../midi/midiTypes'
const labels: Record<MidiConnectionStatus, string> = { disconnected: '未接続', waiting: '接続待ち', connected: '接続中', error: 'エラー' }
export function MidiStatus({ status }: { status: MidiConnectionStatus }) {
  return <div className={`midi-status ${status}`} role="status">MIDI <span className="status-dot" aria-hidden="true" />{labels[status]}</div>
}
