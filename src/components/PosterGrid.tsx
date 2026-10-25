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
  if (!items.length) return <p className="note">这一栏还是空的。</p>
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
