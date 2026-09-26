import type { MidiConnectionStatus } from '../midi/midiTypes'
import type { MidiOutputSnapshot } from '../midi/MidiOutputManager'
import { OUTPUT_CHANNEL } from '../midi/MidiOutputManager'
import { midiNoteName } from '../midi/parseMidiMessage'

type Props = {
  output: MidiOutputSnapshot
  inputStatus: MidiConnectionStatus
  onSelect: (id: string) => void
  onPlay: () => void
  onStop: () => void
  onRetry: () => void
}
const labels: Record<MidiConnectionStatus, string> = { disconnected: '未接続', waiting: '接続待ち', connected: '接続済み', error: 'エラー' }

export function MidiOutputPanel({ output, inputStatus, onSelect, onPlay, onStop, onRetry }: Props) {
  const latest = output.latestMessage
  return (
    <section className="output-panel" aria-labelledby="midi-output-title">
      <h2 id="midi-output-title">MIDI出力テスト</h2>
      <p className="output-status">MIDI入力：{labels[inputStatus]} ／ MIDI出力：{labels[output.status]}</p>
      <p role="status">{output.message}</p>
      <label className="input-selector">
        <span>出力機器</span>
        <select value={output.selectedOutputId ?? ''} onChange={(event) => onSelect(event.target.value)} disabled={output.outputs.length === 0}>
          <option value="">出力機器を選択</option>
          {output.outputs.map((port) => <option key={port.id} value={port.id}>{port.name} / {port.manufacturer || 'メーカー不明'}</option>)}
        </select>
      </label>
      <div className="output-buttons">
        <button onClick={onPlay} disabled={output.status !== 'connected' || output.playing}>テスト音 C4</button>
        <button onClick={onStop} disabled={!output.selectedOutputId || output.status === 'waiting'}>すべての音を停止</button>
        {output.status === 'error' && <button onClick={onRetry}>出力を再接続</button>}
      </div>
      <div className="output-debug" aria-live="polite">
        <strong>最後のMIDI出力</strong>
        <p data-testid="latest-output">{latest
          ? latest.type === 'allnotesoff'
            ? `All Notes Off / CC 123 / Value 0 / Channel ${OUTPUT_CHANNEL}`
            : `${midiNoteName(latest.data[1])} / ${latest.type === 'noteon' ? 'Note On' : 'Note Off'} / MIDI Note ${latest.data[1]} / Velocity ${latest.data[2]} / Channel ${OUTPUT_CHANNEL}`
          : 'まだ送信していません。'}</p>
      </div>
      <p className="debug-note">PX-100本体から約0.5秒のドを鳴らす接続確認です。表示は送信要求・予約時刻に基づきます。実際の音は耳で確認してください。</p>
    </section>
  )
}
