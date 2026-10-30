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
        <p>收下的精彩和最近看过的，都在这里，继续你的精彩旅程。</p>
      </header>
      <h2 className="block-title">我的收藏</h2>
      {favorites.length === 0 ? (
        <EmptyState title="暂时还没有收藏" hint="在详情页点「收下这份精彩」，下次从这里一键打开。" href="#/discover" action="马上探索" />
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
        <p className="note">暂时还没有观看记录，去发现更多精彩吧。</p>
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
                      {item.ep !== undefined && item.ep > 0 ? ` · 第 ${item.ep + 1} 集` : ''}
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
