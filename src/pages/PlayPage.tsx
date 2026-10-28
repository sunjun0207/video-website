import { useEffect, useRef, useState } from 'react'
import { LoadingPane } from '../components/LoadingPane'
import { Player } from '../components/Player'
import { PosterGrid } from '../components/PosterGrid'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { friendlyError } from '../lib/friendlyError'
import {
  canReveal,
  DownloadCancelled,
  downloadFilename,
  downloadMedia,
  qualityFromLine,
  revealSaved,
  type DownloadGate,
  type DownloadProgress,
  type SavedFile,
} from '../lib/downloadMedia'
import { ensureDetail, ensurePlayUrl, prefetchPlay } from '../lib/source'
import { historyOf, rememberPlay } from '../lib/storage'
import type { VideoItem } from '../lib/types'

/** 这一集还剩这么多秒时，悄悄把下一集的线路探好。探好的地址几分钟后就会失效，不能探得太早。 */
const NEXT_PREFETCH_LEAD = 90
/** 刚开播的前这么多秒不探下一集，不和这一集抢带宽。 */
const NEXT_PREFETCH_AFTER = 20

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[unit]}`
}

function downloadSizeText(progress: DownloadProgress): string {
  const received = formatSize(progress.received)
  if (progress.total > 0) return `${received} / ${formatSize(progress.total)}`
  return `已下载 ${received}`
}

function downloadSpeedText(progress: DownloadProgress, paused: boolean): string {
  if (paused) return '已暂停'
  if (progress.received <= 0 || progress.speed <= 0) return '正在连接…'
  return `${formatSize(progress.speed)}/s`
}

export function PlayPage({ id, ep, onLibraryChange }: { id: string; ep: number; onLibraryChange: () => void }) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [playUrl, setPlayUrl] = useState('')
  const [readyKey, setReadyKey] = useState('')
  const [lineName, setLineName] = useState('')
  const [error, setError] = useState('')
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [downloadPaused, setDownloadPaused] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [saved, setSaved] = useState<SavedFile | null>(null)
  const [pick, setPick] = useState<{ id: string; ep: number; path: string } | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)
  const downloadGate = useRef<DownloadGate | null>(null)
  const mediaRef = useRef<HTMLVideoElement | null>(null)
  const savedAt = useRef(0)
  const advanced = useRef(false)
  const nextPrefetched = useRef(false)
  const index = item && item.episodes.length ? Math.min(Math.max(ep, 0), item.episodes.length - 1) : Math.max(ep, 0)
  const episode = item?.episodes[index]
  const history = item ? historyOf(item.id) : undefined
  const resumeAt = history && history.ep === index ? history.time : 0
  const forced = pick && pick.id === id && pick.ep === index ? pick.path : ''
  const requestKey = `${id}:${index}:${forced}`
  const activeUrl = readyKey === requestKey ? playUrl : ''

  useEffect(() => {
    advanced.current = false
    nextPrefetched.current = false
  }, [id, index])

  useEffect(() => {
    setDownloadError('')
    setDownload(null)
    setDownloadPaused(false)
    setSaved(null)
    downloadGate.current = null
    const current = downloadAbort
    return () => {
      current.current?.abort()
      current.current = null
    }
  }, [requestKey])

  useEffect(() => {
    let live = true
    setError('')
    setLineName('')
    ensureDetail(id)
      .then((video) => {
        if (!live) return null
        setItem(video)
        return ensurePlayUrl(id, index, forced)
      })
      .then((result) => {
        if (!live || !result) return
        setItem(getVideo(id))
        setPlayUrl(result.url)
        setLineName(result.line)
        setReadyKey(requestKey)
      })
      .catch((reason: unknown) => {
        if (live) setError(friendlyError(reason, '这一段还没到来。'))
      })
    return () => {
      live = false
    }
  }, [id, index, forced, requestKey])

  useEffect(() => {
    if (!item) return
    rememberPlay(item, index, resumeAt)
    onLibraryChange()
  }, [item, index, onLibraryChange, resumeAt])

  if (error && !item) return <p className="note">{error}</p>
  if (!item || !episode) return <LoadingPane kind="play" title="正在加载中…" />

  const remember = (time: number) => {
    const left = (mediaRef.current?.duration ?? Number.NaN) - time
    if (!nextPrefetched.current && index < item.episodes.length - 1 && time >= NEXT_PREFETCH_AFTER && left <= NEXT_PREFETCH_LEAD) {
      nextPrefetched.current = true
      prefetchPlay(item.id, index + 1)
    }
    const now = Date.now()
    if (now - savedAt.current < 1500) return
    savedAt.current = now
    rememberPlay(item, index, time)
  }

  const goNext = () => {
    if (advanced.current || index >= item.episodes.length - 1) return
    advanced.current = true
    rememberPlay(item, index + 1, 0)
    onLibraryChange()
    window.location.hash = `#/play/${item.id}/${index + 1}`
  }

  const toggleDownload = () => {
    const gate = downloadGate.current
    if (!gate) return
    if (gate.paused) {
      gate.resume()
      setDownloadPaused(false)
      return
    }
    gate.pause()
    setDownloadPaused(true)
  }

  const startDownload = () => {
    if (!activeUrl || downloadAbort.current) return
    const controller = new AbortController()
    downloadAbort.current = controller
    downloadGate.current = null
    setDownloadError('')
    setDownloadPaused(false)
    setSaved(null)
    setDownload({ percent: 0, received: 0, total: 0, speed: 0 })
    const episodeName = item.episodes.length > 1 && episode.title !== item.title ? episode.title : ''
    const filename = downloadFilename(item.title, qualityFromLine(lineName), episodeName)
    downloadMedia({
      url: activeUrl,
      filename,
      signal: controller.signal,
      media: () => mediaRef.current,
      onGate: (gate) => {
        if (downloadAbort.current === controller) downloadGate.current = gate
      },
      onProgress: (progress) => {
        if (downloadAbort.current === controller) setDownload(progress)
      },
    })
      .then((file) => {
        if (downloadAbort.current !== controller) return
        downloadAbort.current = null
        downloadGate.current = null
        setDownloadPaused(false)
        setDownload(null)
        setSaved(file)
      })
      .catch((reason: unknown) => {
        if (downloadAbort.current !== controller) return
        downloadAbort.current = null
        downloadGate.current = null
        setDownloadPaused(false)
        setDownload(null)
        if (controller.signal.aborted || reason instanceof DownloadCancelled) return
        setDownloadError(friendlyError(reason, '这次没有下载下来。'))
      })
  }

  return (
    <>
      <p className="crumb">
        <a href="#/discover">发现影片</a>
        <span>/</span>
        <a href={`#/detail/${item.id}`}>{item.title}</a>
        <span>/</span>
        <em>{episode.title}</em>
      </p>
      <div className="play-layout">
        <div>
          <Player
            episode={{ ...episode, url: activeUrl }}
            resumeAt={activeUrl ? resumeAt : 0}
            notice={error}
            downloadLabel={download === null ? '下载' : downloadPaused ? '继续下载' : `暂停 ${download.percent}%`}
            downloadDisabled={download === null && !activeUrl}
            onDownload={download === null ? startDownload : toggleDownload}
            onTime={remember}
            onEnded={goNext}
            mediaRef={mediaRef}
          />
          <div className="play-copy">
            <h1>{item.title}</h1>
            <p className="meta">
              {channelName(item.channel)}
              {lineName ? ` · ${lineName}` : ''}
            </p>
            <div className="play-actions">
              {download === null && saved ? (
                <div className="download-done">
                  <p className="download-status">
                    <strong>下载完成</strong>
                    <span>{saved.name}</span>
                  </p>
                  {canReveal(saved) ? (
                    <button type="button" className="btn" onClick={() => void revealSaved(saved)}>
                      打开所在文件夹
                    </button>
                  ) : null}
                  <button type="button" className="btn btn-ghost" onClick={() => setSaved(null)}>
                    知道了
                  </button>
                </div>
              ) : download === null ? (
                <button type="button" className="btn" disabled={!activeUrl} onClick={startDownload}>
                  下载
                </button>
              ) : (
                <div className="download-panel">
                  <div className="download-meter">
                    <div
                      className="download-bar"
                      role="progressbar"
                      aria-valuenow={download.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="下载进度"
                    >
                      <span style={{ width: `${download.percent}%` }} />
                    </div>
                    <p className="download-status">
                      <strong>{download.percent}%</strong>
                      <span>{downloadSizeText(download)}</span>
                      <span>{downloadSpeedText(download, downloadPaused)}</span>
                    </p>
                  </div>
                  <button type="button" className="btn" onClick={toggleDownload}>
                    {downloadPaused ? '继续下载' : '暂停'}
                  </button>
                </div>
              )}
            </div>
            {downloadError ? <p className="note">{downloadError}</p> : null}
            {download === null && saved && !canReveal(saved) ? (
              <p className="note">文件交给了浏览器保存，在浏览器的下载列表（Ctrl+J）里点“在文件夹中显示”就能打开所在位置。</p>
            ) : null}
          </div>
          {episode.lines && episode.lines.length > 1 ? (
            <div className="chips line-chips">
              {episode.lines.map((line) => (
                <button
                  key={line.playPath}
                  type="button"
                  className={line.playPath === (forced || episode.playPath) ? 'chip active' : 'chip'}
                  onClick={() => setPick({ id, ep: index, path: line.playPath })}
                >
                  {[line.label, line.note].filter(Boolean).join(' · ') || '线路'}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <aside className="play-side">
          <h2>选集</h2>
          <div className="ep-list">
            {item.episodes.map((entry, entryIndex) => (
              <a key={entry.id} className={entryIndex === index ? 'active' : ''} href={`#/play/${item.id}/${entryIndex}`}>
                {entry.title}
              </a>
            ))}
          </div>
        </aside>
      </div>
      <h2 className="block-title">也许你也想看</h2>
      <PosterGrid items={relatedVideos(item.id, 5)} />
    </>
  )
}
