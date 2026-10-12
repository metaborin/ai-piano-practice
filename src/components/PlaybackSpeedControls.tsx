import { isPlaybackRate, PLAYBACK_RATES } from '../audio/playbackRate'
import type { PlaybackRate } from '../audio/playbackRate'

type Props = { rate: PlaybackRate; busy: boolean; onChange: (rate: PlaybackRate) => void }

export function PlaybackSpeedControls({ rate, busy, onChange }: Props) {
  return <section className="playback-speed" aria-label="手本・相手パートの再生速度">
    <label>再生速度
      <select value={rate} disabled={busy} aria-describedby="playback-speed-help" onChange={event => {
        const value = Number(event.target.value)
        if (isPlaybackRate(value)) onChange(value)
      }}>
        {PLAYBACK_RATES.map(value => <option key={value} value={value}>{value * 100}％{value === 1 ? '（通常）' : ''}</option>)}
      </select>
    </label>
    <p id="playback-speed-help" className="flow-hint">手本と相手パートの速さを変えます。連弾の通し練習も同じ速さで進みます。変更するときは再生・連弾練習を停止してください。</p>
  </section>
}
