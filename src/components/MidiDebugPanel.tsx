import type { MidiNoteEvent } from '../midi/midiTypes'
import { midiNoteName } from '../midi/parseMidiMessage'
type Props = { latest: MidiNoteEvent | null; lastNoteOn: MidiNoteEvent | null; lastNoteOff: MidiNoteEvent | null }

function EventSummary({ label, event }: { label: string; event: MidiNoteEvent | null }) {
  return (
    <div className="event-summary">
      <span>{label}</span>
      <strong>{event ? `${midiNoteName(event.midiNote)} · MIDI ${event.midiNote} · Velocity ${event.velocity} · Ch ${event.channel}` : 'まだ入力はありません'}</strong>
    </div>
  )
}
export function MidiDebugPanel({ latest, lastNoteOn, lastNoteOff }: Props) {
  return (
    <section className="debug-panel" aria-labelledby="last-input-title">
      <div className="debug-heading"><h2 id="last-input-title">最後の入力</h2><span>受信した音を表示</span></div>
      {latest ? (
        <div className="latest-input" data-testid="latest-input">
          <div className="note-name"><span>音名</span><strong>{midiNoteName(latest.midiNote)}</strong></div>
          <dl>
            <div><dt>MIDI Note</dt><dd>{latest.midiNote}</dd></div>
            <div><dt>Velocity</dt><dd>{latest.velocity}</dd></div>
            <div><dt>Event</dt><dd>{latest.type === 'noteon' ? 'Note On' : 'Note Off'}</dd></div>
            <div><dt>Channel</dt><dd>{latest.channel}</dd></div>
          </dl>
        </div>
      ) : <p className="empty-input">MIDI接続後、ピアノの鍵盤を弾いてください。</p>}
      <div className="event-summaries">
        <EventSummary label="直近の Note On" event={lastNoteOn} />
        <EventSummary label="直近の Note Off" event={lastNoteOff} />
      </div>
      <p className="debug-note">鍵盤を離した後も、直近の Note On の打鍵強度を確認できます。</p>
    </section>
  )
}
