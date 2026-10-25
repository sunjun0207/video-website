import type { ChannelId, VideoItem } from './types'

const KEYS = {
  searchHistory: 'video_website_search_history',
  favorites: 'video_website_favorites',
  history: 'video_website_history',
} as const

export type ShelfRecord = {
  id: string
  title: string
  cover: string
  channel: ChannelId
  score: number
  at: number
}

export type WatchRecord = ShelfRecord & {
  ep: number
  time: number
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function snapshot(item: VideoItem): ShelfRecord {
  return {
    id: item.id,
    title: item.title,
    cover: item.cover || '',
    channel: item.channel,
    score: item.score || 0,
    at: Date.now(),
  }
}

export function getSearchHistory(): string[] {
  return readJson<string[]>(KEYS.searchHistory, [])
}

export function addSearchHistory(keyword: string) {
  const text = keyword.trim()
  if (!text) return
  const list = getSearchHistory().filter((item) => item !== text)
  list.unshift(text)
  writeJson(KEYS.searchHistory, list.slice(0, 12))
}

export function clearSearchHistory() {
  writeJson(KEYS.searchHistory, [])
}

export function getFavorites(): ShelfRecord[] {
  return readJson<ShelfRecord[]>(KEYS.favorites, [])
}

export function isFavorite(id: string): boolean {
  return getFavorites().some((item) => item.id === id)
}

export function toggleFavorite(item: VideoItem): boolean {
  const list = getFavorites()
  const exists = list.some((entry) => entry.id === item.id)
  const next = exists ? list.filter((entry) => entry.id !== item.id) : [snapshot(item), ...list]
  writeJson(KEYS.favorites, next.slice(0, 100))
  return !exists
}

export function getHistory(): WatchRecord[] {
  return readJson<WatchRecord[]>(KEYS.history, [])
}

export function historyOf(id: string): WatchRecord | undefined {
  return getHistory().find((item) => item.id === id)
}

export function rememberPlay(item: VideoItem, ep: number, time: number) {
  const list = getHistory().filter((entry) => entry.id !== item.id)
  list.unshift({
    ...snapshot(item),
    ep,
    time: Number.isFinite(time) ? time : 0,
  })
  writeJson(KEYS.history, list.slice(0, 50))
}

export function clearHistory() {
  writeJson(KEYS.history, [])
}
