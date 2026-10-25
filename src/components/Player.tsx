import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { absolutePlayUrl, rewritePlaylist, upstreamFromPlay } from '../lib/mediaProxy'
import type { Episode } from '../lib/types'

type Props = {
  episode: Episode
  resumeAt: number
  onTime: (time: number) => void
  onEnded: () => void
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const total = Math.floor(value)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function Player({ episode, resumeAt, onTime, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const resumed = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    resumed.current = false
    setError('')
    setPlaying(false)
    setCurrent(0)
    const video = videoRef.current
    if (!video || !episode.url) return
    let hls: Hls | undefined
    if (episode.url.includes('.m3u8') && Hls.isSupported()) {
      const slow = {
        maxTimeToFirstByteMs: 30000,
        maxLoadTimeMs: 120000,
        timeoutRetry: { maxNumRetry: 3, retryDelayMs: 500, maxRetryDelayMs: 4000 },
        errorRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      }
      const BaseLoader = Hls.DefaultConfig.loader
      class ProxyLoader extends BaseLoader {
        load(...args: Parameters<InstanceType<typeof BaseLoader>['load']>) {
          const [context, config, callbacks] = args
          const upstream = upstreamFromPlay(context.url) || context.url
          if (!String(context.url).includes('/api-video-pomelo7-server/play/')) context.url = absolutePlayUrl(context.url)
          const onSuccess = callbacks.onSuccess
          callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
            const detailUrl = networkDetails && 'responseURL' in networkDetails ? networkDetails.responseURL : networkDetails?.url
            const finalUpstream = upstreamFromPlay(detailUrl || ctx.url) || upstream
            if (typeof response.data === 'string' && response.data.includes('#EXTM3U')) {
              response.data = rewritePlaylist(response.data, finalUpstream)
            }
            onSuccess(response, stats, ctx, networkDetails)
          }
          super.load(context, config, callbacks)
        }
      }
      hls = new Hls({
        lowLatencyMode: false,
        maxBufferLength: 48,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        startFragPrefetch: true,
        manifestLoadPolicy: { default: slow },
        playlistLoadPolicy: { default: slow },
        fragLoadPolicy: { default: slow },
        loader: ProxyLoader,
      })
      hls.loadSource(episode.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) setError('这一段暂时安静了，换一条线路，或稍后再来。')
      })
    } else {
      video.src = episode.url
      video.load()
    }
    return () => {
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [episode.url])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setError('这一段暂时安静了，换一段试试。'))
    else video.pause()
  }

  const seek = (value: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = value
    setCurrent(value)
    onTime(value)
  }

  const fullscreen = () => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen().catch(() => undefined)
  }

  return (
    <div className="stage" ref={stageRef}>
      <video
        ref={videoRef}
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const time = event.currentTarget.currentTime
          setCurrent(time)
          onTime(time)
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          setDuration(video.duration || 0)
          if (!resumed.current && resumeAt > 1 && resumeAt < (video.duration || 0) - 1) {
            video.currentTime = resumeAt
            resumed.current = true
          }
        }}
        onEnded={onEnded}
        onError={() => {
          if (episode.url) setError('画面没有回应。换一段，或稍后再来。')
        }}
        onClick={toggle}
      />
      {error ? <div className="stage-error">{error}</div> : null}
      {!episode.url && !error ? <div className="stage-error">正在把画面请过来…</div> : null}
      {!playing && !error && episode.url ? (
        <button type="button" className="stage-center" onClick={toggle} aria-label="播放">
          ▶
        </button>
      ) : null}
      <div className="controls">
        <button type="button" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{formatTime(current)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          aria-label="进度"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="time">{formatTime(duration)}</span>
        <button type="button" onClick={fullscreen} aria-label="全屏">
          全屏
        </button>
      </div>
    </div>
  )
}
