import { useState } from 'react'
import type { Song } from '../songs/Song'
import type { SongLibraryState } from '../songs/useSongLibrary'

type Props = {
  library: SongLibraryState
  selectedId: string
  onSelect: (song: Song) => Promise<void>
  onRetry: () => void
}

export function SongLibrary({ library, selectedId, onSelect, onRetry }: Props) {
  const [showAddMessage, setShowAddMessage] = useState(false)
  const builtIn = library.songs.filter((song) => song.source === 'builtin')
  const imported = library.songs.filter((song) => song.source === 'imported')
  return (
    <section className="song-library" aria-labelledby="song-library-heading">
      <h2 id="song-library-heading">曲ライブラリ</h2>
      <div className="library-columns">
        <div className="library-selection">
          <label className="song-selector">
            <span>練習する曲</span>
            <select value={selectedId} disabled={library.status !== 'ready' || library.songs.length === 0} onChange={(event) => {
              const song = library.songs.find((entry) => entry.id === event.target.value)
              if (song) void onSelect(song)
            }}>
              {library.songs.length === 0 && <option value="">曲がありません</option>}
              {builtIn.length > 0 && <optgroup label="内蔵曲">
                {builtIn.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}
              </optgroup>}
              {imported.length > 0 && <optgroup label="自分の曲">
                {imported.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}
              </optgroup>}
            </select>
          </label>
          {library.status === 'loading' && <p role="status">曲ライブラリを読み込み中…</p>}
          {library.status === 'error' && <div>
            <p role="alert">{library.error}</p>
            <button onClick={onRetry}>曲一覧を再読み込み</button>
          </div>}
          {library.status === 'ready' && <p className="library-count">内蔵曲：{builtIn.length}曲</p>}
        </div>
        <div className="personal-songs" role="region" aria-labelledby="personal-songs-heading">
          <h3 id="personal-songs-heading">自分の曲</h3>
          <p>{library.status === 'loading' ? '曲一覧の読み込みをお待ちください。' : library.status === 'error' ? '曲一覧を読み込めませんでした。' : imported.length === 0 ? 'まだ追加された曲はありません' : imported.length + '曲あります。「練習する曲」から選べます。'}</p>
          <button className="add-song-button" onClick={() => setShowAddMessage(true)} aria-controls="add-song-message" aria-expanded={showAddMessage}>＋ 曲を追加</button>
        </div>
      </div>
      <div id="add-song-message" role="status">
        {showAddMessage && <p className="add-song-message">MusicXML / MXLから曲を追加する機能は次のPhaseで追加します。</p>}
      </div>
    </section>
  )
}
