import { useMemo } from 'react'
import { EmptyState } from '../components/EmptyState'
import { channelName } from '../lib/api'
import { clearHistory, getFavorites, getHistory } from '../lib/storage'
import type { ChannelId } from '../lib/types'

export function FavoritesPage({ libraryVersion, onLibraryChange }: { libraryVersion: number; onLibraryChange: () => void }) {
  const favorites = useMemo(() => getFavorites(), [libraryVersion])
  const history = useMemo(() => getHistory(), [libraryVersion])

  return (
    <>
      <header className="page-intro">
        <h1>收藏</h1>
        <p>留下的片子，和最近看过的，都在这一页。</p>
      </header>
      <h2 className="block-title">留下的</h2>
      {favorites.length === 0 ? (
        <EmptyState title="还没有留下片子。" hint="在详情页点「留下它」。" href="#/discover" action="去发现影片" />
      ) : (
        <ShelfTable rows={favorites} hrefFor={(id) => `#/detail/${id}`} />
      )}
      <div className="section-head">
        <h2>最近看过</h2>
        {history.length ? (
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              clearHistory()
              onLibraryChange()
            }}
          >
            清空
          </button>
        ) : null}
      </div>
      {history.length === 0 ? (
        <p className="note">看过的片子会出现在这里，方便回到上一段。</p>
      ) : (
        <ShelfTable rows={history} hrefFor={(id, ep) => `#/play/${id}/${ep ?? 0}`} />
      )}
    </>
  )
}

function ShelfTable({
  rows,
  hrefFor,
}: {
  rows: { id: string; title: string; cover: string; channel: ChannelId; score: number; ep?: number }[]
  hrefFor: (id: string, ep?: number) => string
}) {
  return (
    <div className="table-wrap">
      <table className="rank-table">
        <tbody>
          {rows.map((item) => (
            <tr key={item.id}>
              <td>
                <a className="rank-film" href={hrefFor(item.id, item.ep)}>
                  {item.cover ? <img src={item.cover} alt="" /> : <span className="poster-fallback" />}
                  <span>
                    <strong>{item.title}</strong>
                    <em>
                      {channelName(item.channel)}
                      {item.ep !== undefined && item.ep > 0 ? ` · 第 ${item.ep + 1} 段` : ''}
                    </em>
                  </span>
                </a>
              </td>
              <td>{item.score > 0 ? item.score.toFixed(1) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
