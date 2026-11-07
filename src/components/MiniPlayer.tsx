import { useEffect, useRef, useState } from 'react'
import { getVideo } from '../lib/api'
import { pausePlayback, playbackSnapshot, subscribePlayback, togglePlayback } from '../lib/playbackSession'

type Props = {
  id: string
  ep: number
  onClose: () => void
}

const RING = 2 * Math.PI * 16

export function MiniPlayer({ id, ep, onClose }: Props) {
  const screenRef = useRef<HTMLAnchorElement | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribePlayback(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    const node = screenRef.current
    if (!node) return
    const place = () => {
      const box = node.getBoundingClientRect()
      if (box.width < 8 || box.height < 8) return
      const root = document.documentElement
      root.style.setProperty('--mini-x', `${Math.round(box.left)}px`)
      root.style.setProperty('--mini-y', `${Math.round(box.top)}px`)
      root.style.setProperty('--mini-w', `${Math.round(box.width)}px`)
      root.style.setProperty('--mini-h', `${Math.round(box.height)}px`)
    }
    place()
    const frame = window.requestAnimationFrame(place)
    const observer = new ResizeObserver(place)
    observer.observe(node)
    const bar = node.closest('.player-stack')
    if (bar) observer.observe(bar)
    window.addEventListener('resize', place)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', place)
      const root = document.documentElement
      root.style.removeProperty('--mini-x')
      root.style.removeProperty('--mini-y')
      root.style.removeProperty('--mini-w')
      root.style.removeProperty('--mini-h')
    }
  }, [])
  void revision
  const now = playbackSnapshot()
  const video = getVideo(id)
  const episode = video?.episodes[ep]
  const title = video?.title || '正在播放'
  const subtitle = episode && episode.title !== video?.title ? episode.title : '正在播放'
  const href = `#/play/${id}/${ep}`
  const playing = Boolean(now?.playing)
  const progress = now && now.duration > 0 ? Math.min(1, Math.max(0, now.current / now.duration)) : 0
  const tone = video?.tone

  return (
    <div className="player-stack" role="region" aria-label="正在播放">
      <div className="player-dock">
        <a
          className="mini-screen"
          href={href}
          ref={screenRef}
          aria-label={`回到播放：${title}`}
          style={tone ? { background: `linear-gradient(160deg, ${tone[0]}, ${tone[1]})` } : undefined}
        />
        <a className="mini-meta" href={href}>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </a>
        <div className="mini-actions">
          <button
            type="button"
            className="mini-btn mini-toggle"
            aria-label={playing ? '暂停' : '播放'}
            onClick={() => togglePlayback()}
          >
            <svg className="mini-ring" viewBox="0 0 40 40" aria-hidden="true">
              <circle cx="20" cy="20" r="16" />
              <circle cx="20" cy="20" r="16" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
            </svg>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="mini-btn" aria-label="关闭播放" onClick={() => { pausePlayback(); onClose() }}>
            <CloseIcon />
          </button>
        </div>
      </div>
    </div>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 7.2v9.6l8.2-4.8L9 7.2Z" fill="currentColor" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 6.5h2.6v11H8v-11Zm5.4 0H16v11h-2.6v-11Z" fill="currentColor" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
