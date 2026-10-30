import type { VideoItem } from '../lib/types'
import { Poster } from './Poster'

export function PosterGrid({
  items,
  anchorId = '',
  onOpen,
}: {
  items: VideoItem[]
  anchorId?: string
  onOpen?: (item: VideoItem) => void
}) {
  if (!items.length) return <p className="note">暂时还没有内容，去发现更多精彩吧。</p>
  return (
    <div className="poster-grid">
      {items.map((item) => (
        <Poster
          key={item.id}
          item={item}
          anchor={item.id === anchorId}
          onOpen={onOpen ? () => onOpen(item) : undefined}
        />
      ))}
    </div>
  )
}
