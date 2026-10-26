import { useEffect, useRef, useState } from 'react'
import { LoadingPane } from '../components/LoadingPane'
import { Player } from '../components/Player'
import { PosterGrid } from '../components/PosterGrid'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { friendlyError } from '../lib/friendlyError'
import { DownloadCancelled, downloadFilename, downloadMedia, qualityFromLine, type DownloadGate } from '../lib/downloadMedia'
import { ensurePlayUrl } from '../lib/source'
import { historyOf, rememberPlay } from '../lib/storage'
import type { VideoItem } from '../lib/types'

export function PlayPage({ id, ep, onLibraryChange }: { id: string; ep: number; onLibraryChange: () => void }) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [playUrl, setPlayUrl] = useState('')
  const [readyKey, setReadyKey] = useState('')
  const [lineName, setLineName] = useState('')
  const [error, setError] = useState('')
  const [downloadPercent, setDownloadPercent] = useState<number | null>(null)
  const [downloadPaused, setDownloadPaused] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  const [pick, setPick] = useState<{ id: string; ep: number; path: string } | null>(null)
  const downloadAbort = useRef<AbortController | null>(null)
  const downloadGate = useRef<DownloadGate | null>(null)
  const savedAt = useRef(0)
  const advanced = useRef(false)
  const index = item && item.episodes.length ? Math.min(Math.max(ep, 0), item.episodes.length - 1) : Math.max(ep, 0)
  const episode = item?.episodes[index]
  const history = item ? historyOf(item.id) : undefined
  const resumeAt = history && history.ep === index ? history.time : 0
  const forced = pick && pick.id === id && pick.ep === index ? pick.path : ''
  const requestKey = `${id}:${index}:${forced}`
  const activeUrl = readyKey === requestKey ? playUrl : ''

  useEffect(() => {
    advanced.current = false
  }, [id, index])

  useEffect(() => {
    setDownloadError('')
    setDownloadPercent(null)
    setDownloadPaused(false)
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
    ensurePlayUrl(id, index, forced)
      .then((result) => {
        if (!live) return
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
    setDownloadPercent(0)
    const episodeName = item.episodes.length > 1 && episode.title !== item.title ? episode.title : ''
    const filename = downloadFilename(item.title, qualityFromLine(lineName), episodeName)
    downloadMedia({
      url: activeUrl,
      filename,
      signal: controller.signal,
      onGate: (gate) => {
        if (downloadAbort.current === controller) downloadGate.current = gate
      },
      onProgress: (percent) => {
        if (downloadAbort.current === controller) setDownloadPercent(percent)
      },
    })
      .then(() => {
        if (downloadAbort.current !== controller) return
        downloadAbort.current = null
        downloadGate.current = null
        setDownloadPaused(false)
        setDownloadPercent(null)
      })
      .catch((reason: unknown) => {
        if (downloadAbort.current !== controller) return
        downloadAbort.current = null
        downloadGate.current = null
        setDownloadPaused(false)
        setDownloadPercent(null)
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
            downloadLabel={downloadPercent === null ? '下载' : downloadPaused ? '继续下载' : '暂停'}
            downloadDisabled={downloadPercent === null && !activeUrl}
            onDownload={downloadPercent === null ? startDownload : toggleDownload}
            onTime={remember}
            onEnded={goNext}
          />
          <div className="play-copy">
            <h1>{item.title}</h1>
            <p className="meta">
              {channelName(item.channel)}
              {lineName ? ` · ${lineName}` : ''}
            </p>
            <div className="play-actions">
              {downloadPercent === null ? (
                <button type="button" className="btn" disabled={!activeUrl} onClick={startDownload}>
                  下载
                </button>
              ) : (
                <>
                  <span className="download-status">正在下载中，当前进度{downloadPercent}%</span>
                  <button type="button" className="btn" onClick={toggleDownload}>
                    {downloadPaused ? '继续下载' : '暂停'}
                  </button>
                </>
              )}
            </div>
            {downloadError ? <p className="note">{downloadError}</p> : null}
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
