import { useEffect, useState } from 'react'
import { PosterGrid } from '../components/PosterGrid'
import { PosterFace } from '../components/Poster'
import { channelName, getVideo, metaLine, relatedVideos } from '../lib/api'
import { ensureDetail } from '../lib/source'
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
        if (live) setItem(video)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '没有找到这部片子')
      })
    return () => {
      live = false
    }
  }, [id])

  if (error) return <p className="note">{error}</p>
  if (!item) return <p className="note">故事还在路上…</p>
  const saved = isFavorite(item.id)
  const history = historyOf(item.id)
  const resumeEp = history?.ep ?? 0
  void libraryVersion

  return (
    <>
      <p className="crumb">
        <a href="#/discover">发现影片</a>
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
          {item.summary ? <p>{item.summary}</p> : null}
          <div className="detail-actions">
            <a className="btn" href={`#/play/${item.id}/${resumeEp}`}>
              {history ? '继续观看' : '开始观看'}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                toggleFavorite(item)
                onLibraryChange()
              }}
            >
              {saved ? '已留下' : '留下它'}
            </button>
          </div>
        </div>
      </section>
      <h2 className="block-title">选一段</h2>
      {item.episodes.length ? (
        <div className="ep-grid">
          {item.episodes.map((episode, index) => (
            <a key={episode.id} className={index === resumeEp ? 'active' : ''} href={`#/play/${item.id}/${index}`}>
              {episode.title}
            </a>
          ))}
        </div>
      ) : (
        <p className="note">选集还在整理。</p>
      )}
      <h2 className="block-title">也许你也想看</h2>
      <PosterGrid items={relatedVideos(item.id)} />
    </>
  )
}
