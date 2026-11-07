import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { getVideo } from '../lib/api'
import {
  pausePlayback,
  playbackSnapshot,
  seekPlayback,
  setVolumePlayback,
  subscribePlayback,
  toggleLoopPlayback,
  toggleMutePlayback,
  togglePlayback,
} from '../lib/playbackSession'

type Props = {
  id: string
  ep: number
  onClose: () => void
}

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
  const loop = Boolean(now?.loop)
  const muted = Boolean(now?.muted)
  const volume = now ? (muted ? 0 : now.volume) : 1
  const duration = now && Number.isFinite(now.duration) ? now.duration : 0
  const current = now && Number.isFinite(now.current) ? now.current : 0
  const shown = duration > 0 ? Math.min(Math.max(current, 0), duration) : 0
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
        <div className="mini-copy">
          <a className="mini-meta" href={href}>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </a>
          <div className="mini-seek">
            <span className="mini-time">{formatTime(shown, duration >= 3600)}</span>
            <input
              className="mini-range"
              type="range"
              min={0}
              max={duration || 0}
              step="any"
              value={shown}
              style={{ '--seek': `${duration > 0 ? (shown / duration) * 100 : 0}%` } as CSSProperties}
              aria-label="播放进度"
              aria-valuemin={0}
              aria-valuemax={Math.floor(duration || 0)}
              aria-valuenow={Math.floor(shown)}
              aria-valuetext={`${formatTime(shown, duration >= 3600)} / ${formatTime(duration, duration >= 3600)}`}
              disabled={duration <= 0}
              onChange={(event) => seekPlayback(Number(event.target.value))}
            />
            <span className="mini-time mini-time-total">{formatTime(duration, duration >= 3600)}</span>
          </div>
        </div>
        <div className="mini-actions">
          <div className="mini-volume">
            <button
              type="button"
              className="mini-volume-btn"
              aria-label={muted || volume === 0 ? '取消静音' : '静音'}
              aria-pressed={muted || volume === 0}
              onClick={() => toggleMutePlayback()}
            >
              <VolumeIcon muted={muted} volume={volume} />
            </button>
            <input
              className="mini-range mini-volume-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              style={{ '--seek': `${volume * 100}%` } as CSSProperties}
              aria-label="音量"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(volume * 100)}
              aria-valuetext={`音量 ${Math.round(volume * 100)}%`}
              onChange={(event) => setVolumePlayback(Number(event.target.value))}
            />
          </div>
          <button
            type="button"
            className={loop ? 'mini-btn mini-loop is-on' : 'mini-btn mini-loop'}
            aria-pressed={loop}
            aria-label={loop ? '关闭循环播放' : '开启循环播放'}
            onClick={() => toggleLoopPlayback()}
          >
            <LoopIcon />
            <span>循环</span>
          </button>
          <button
            type="button"
            className="mini-btn mini-toggle"
            aria-label={playing ? '暂停' : '继续播放'}
            onClick={() => togglePlayback()}
          >
            {playing ? <PauseIcon /> : <PlayIcon />}
            <span>{playing ? '暂停' : '继续'}</span>
          </button>
          <button
            type="button"
            className="mini-btn mini-close"
            aria-label="关闭播放"
            onClick={() => {
              pausePlayback()
              onClose()
            }}
          >
            <CloseIcon />
            <span>关闭</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(value: number, withHours = false): string {
  if (!Number.isFinite(value) || value < 0) return withHours ? '0:00:00' : '00:00'
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  if (withHours || hours > 0) return `${hours}:${clock}`
  return clock
}

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  const level = muted || volume <= 0 ? 0 : volume < 0.34 ? 1 : volume < 0.67 ? 2 : 3
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
      {level === 0 ? <path d="m16 9 5 6M21 9l-5 6" strokeLinecap="round" /> : null}
      {level >= 1 ? <path d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6" strokeLinecap="round" /> : null}
      {level >= 2 ? <path d="M17.6 7a7.2 7.2 0 0 1 0 10" strokeLinecap="round" /> : null}
      {level >= 3 ? <path d="M20 4.8a10.2 10.2 0 0 1 0 14.4" strokeLinecap="round" /> : null}
    </svg>
  )
}

function LoopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17 2l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 22l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
