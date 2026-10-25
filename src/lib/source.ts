import { useEffect, useState } from 'react'
import { getVideo, setVideos, upsertVideo, videoCount } from './api'
import { loadDetail, loadHome, loadPlay, loadSearch } from './dusheClient'
import type { VideoItem } from './types'

let loading: Promise<void> | null = null

export function ensureLibrary(): Promise<void> {
  if (videoCount() > 0) return Promise.resolve()
  loading ??= loadHome()
    .then((data) => {
      setVideos(data.videos)
    })
    .catch((error: unknown) => {
      loading = null
      throw error
    })
  return loading
}

export async function ensureDetail(id: string): Promise<VideoItem> {
  const current = getVideo(id)
  const hasLines = current?.episodes.some((episode) => episode.lines && episode.lines.length > 0)
  if (current && current.episodes.length > 0 && hasLines) return current
  const item = await loadDetail(id)
  if (current) {
    item.hot = current.hot || item.hot
    item.featured = current.featured || item.featured
    if (!item.score && current.score) item.score = current.score
    if (!item.cover && current.cover) item.cover = current.cover
    if (!item.badge && current.badge) item.badge = current.badge
  }
  upsertVideo(item)
  return getVideo(id) ?? item
}

export async function ensurePlayUrl(id: string, ep: number, onlyPath = ''): Promise<{ url: string; line: string }> {
  const item = await ensureDetail(id)
  const episode = item.episodes[ep]
  if (!episode) throw new Error('没有这一集')
  const lines = (episode.lines?.length
    ? episode.lines
    : [{ label: episode.title, note: '', playPath: episode.playPath || '' }]
  ).filter((line) => line.playPath)
  const selected = onlyPath ? lines.filter((line) => line.playPath === onlyPath) : lines
  const use = selected.length ? selected : lines
  if (!use.length) throw new Error('没有播放地址')
  if (!onlyPath && episode.url) return { url: episode.url, line: episode.line || '' }
  const data = await loadPlay(use, Boolean(onlyPath))
  episode.url = data.url
  episode.line = data.line || ''
  return { url: data.url, line: episode.line }
}

export async function searchRemote(keyword: string): Promise<VideoItem[]> {
  const list = await loadSearch(keyword)
  for (const item of list) {
    if (!getVideo(item.id)) upsertVideo(item)
  }
  return list
}

export function useCatalog() {
  const [ready, setReady] = useState(videoCount() > 0)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    ensureLibrary()
      .then(() => {
        if (live) setReady(true)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '片库加载失败')
      })
    return () => {
      live = false
    }
  }, [])

  return { ready, error }
}
