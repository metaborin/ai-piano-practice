import { useState } from 'react'
import type { ImportedSong, Song } from '../songs/Song'
import type { SongLibraryState } from '../songs/useSongLibrary'
import { compatibilityLabel } from '../songs/inspectMusicXml'
import { SongImport } from './SongImport'
import { OriginalScoreEditor } from './OriginalScoreEditor'
import type { OriginalScoreRepository } from '../songs/OriginalScoreRepository'

type Props = {
  library: SongLibraryState
  selectedId: string
  onSelect: (song: Song) => Promise<void>
  onRetry: () => void
  onAdd: (song: ImportedSong) => Promise<void>
  onDelete: (id: string) => Promise<void>
  originalRepository: OriginalScoreRepository
  onOriginalSaved: (song: Song) => void
}

export function SongLibrary({ library, selectedId, onSelect, onRetry, onAdd, onDelete, originalRepository, onOriginalSaved }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const remove = async (id: string) => {
    if (deletingId) return
    setDeletingId(id); setDeleteError(null)
    try { await onDelete(id); setConfirmId(null) }
    catch (error) { setDeleteError('曲を削除できませんでした。' + (error instanceof Error ? error.message : 'もう一度お試しください。')) }
    finally { setDeletingId(null) }
  }
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
                {imported.map((song) => <option key={song.id} value={song.id} disabled={deletingId === song.id}>{song.title}</option>)}
              </optgroup>}
            </select>
          </label>
          {library.status === 'loading' && <p role="status">曲ライブラリを読み込み中…</p>}
          {library.error && <div>
            <p role="alert">{library.error}</p>
            <button onClick={onRetry} disabled={!!deletingId}>曲一覧を再読み込み</button>
          </div>}
          {library.status === 'ready' && <p className="library-count">内蔵曲：{builtIn.length}曲</p>}
        </div>
        <div className="personal-songs" role="region" aria-labelledby="personal-songs-heading">
          <h3 id="personal-songs-heading">自分の曲</h3>
          <p>{library.status === 'loading' ? '曲一覧の読み込みをお待ちください。' : library.status === 'error' ? '曲一覧を読み込めませんでした。' : imported.length === 0 ? 'まだ追加された曲はありません' : imported.length + '曲あります。「練習する曲」から選べます。'}</p>
          <ul className="personal-song-list">{imported.map((song) => <li key={song.id} data-song-id={song.id}>
            <strong>{song.title}</strong><p>{song.composer || '作曲者未設定'} · {song.fileFormat === 'mxl' ? 'MXL' : 'MusicXML'}</p>
            <p>{compatibilityLabel(song)}</p>
            {song.compatibility?.status === 'unsupported' && <p>{song.compatibility.reasons.join('、')}</p>}
            <div className="library-actions"><button disabled={deletingId === song.id || library.status !== 'ready'} onClick={() => void onSelect(song)} aria-pressed={selectedId === song.id}>選択</button><button disabled={!!deletingId} onClick={() => { setConfirmId(song.id); setDeleteError(null) }}>削除</button></div>
            {confirmId === song.id && <div className="delete-confirmation"><p>この曲を削除しますか？</p><div className="library-actions"><button disabled={!!deletingId} onClick={() => setConfirmId(null)}>キャンセル</button><button disabled={!!deletingId} onClick={() => void remove(song.id)}>{deletingId ? '削除中…' : '削除する'}</button></div></div>}
            <OriginalScoreEditor song={song} repository={originalRepository} onSaved={onOriginalSaved} disabled={!!deletingId || library.status !== 'ready'} />
          </li>)}</ul>
          {deleteError && <p role="alert">{deleteError}</p>}
        </div>
      </div>
      <SongImport disabled={library.status !== 'ready'} onAdd={onAdd} />
    </section>
  )
}
