import type { MetronomeSnapshot } from '../audio/Metronome'

export function MetronomeControls({ state, onChange }: { state: MetronomeSnapshot; onChange: (enabled: boolean) => void }) {
  return <section className="metronome-controls" aria-label="メトロノーム" data-metronome-status={state.status}>
    <label><input type="checkbox" checked={state.enabled} onChange={event => onChange(event.target.checked)} aria-describedby="metronome-help" />メトロノーム {state.enabled ? 'ON' : 'OFF'}</label>
    <p id="metronome-help" className="flow-hint">手本・連弾の速さと拍子に合わせ、端末のスピーカーから鳴ります。正解待ちでは止まり、再生中もON/OFFできます。通常の入力式練習では鳴りません。</p>
    {state.message && <p role="alert" className="error-message">{state.message}</p>}
  </section>
}
