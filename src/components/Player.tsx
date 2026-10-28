import { useEffect, useRef, useState, type RefObject } from 'react'
import Hls from 'hls.js'
import { absolutePlayUrl, rewritePlaylist, upstreamFromPlay } from '../lib/mediaProxy'
import type { Episode } from '../lib/types'

type Props = {
  episode: Episode
  resumeAt: number
  notice?: string
  downloadLabel?: string
  downloadDisabled?: boolean
  onDownload?: () => void
  onTime: (time: number) => void
  onEnded: () => void
  /** 传入时 video 元素挂在这个 ref 上，页面可以读播放状态。 */
  mediaRef?: RefObject<HTMLVideoElement | null>
}

function bufferedAhead(video: HTMLVideoElement) {
  let ahead = 0
  for (let index = 0; index < video.buffered.length; index += 1) {
    const end = video.buffered.end(index)
    if (end > video.currentTime) ahead = Math.max(ahead, end - video.currentTime)
  }
  return ahead
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

const retryPolicy = {
  maxTimeToFirstByteMs: 20000,
  maxLoadTimeMs: 60000,
  timeoutRetry: { maxNumRetry: 4, retryDelayMs: 400, maxRetryDelayMs: 4000 },
  errorRetry: { maxNumRetry: 6, retryDelayMs: 800, maxRetryDelayMs: 8000 },
}

export function Player({
  episode,
  resumeAt,
  notice = '',
  downloadLabel = '下载',
  downloadDisabled = false,
  onDownload,
  onTime,
  onEnded,
  mediaRef,
}: Props) {
  const ownVideoRef = useRef<HTMLVideoElement | null>(null)
  const videoRef = mediaRef ?? ownVideoRef
  const stageRef = useRef<HTMLDivElement | null>(null)
  const onEndedRef = useRef(onEnded)
  const resumed = useRef(false)
  const booted = useRef(false)
  const played = useRef(false)
  const finished = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')

  onEndedRef.current = onEnded

  useEffect(() => {
    resumed.current = false
    booted.current = false
    played.current = false
    finished.current = false
    setError('')
    setPlaying(false)
    setBuffering(false)
    setBlocked(false)
    setCurrent(0)
    setDuration(0)
    const video = videoRef.current
    if (!video || !episode.url) return
    let hls: Hls | undefined
    let recovered = false
    let still = 0
    let lastTime = -1
    const capLevel = (instance: Hls) => {
      const capBitrate = 1_000_000
      let cap = 0
      instance.levels.forEach((level, index) => {
        const bitrate = level.bitrate || 0
        if (bitrate > 0 && bitrate <= capBitrate) cap = index
      })
      instance.autoLevelCapping = cap
      instance.loadLevel = cap
    }
    if (episode.url.includes('.m3u8') && Hls.isSupported()) {
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
        enableWorker: true,
        startLevel: 0,
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 600000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.55,
        maxBufferLength: 24,
        maxMaxBufferLength: 42,
        backBufferLength: 12,
        maxBufferHole: 0.5,
        startFragPrefetch: true,
        maxStarvationDelay: 4,
        maxLoadingDelay: 4,
        nudgeOffset: 0.15,
        nudgeMaxRetry: 12,
        manifestLoadPolicy: { default: retryPolicy },
        playlistLoadPolicy: { default: retryPolicy },
        fragLoadPolicy: { default: retryPolicy },
        loader: ProxyLoader,
      })
      hls.loadSource(episode.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => capLevel(hls as Hls))
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || !hls) return
        if (!recovered) {
          recovered = true
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else hls.recoverMediaError()
          return
        }
        setError('这一段暂时安静了，换一条线路，或稍后再来。')
      })
    } else {
      video.src = episode.url
      video.load()
    }
    const stuckTimer = window.setInterval(() => {
      if (!played.current || video.paused || video.ended || video.seeking) {
        still = 0
        lastTime = video.currentTime
        return
      }
      if (lastTime >= 0 && Math.abs(video.currentTime - lastTime) > 0.2) {
        still = 0
        lastTime = video.currentTime
        setBuffering(false)
        return
      }
      lastTime = video.currentTime
      still += 1
      if (still >= 2) setBuffering(true)
      if (still === 8 && hls) hls.startLoad()
    }, 1000)
    const bootTimer = window.setTimeout(() => {
      if (booted.current) return
      booted.current = true
      void video.play().catch(() => setBlocked(true))
    }, 7000)
    return () => {
      window.clearInterval(stuckTimer)
      window.clearTimeout(bootTimer)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [episode.url])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      setBlocked(false)
      void video.play().catch(() => setBlocked(true))
    } else video.pause()
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

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onEndedRef.current()
  }

  const message = error || notice
  const showLoading = !message && !blocked && !played.current
  const showBuffering = !message && !blocked && buffering && played.current
  const showPlay = !message && !showBuffering && (blocked || (played.current && !playing))

  return (
    <div className="stage" ref={stageRef}>
      <video
        ref={videoRef}
        playsInline
        preload="auto"
        onPlay={() => {
          played.current = true
          setPlaying(true)
          setBuffering(false)
          setBlocked(false)
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => {
          if (played.current) setBuffering(true)
        }}
        onPlaying={() => {
          played.current = true
          setPlaying(true)
          setBuffering(false)
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          const time = video.currentTime
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
        onSeeked={() => {
          if (resumed.current) resumed.current = false
        }}
        onProgress={(event) => {
          const video = event.currentTarget
          if (resumed.current || booted.current) return
          if (bufferedAhead(video) < 8) return
          booted.current = true
          void video.play().catch(() => setBlocked(true))
        }}
        onCanPlay={(event) => {
          const video = event.currentTarget
          if (resumed.current || booted.current) return
          if (bufferedAhead(video) < 8 && video.readyState < 4) return
          booted.current = true
          void video.play().catch(() => setBlocked(true))
        }}
        onEnded={finish}
        onError={() => {
          if (episode.url) setError('画面没有回应。换一条线路，或稍后再来。')
        }}
        onClick={toggle}
      />
      {message ? <div className="stage-error">{message}</div> : null}
      {showLoading ? (
        <div className="stage-loading" role="status">
          <span className="stage-spin" />
          <span>正在加载中…</span>
        </div>
      ) : null}
      {showBuffering ? (
        <div className="stage-loading" role="status">
          <span className="stage-spin" />
          <span>正在缓冲…</span>
        </div>
      ) : null}
      {showPlay ? (
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
        {onDownload ? (
          <button type="button" className="control-download" disabled={downloadDisabled} onClick={onDownload}>
            {downloadLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
