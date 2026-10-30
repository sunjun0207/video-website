import { useEffect, useState } from 'react'
import { LoadingPane } from '../components/LoadingPane'
import { preloadPlayer } from '../components/Player'
import { PosterGrid } from '../components/PosterGrid'
import { PosterFace } from '../components/Poster'
import { channelName, getVideo, metaLine, relatedVideos } from '../lib/api'
import { friendlyError } from '../lib/friendlyError'
import { ensureDetail, prefetchPlay } from '../lib/source'
import { historyOf, isFavorite, toggleFavorite } from '../lib/storage'
import type { VideoItem } from '../lib/types'

export function DetailPage({ id, libraryVersion, onLibraryChange }: { id: string; libraryVersion: number; onLibraryChange: () => void }) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    setItem(getVideo(id))
    ensureDetail(id)
      .then((video) => {
        if (!live) return
        setItem(video)
        prefetchPlay(video.id, historyOf(video.id)?.ep ?? 0)
        preloadPlayer()
      })
      .catch((reason: unknown) => {
        if (live) setError(friendlyError(reason, '网络开了个小差，请稍后再试。'))
      })
    return () => {
      live = false
    }
  }, [id])

  if (error) return <p className="note">{error}</p>
  if (!item) return <LoadingPane kind="detail" title="正在为你加载精彩内容…" />
  const saved = isFavorite(item.id)
  const history = historyOf(item.id)
  const resumeEp = history?.ep ?? 0
  void libraryVersion

  return (
    <>
      <p className="crumb">
        <a href="#/discover">首页</a>
        <span>/</span>
        <a href={`#/channel/${item.channel}`}>{channelName(item.channel)}</a>
        <span>/</span>
        <em>{item.title}</em>
      </p>
      <section className="detail-head">
        <PosterFace item={item} />
        <div>
          <h1>{item.title}</h1>
          <p className="score-line">
            <strong>{item.score > 0 ? item.score.toFixed(1) : '—'}</strong>
            <span>分</span>
            <em>{item.updateText}</em>
          </p>
          <p className="meta">{metaLine(item)}{item.genres.length ? ` · ${item.genres.join(' / ')}` : ''}</p>
          {item.director ? <p>导演：{item.director}</p> : null}
          {item.actors.length ? <p>演职员：{item.actors.join('、')}</p> : null}
          {item.summary ? <p className="detail-summary">{item.summary}</p> : null}
          <div className="detail-actions">
            <a className="btn" href={`#/play/${item.id}/${resumeEp}`}>
              {history ? '接着看' : '立即观看'}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                toggleFavorite(item)
                onLibraryChange()
              }}
            >
              {saved ? '已收藏' : '收下这份精彩'}
            </button>
          </div>
        </div>
      </section>
      <h2 className="block-title">选集</h2>
      {item.episodes.length ? (
        <div className="ep-grid">
          {item.episodes.map((episode, index) => (
            <a key={episode.id} className={index === resumeEp ? 'active' : ''} href={`#/play/${item.id}/${index}`}>
              {episode.title}
            </a>
          ))}
        </div>
      ) : (
        <p className="note">选集正在更新，稍后再来看看。</p>
      )}
      <h2 className="block-title">猜你喜欢</h2>
      <PosterGrid items={relatedVideos(item.id)} />
    </>
  )
}
