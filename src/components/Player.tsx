import { useEffect, useRef, useState, type RefObject } from 'react'
import type Hls from 'hls.js'
import hlsWorkerUrl from 'hls.js/dist/hls.worker.js?url'
import { createAdSkipper } from '../lib/adSkip'
import { createSegmentPrefetch } from '../lib/hlsPrefetch'
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
  /** 这条线路开不了播时调用。返回 true 表示页面去换线路，播放器就不再报错。 */
  onStartFail?: () => boolean
  /** 传入时 video 元素挂在这个 ref 上，页面可以读播放状态。 */
  mediaRef?: RefObject<HTMLVideoElement | null>
}

/** 开播这么久还一点画面都没缓冲上，就当这条线路连不上。探线路时它刚下得动，正常的线路用不了这么久。 */
const START_LIMIT = 20_000

function bufferedAhead(video: HTMLVideoElement) {
  let ahead = 0
  for (let index = 0; index < video.buffered.length; index += 1) {
    const end = video.buffered.end(index)
    if (end > video.currentTime) ahead = Math.max(ahead, end - video.currentTime)
  }
  return ahead
}

function playUrl(url: string) {
  return url.includes('/api-video-pomelo7-server/play/') ? url : absolutePlayUrl(url)
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

type HlsClass = typeof Hls

let hlsModule: Promise<HlsClass> | undefined

function loadHls(): Promise<HlsClass> {
  hlsModule ??= import('hls.js').then(
    (module) => module.default,
    (reason: unknown) => {
      hlsModule = undefined
      throw reason
    },
  )
  return hlsModule
}

/** hls.js 单独成一块，首页不带它。详情页、播放页一打开就先拉回来，探好线路就能直接开播。 */
export function preloadPlayer(): void {
  void loadHls().catch(() => undefined)
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
  onStartFail,
  mediaRef,
}: Props) {
  const ownVideoRef = useRef<HTMLVideoElement | null>(null)
  const videoRef = mediaRef ?? ownVideoRef
  const stageRef = useRef<HTMLDivElement | null>(null)
  const onEndedRef = useRef(onEnded)
  const onStartFailRef = useRef(onStartFail)
  /** 还没缓冲上画面时放弃这条线路，交给页面换。每个地址只放弃一次，返回页面换没换。 */
  const giveUpRef = useRef<() => boolean>(() => false)
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
  onStartFailRef.current = onStartFail

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
    const stops: (() => void)[] = []
    let live = true
    let recovered = false
    let still = 0
    let lastTime = -1
    let gaveUp = false
    giveUpRef.current = () => {
      if (gaveUp || video.buffered.length) return false
      gaveUp = true
      return onStartFailRef.current?.() ?? false
    }
    const startTimer = window.setTimeout(() => giveUpRef.current(), START_LIMIT)
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
    const playNative = () => {
      video.src = episode.url
      video.load()
    }
    const playHls = (Hls: HlsClass) => {
      const BaseLoader = Hls.DefaultConfig.loader
      class ProxyLoader extends BaseLoader {
        load(...args: Parameters<InstanceType<typeof BaseLoader>['load']>) {
          const [context, config, callbacks] = args
          const upstream = upstreamFromPlay(context.url) || context.url
          context.url = playUrl(String(context.url))
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
      const prefetch = createSegmentPrefetch(ProxyLoader, () => hls, playUrl)
      const skipper = createAdSkipper(video, () => hls)
      stops.push(prefetch.dispose, skipper.stop)
      hls = new Hls({
        lowLatencyMode: false,
        enableWorker: true,
        // ESM 版的 hls.js 不自带 worker，不给 workerPath 时 enableWorker 不起作用，转封装会跑在主线程上。
        workerPath: hlsWorkerUrl,
        startLevel: 0,
        capLevelToPlayerSize: true,
        abrEwmaDefaultEstimate: 600000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.55,
        // 片源偶尔会停顿十几秒，缓冲多攒一些才扛得住。
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
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
        fLoader: prefetch.Loader,
      })
      hls.loadSource(episode.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => capLevel(hls as Hls))
      hls.on(Hls.Events.INIT_PTS_FOUND, (_, data) => skipper.found(data))
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || !hls) return
        if (giveUpRef.current()) return
        if (!recovered) {
          recovered = true
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else hls.recoverMediaError()
          return
        }
        setError('这一段暂时安静了，换一条线路，或稍后再来。')
      })
    }
    if (episode.url.includes('.m3u8')) {
      loadHls()
        .then((Hls) => {
          if (!live) return
          if (Hls.isSupported()) playHls(Hls)
          else playNative()
        })
        .catch(() => {
          if (live) setError('播放器没有加载上来，刷新页面再试一次。')
        })
    } else {
      playNative()
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
      live = false
      window.clearInterval(stuckTimer)
      window.clearTimeout(bootTimer)
      window.clearTimeout(startTimer)
      giveUpRef.current = () => false
      hls?.destroy()
      stops.forEach((stop) => stop())
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
          // 换线路拆掉旧画面时也会触发一次、位置归零。还没有画面就不记进度，免得冲掉续播位置。
          if (video.readyState > 0) onTime(time)
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
          if (episode.url && !giveUpRef.current()) setError('画面没有回应。换一条线路，或稍后再来。')
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
