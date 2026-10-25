import { useState } from 'react'
import { metaLine } from '../lib/api'
import { nextCover } from '../lib/mediaProxy'
import type { VideoItem } from '../lib/types'

export function Poster({
  item,
  anchor = false,
  onOpen,
}: {
  item: VideoItem
  anchor?: boolean
  onOpen?: () => void
}) {
  return (
    <a
      className={anchor ? 'poster-card is-anchor' : 'poster-card'}
      href={`#/detail/${item.id}`}
      data-video-id={item.id}
      onClick={onOpen}
    >
      <PosterFace item={item} />
      <strong>{item.title}</strong>
      <span>{metaLine(item)}</span>
    </a>
  )
}

export function PosterFace({
  item,
  compact = false,
}: {
  item: Pick<VideoItem, 'cover' | 'mark' | 'tone' | 'score' | 'badge'>
  compact?: boolean
}) {
  const [url, setUrl] = useState(item.cover || '')
  return (
    <div className={compact ? 'poster poster-compact' : 'poster'} style={{ background: `linear-gradient(160deg, ${item.tone[0]}, ${item.tone[1]})` }}>
      {url ? (
        <img
          src={url}
          alt=""
          onError={() => {
            const next = nextCover(url)
            setUrl(next)
          }}
        />
      ) : (
        <span className="poster-mark">{item.mark}</span>
      )}
      {!compact && item.badge ? <i>{item.badge}</i> : null}
      {!compact && item.score > 0 ? <em>{item.score.toFixed(1)}</em> : null}
    </div>
  )
}
