import { useEffect, useState } from 'react'
import { getVideo, replaceCatalog, upsertVideo } from './api'
import { dropLine, loadDetail, loadHome, loadPlay, loadSearch, type PlayChoice } from './dusheClient'
import { friendlyError } from './friendlyError'
import type { VideoItem } from './types'

const CATALOG_KEY = 'video_website_catalog'
/** 存在这台浏览器里的片单，这么久以内打开页面就先拿它显示。 */
const CATALOG_KEEP = 3 * 24 * 60 * 60 * 1000
/** 片单这么久以内不再去片库刷新。 */
const CATALOG_FRESH = 5 * 60 * 1000

let catalogAt = restoreCatalog()
let refreshing: Promise<void> | null = null
const listeners = new Set<() => void>()
const detailInflight = new Map<string, Promise<VideoItem>>()
const playInflight = new Map<string, Promise<PlayChoice>>()

function restoreCatalog(): number {
  try {
    const raw = localStorage.getItem(CATALOG_KEY)
    if (!raw) return 0
    const saved = JSON.parse(raw) as { at?: number; videos?: VideoItem[] }
    if (!saved.at || !Array.isArray(saved.videos) || !saved.videos.length) return 0
    if (Date.now() - saved.at > CATALOG_KEEP) return 0
    replaceCatalog(saved.videos)
    return saved.at
  } catch {
    return 0
  }
}

function saveCatalog(videos: VideoItem[]) {
  try {
    localStorage.setItem(CATALOG_KEY, JSON.stringify({ at: Date.now(), videos: videos.map((item) => ({ ...item, episodes: [] })) }))
  } catch {
    /* 存不下，下次打开再从片库拉 */
  }
}

function changed() {
  listeners.forEach((listener) => listener())
}

/** 片单换过一次就通知一次，页面据此重画。 */
export function onCatalogChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function catalogReady(): boolean {
  return catalogAt > 0
}

/** 还没有片单时，首页和频道页回来一页显示一页；已经有了就整份拉完再换，免得页面跳好几次。 */
function refreshCatalog(): Promise<void> {
  refreshing ??= new Promise<void>((resolve, reject) => {
    const shown = catalogAt > 0
    loadHome((videos) => {
      if (shown) return
      replaceCatalog(videos)
      catalogAt = Date.now()
      changed()
      resolve()
    })
      .then((videos) => {
        if (shown) {
          replaceCatalog(videos)
          catalogAt = Date.now()
          changed()
        }
        saveCatalog(videos)
        resolve()
      })
      .catch(reject)
      .finally(() => {
        refreshing = null
      })
  })
  return refreshing
}

export function ensureLibrary(): Promise<void> {
  if (!catalogAt) return refreshCatalog()
  if (Date.now() - catalogAt > CATALOG_FRESH) void refreshCatalog().catch(() => undefined)
  return Promise.resolve()
}

export function ensureDetail(id: string): Promise<VideoItem> {
  const current = getVideo(id)
  const hasLines = current?.episodes.some((episode) => episode.lines && episode.lines.length > 0)
  if (current && current.episodes.length > 0 && hasLines) return Promise.resolve(current)
  let task = detailInflight.get(id)
  if (!task) {
    task = loadDetail(id)
      .then((item) => {
        const known = getVideo(id)
        if (known) {
          item.hot = known.hot || item.hot
          item.featured = known.featured || item.featured
          if (!item.score && known.score) item.score = known.score
          if (!item.cover && known.cover) item.cover = known.cover
          if (!item.badge && known.badge) item.badge = known.badge
        }
        upsertVideo(item)
        return getVideo(id) ?? item
      })
      .finally(() => {
        detailInflight.delete(id)
      })
    detailInflight.set(id, task)
  }
  return task
}

/** 详情页预取还没探完就点了播放，接着等同一次，不再重新探一遍线路。skip：开播时连不上、这次不再挑的线路。 */
export function ensurePlayUrl(id: string, ep: number, onlyPath = '', skip: string[] = []): Promise<PlayChoice> {
  const key = `${id}:${ep}:${onlyPath}:${skip.join('|')}`
  let task = playInflight.get(key)
  if (!task) {
    task = resolvePlayUrl(id, ep, onlyPath, skip).finally(() => {
      playInflight.delete(key)
    })
    playInflight.set(key, task)
  }
  return task
}

async function resolvePlayUrl(id: string, ep: number, onlyPath: string, skip: string[]): Promise<PlayChoice> {
  const item = await ensureDetail(id)
  const episode = item.episodes[ep]
  if (!episode) throw new Error('没有这一集')
  const lines = (episode.lines?.length
    ? episode.lines
    : [{ label: episode.title, note: '', playPath: episode.playPath || '' }]
  ).filter((line) => line.playPath)
  const selected = onlyPath
    ? lines.filter((line) => line.playPath === onlyPath)
    : lines.filter((line) => !skip.includes(line.playPath))
  const use = selected.length ? selected : lines
  if (!use.length) throw new Error('没有播放地址')
  // 不在这里长期记住地址：有的片源地址带签名，过一阵就只回“OK”不回画面。loadPlay 只记几分钟。
  return loadPlay(use, Boolean(onlyPath))
}

/** 这一集挑中的线路开播时连不上，下次不再先挑它，也不挑给出同一个地址 url 的线路。 */
export function dropPlayLine(id: string, ep: number, playPath: string, url: string): void {
  const line = getVideo(id)?.episodes[ep]?.lines?.find((entry) => entry.playPath === playPath)
  dropLine(line ?? { label: '', note: '', playPath }, url)
}

/** 鼠标停在海报上、或手指按下时先把详情拉回来，点进去就不用再等。 */
export function prefetchDetail(id: string): void {
  void ensureDetail(id).catch(() => undefined)
}

/** 详情页一打开就先把要播的那一集探好，点“开始观看”时直接开播。 */
export function prefetchPlay(id: string, ep: number): void {
  void ensurePlayUrl(id, ep).catch(() => undefined)
}

const searchCache = new Map<string, { at: number; list: VideoItem[] }>()
const searchInflight = new Map<string, Promise<VideoItem[]>>()

export function cachedSearch(keyword: string): VideoItem[] | undefined {
  return searchCache.get(keyword.trim())?.list
}

export async function searchRemote(keyword: string): Promise<VideoItem[]> {
  const q = keyword.trim()
  if (!q) return []
  const hit = searchCache.get(q)
  if (hit && Date.now() - hit.at < 20_000) return hit.list
  const pending = searchInflight.get(q)
  if (pending) return pending
  const task = loadSearch(q)
    .then((list) => {
      for (const item of list) {
        if (!getVideo(item.id)) upsertVideo(item)
      }
      searchCache.set(q, { at: Date.now(), list })
      return list
    })
    .finally(() => {
      searchInflight.delete(q)
    })
  searchInflight.set(q, task)
  return task
}

export function useCatalog() {
  const [ready, setReady] = useState(catalogReady)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    ensureLibrary()
      .then(() => {
        if (live) setReady(true)
      })
      .catch((reason: unknown) => {
        if (live) setError(friendlyError(reason, '片库这会儿没有连上。'))
      })
    return () => {
      live = false
    }
  }, [])

  return { ready, error }
}
