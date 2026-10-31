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
/** 播放中不再碰画面，进度条就收起来。 */
const CHROME_IDLE = 3_000

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
  const level = muted || volume <= 0 ? 0 : volume < 0.34 ? 1 : volume < 0.67 ? 2 : 3
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" strokeLinejoin="round" />
      {level === 0 ? <path d="m16 9 5 6M21 9l-5 6" strokeLinecap="round" /> : null}
      {level >= 1 ? <path d="M15.2 9.2a4.2 4.2 0 0 1 0 5.6" strokeLinecap="round" /> : null}
      {level >= 2 ? <path d="M17.6 7a7.2 7.2 0 0 1 0 10" strokeLinecap="round" /> : null}
      {level >= 3 ? <path d="M20 4.8a10.2 10.2 0 0 1 0 14.4" strokeLinecap="round" /> : null}
    </svg>
  )
}

function FullscreenIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {active ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

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
  const [chrome, setChrome] = useState(true)
  const [fullscreenOn, setFullscreenOn] = useState(false)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const playingRef = useRef(false)
  const chromeRef = useRef(true)
  const overControls = useRef(false)
  const controlsFocused = useRef(false)
  const savedVolume = useRef(1)
  const volumeRef = useRef(1)
  const mutedRef = useRef(false)
  const hideTimer = useRef(0)
  const fullscreenActions = useRef({
    onVideoClick: () => {},
    toggle: () => {},
    toggleMute: () => {},
    fullscreen: () => {},
    seek: (_value: number) => {},
    changeVolume: (_value: number) => {},
    onDownload: undefined as (() => void) | undefined,
    scheduleHide: () => {},
    clearHideTimer: () => {},
  })
  playingRef.current = playing
  chromeRef.current = chrome
  volumeRef.current = volume
  mutedRef.current = muted

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
    video.volume = mutedRef.current ? 0 : volumeRef.current
    video.muted = mutedRef.current || volumeRef.current === 0
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
        setError('播放遇到一点问题，换条线路再试试。')
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
          if (live) setError('播放器开了个小差，刷新页面再试试。')
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

  const clearHideTimer = () => window.clearTimeout(hideTimer.current)
  const hideBlocked = () => overControls.current || controlsFocused.current || !playingRef.current
  const scheduleHide = () => {
    clearHideTimer()
    hideTimer.current = window.setTimeout(() => {
      if (!hideBlocked()) setChrome(false)
    }, CHROME_IDLE)
  }

  useEffect(() => {
    const sync = () => {
      const on = document.fullscreenElement === stageRef.current
      setFullscreenOn(on)
      if (on) setChrome(true)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  // 全屏元素里的点击到不了 React 根节点，控制条、进度和音量要在舞台上直接听。
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const controls = stage.querySelector<HTMLElement>('.controls')
    const inFullscreen = () => document.fullscreenElement === stage

    const onClick = (event: MouseEvent) => {
      if (!inFullscreen()) return
      const target = event.target
      if (!(target instanceof Element)) return
      const actions = fullscreenActions.current
      if (target.closest('.controls')) {
        const button = target.closest('button')
        if (!button || button.matches(':disabled')) return
        if (button.classList.contains('control-volume')) actions.toggleMute()
        else if (button.classList.contains('control-fullscreen')) actions.fullscreen()
        else if (button.classList.contains('control-download')) actions.onDownload?.()
        else actions.toggle()
        return
      }
      if (target.closest('.stage-center')) {
        actions.toggle()
        return
      }
      actions.onVideoClick()
    }

    const onInput = (event: Event) => {
      if (!inFullscreen()) return
      const target = event.target
      if (!(target instanceof HTMLInputElement)) return
      if (target.classList.contains('seek')) fullscreenActions.current.seek(Number(target.value))
      else if (target.classList.contains('volume')) fullscreenActions.current.changeVolume(Number(target.value))
    }

    const onPointerMove = () => {
      if (!inFullscreen() || !playingRef.current || !chromeRef.current) return
      if (overControls.current || controlsFocused.current) return
      fullscreenActions.current.scheduleHide()
    }

    const onEnter = () => {
      if (!inFullscreen()) return
      overControls.current = true
      fullscreenActions.current.clearHideTimer()
    }
    const onLeave = () => {
      if (!inFullscreen()) return
      overControls.current = false
      if (playingRef.current && chromeRef.current && !controlsFocused.current) fullscreenActions.current.scheduleHide()
    }
    const onFocusIn = () => {
      if (!inFullscreen()) return
      controlsFocused.current = true
      setChrome(true)
      fullscreenActions.current.clearHideTimer()
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!inFullscreen()) return
      const next = event.relatedTarget
      if (next instanceof Node && controls?.contains(next)) return
      controlsFocused.current = false
      if (playingRef.current && !overControls.current) fullscreenActions.current.scheduleHide()
    }

    stage.addEventListener('click', onClick, true)
    stage.addEventListener('input', onInput, true)
    stage.addEventListener('pointermove', onPointerMove)
    controls?.addEventListener('pointerenter', onEnter)
    controls?.addEventListener('pointerleave', onLeave)
    controls?.addEventListener('focusin', onFocusIn)
    controls?.addEventListener('focusout', onFocusOut)
    return () => {
      stage.removeEventListener('click', onClick, true)
      stage.removeEventListener('input', onInput, true)
      stage.removeEventListener('pointermove', onPointerMove)
      controls?.removeEventListener('pointerenter', onEnter)
      controls?.removeEventListener('pointerleave', onLeave)
      controls?.removeEventListener('focusin', onFocusIn)
      controls?.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  useEffect(() => {
    if (!playing) {
      clearHideTimer()
      setChrome(true)
      return
    }
    if (chrome && !hideBlocked()) scheduleHide()
    else clearHideTimer()
    return clearHideTimer
  }, [playing, chrome])

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
    if (document.fullscreenElement === stage) void document.exitFullscreen()
    else void stage.requestFullscreen().catch(() => undefined)
  }

  const changeVolume = (value: number) => {
    const video = videoRef.current
    const next = Math.min(1, Math.max(0, value))
    if (next > 0) savedVolume.current = next
    setVolume(next)
    setMuted(next === 0)
    if (!video) return
    video.volume = next
    video.muted = next === 0
  }

  const toggleMute = () => {
    const video = videoRef.current
    if (!video) return
    if (video.muted || video.volume === 0) {
      const restore = savedVolume.current > 0 ? savedVolume.current : 1
      video.muted = false
      video.volume = restore
      setVolume(restore)
      setMuted(false)
      return
    }
    savedVolume.current = video.volume || savedVolume.current || 1
    video.muted = true
    setMuted(true)
  }

  const poke = () => {
    if (!playingRef.current || !chromeRef.current || hideBlocked()) return
    scheduleHide()
  }

  const onVideoClick = () => {
    if (!playingRef.current) {
      toggle()
      return
    }
    setChrome((shown) => !shown)
  }

  fullscreenActions.current = {
    onVideoClick,
    toggle,
    toggleMute,
    fullscreen,
    seek,
    changeVolume,
    onDownload,
    scheduleHide,
    clearHideTimer,
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
    <div className={chrome ? 'stage' : 'stage is-quiet'} ref={stageRef} onPointerMove={poke}>
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
          if (episode.url && !giveUpRef.current()) setError('播放遇到一点问题，换条线路再试试。')
        }}
        onClick={onVideoClick}
      />
      {message ? <div className="stage-error">{message}</div> : null}
      {showLoading ? (
        <div className="stage-loading" role="status">
          <span className="stage-spin" />
          <span>正在为你加载精彩内容…</span>
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
      <div
        className={chrome ? 'controls' : 'controls is-hidden'}
        onPointerEnter={() => {
          overControls.current = true
          clearHideTimer()
        }}
        onPointerLeave={() => {
          overControls.current = false
          if (playingRef.current && chrome && !controlsFocused.current) scheduleHide()
        }}
        onFocus={() => {
          controlsFocused.current = true
          setChrome(true)
          clearHideTimer()
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next instanceof Node && event.currentTarget.contains(next)) return
          controlsFocused.current = false
          if (playingRef.current && !overControls.current) scheduleHide()
        }}
      >
        <button type="button" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{formatTime(current)}</span>
        <input
          className="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          aria-label="进度"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="time">{formatTime(duration)}</span>
        <button
          type="button"
          className="control-volume"
          aria-label={muted || volume === 0 ? '取消静音' : '静音'}
          aria-pressed={muted || volume === 0}
          onClick={toggleMute}
        >
          <VolumeIcon muted={muted} volume={volume} />
        </button>
        <input
          className="volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          aria-label="音量"
          onChange={(event) => changeVolume(Number(event.target.value))}
        />
        <button type="button" className="control-fullscreen" onClick={fullscreen} aria-label={fullscreenOn ? '退出全屏' : '全屏'}>
          <FullscreenIcon active={fullscreenOn} />
          <span>{fullscreenOn ? '退出全屏' : '全屏'}</span>
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
