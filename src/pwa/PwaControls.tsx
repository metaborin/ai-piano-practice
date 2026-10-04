import { useState, useSyncExternalStore } from 'react'
import { pwaClient } from './client'
import './pwa.css'

export function PwaControls({ busy, beforeReload }: { busy: boolean; beforeReload: () => void }) {
  const state = useSyncExternalStore(pwaClient.subscribe, pwaClient.getSnapshot)
  const [confirming, setConfirming] = useState(false)
  const apply = () => { setConfirming(false); pwaClient.applyUpdate(beforeReload) }
  return <aside className="pwa-controls" aria-label="アプリのインストールと更新" data-offline-ready={state.offlineReady} data-standalone={state.standalone}>
    {!state.online && <span className="pwa-offline" role="status">オフラインです</span>}
    {state.needRefresh && <div className="pwa-update" role="status">
      <span>新しいバージョンがあります</span>
      <button disabled={state.updating} onClick={() => busy ? setConfirming(true) : apply()}>{state.updating ? '更新中…' : '更新する'}</button>
    </div>}
    {confirming && <div className="pwa-confirm" role="alertdialog" aria-label="アプリの更新確認" aria-describedby="pwa-confirm-message">
      <p id="pwa-confirm-message">練習・手本演奏中です。更新すると演奏が停止し、現在の練習状態がリセットされます。保存した曲・元楽譜は残ります。</p>
      <button onClick={apply}>更新して再読み込み</button>
      <button onClick={() => setConfirming(false)}>キャンセル</button>
    </div>}
    {state.installAvailable && <button className="pwa-install" onClick={() => void pwaClient.install()}>アプリをインストール</button>}
    <details className="pwa-help">
      <summary>アプリのインストール・更新</summary>
      <p>{state.standalone ? 'アプリのウィンドウで起動しています。' : 'Chromeのメニューからもインストールできます。「キャスト、保存、共有」→「ページをアプリとしてインストール」を確認してください。'}</p>
      <p>{state.offlineReady ? 'オフライン用の保存ができました。端末に保存した曲・元楽譜も利用できます。' : 'オンラインで一度開き、オフライン用の保存が完了するまでお待ちください。'}</p>
      <p>更新して再読み込みすると練習状態はリセットされます。保存済みの曲・元楽譜は削除されません。</p>
      <button disabled={!state.online || state.checking || state.updating} onClick={() => void pwaClient.checkForUpdate(true)}>{state.checking ? '確認中…' : '更新を確認'}</button>
    </details>
    {state.message && <p className="pwa-message" role="status">{state.message}</p>}
  </aside>
}
