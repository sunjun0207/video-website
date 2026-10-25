import { CHANNELS, SHELVES } from './catalog'
import type { ChannelId, ChannelQuery, SortKey, VideoItem } from './types'

let videos: VideoItem[] = []

export function videoCount(): number {
  return videos.length
}

export function setVideos(list: VideoItem[]): void {
  videos = list
}

export function upsertVideo(item: VideoItem): void {
  const index = videos.findIndex((video) => video.id === item.id)
  if (index >= 0) videos[index] = item
  else videos = [item, ...videos]
}

export function channelName(id: ChannelId): string {
  return CHANNELS.find((item) => item.id === id)?.name ?? id
}

export function getVideo(id: string): VideoItem | undefined {
  return videos.find((item) => item.id === id)
}

export function heroVideos(): VideoItem[] {
  const picked = videos.filter((item) => item.featured)
  return (picked.length ? picked : videos).slice(0, 5)
}

export function rankVideos(limit = 10, sort: SortKey = 'hot'): VideoItem[] {
  return [...videos].sort(sorter(sort)).slice(0, limit)
}

export function listByChannel(channel: ChannelId): VideoItem[] {
  return videos.filter((item) => item.channel === channel).sort((a, b) => b.hot - a.hot)
}

export function shelfVideos(id: string): VideoItem[] {
  const shelf = SHELVES.find((item) => item.id === id)
  if (!shelf) return []
  return listByChannel(shelf.channel)
}

export function freshVideos(): VideoItem[] {
  return [...videos].sort((a, b) => b.year - a.year || b.hot - a.hot)
}

export function suggestTitles(keyword: string, limit = 8): string[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  const titles: string[] = []
  for (const item of videos) {
    const haystack = [item.title, item.director, ...item.actors].join(' ').toLowerCase()
    if (!haystack.includes(q)) continue
    if (!titles.includes(item.title)) titles.push(item.title)
    if (titles.length >= limit) break
  }
  return titles
}

export function hotVideos(limit = 10): VideoItem[] {
  return rankVideos(limit)
}

export function relatedVideos(id: string, limit = 6): VideoItem[] {
  const current = getVideo(id)
  if (!current) return rankVideos(limit)
  const same = videos.filter((item) => item.id !== id && item.channel === current.channel)
  const rest = videos.filter((item) => item.id !== id && item.channel !== current.channel)
  return [...same, ...rest].slice(0, limit)
}

export function channelFacets(channel: ChannelId) {
  const list = videos.filter((item) => item.channel === channel)
  const genres = unique(list.flatMap((item) => item.genres))
  const regions = unique(list.map((item) => item.region).filter(Boolean))
  const years = unique(list.map((item) => String(item.year)).filter((item) => item !== '0')).sort(
    (a, b) => Number(b) - Number(a),
  )
  return { genres, regions, years }
}

export function queryChannel(query: ChannelQuery): VideoItem[] {
  let list = videos.filter((item) => item.channel === query.channel)
  if (query.genre !== '全部') list = list.filter((item) => item.genres.includes(query.genre))
  if (query.region !== '全部') list = list.filter((item) => item.region === query.region)
  if (query.year !== '全部') list = list.filter((item) => String(item.year) === query.year)
  list.sort(sorter(query.sort))
  return list
}

export function metaLine(item: VideoItem): string {
  return [item.year || '', item.region, channelName(item.channel)].filter(Boolean).join(' · ')
}

function sorter(sort: SortKey) {
  if (sort === 'new') return (a: VideoItem, b: VideoItem) => b.year - a.year || b.hot - a.hot
  if (sort === 'score') return (a: VideoItem, b: VideoItem) => b.score - a.score || b.hot - a.hot
  return (a: VideoItem, b: VideoItem) => b.hot - a.hot
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
