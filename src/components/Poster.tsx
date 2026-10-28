import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { metaLine } from '../lib/api'
import { nextCover } from '../lib/mediaProxy'
import { prefetchDetail } from '../lib/source'
import type { VideoItem } from '../lib/types'

/** 鼠标在海报上停这么久才预取，一扫而过的不算。 */
const HOVER_PREFETCH = 120

export function usePrefetchDetail(id: string) {
  const timer = useRef(0)
  return {
    onPointerEnter: (event: ReactPointerEvent) => {
      if (event.pointerType !== 'mouse') return
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => prefetchDetail(id), HOVER_PREFETCH)
    },
    onPointerLeave: () => window.clearTimeout(timer.current),
    onPointerDown: () => prefetchDetail(id),
    onFocus: () => prefetchDetail(id),
  }
}

export function Poster({
  item,
  anchor = false,
  onOpen,
}: {
  item: VideoItem
  anchor?: boolean
  onOpen?: () => void
}) {
  const prefetch = usePrefetchDetail(item.id)
  return (
    <a
      className={anchor ? 'poster-card is-anchor' : 'poster-card'}
      href={`#/detail/${item.id}`}
      data-video-id={item.id}
      onClick={onOpen}
      {...prefetch}
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
          loading="lazy"
          decoding="async"
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
