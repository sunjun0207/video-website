import { CHANNELS, SHELVES } from './catalog'
import type { ChannelId, ChannelQuery, SortKey, VideoItem } from './types'

let videos: VideoItem[] = []

export function videoCount(): number {
  return videos.length
}

/**
 * 换上新抓到的片单。打开过详情的片子保留原对象，选集和已经探好的播放地址都还在；
 * 不在新片单里的（比如搜出来的）也留着，只是不再算热度和焦点。
 */
export function replaceCatalog(fresh: VideoItem[]): void {
  const known = new Map(videos.map((item) => [item.id, item]))
  const ids = new Set(fresh.map((item) => item.id))
  const next = fresh.map((item) => {
    const prev = known.get(item.id)
    if (!prev?.episodes.length) return item
    prev.hot = item.hot
    prev.featured = item.featured
    return prev
  })
  for (const item of videos) {
    if (ids.has(item.id)) continue
    item.hot = 0
    item.featured = false
    next.push(item)
  }
  videos = next
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
  return [...videos].sort(sorter('new'))
}

/** 热门推荐里每个频道最多这么多部，免得全是电影。 */
const HOT_PER_CHANNEL = 2

/** 首页从上到下：焦点图、热门推荐、各频道。上面放过的片子，下面不再出现。 */
export function homeShelves(size = 5) {
  const shown = new Set(heroVideos().map((item) => item.id))
  const perChannel = new Map<ChannelId, number>()
  const hot: VideoItem[] = []
  for (const item of rankVideos(videos.length)) {
    if (hot.length >= size) break
    const count = perChannel.get(item.channel) || 0
    if (shown.has(item.id) || count >= HOT_PER_CHANNEL) continue
    perChannel.set(item.channel, count + 1)
    hot.push(item)
  }
  for (const item of hot) shown.add(item.id)
  const channels = CHANNELS.map((channel) => ({
    ...channel,
    items: listByChannel(channel.id)
      .filter((item) => !shown.has(item.id))
      .slice(0, size),
  }))
  return { hot, channels }
}

export type SuggestHit = {
  title: string
  hint: string
}

export function suggestTitles(keyword: string, limit = 8): SuggestHit[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  const hits: SuggestHit[] = []
  for (const item of videos) {
    const haystack = [item.title, item.director, ...item.actors].join(' ').toLowerCase()
    if (!haystack.includes(q)) continue
    if (hits.some((hit) => hit.title === item.title)) continue
    hits.push({
      title: item.title,
      hint: [item.year || '', item.region].filter(Boolean).join(' · '),
    })
    if (hits.length >= limit) break
  }
  return hits
}

/** 片库里已有、片名或演职员对得上的片子。搜索结果回来之前先拿来垫着。 */
export function localMatches(keyword: string, limit = 12): VideoItem[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  return videos
    .filter((item) => [item.title, item.director, ...item.actors].join(' ').toLowerCase().includes(q))
    .sort((a, b) => b.hot - a.hot)
    .slice(0, limit)
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
  // 片库编号越大上架越晚。列表页不给年份，按年份排就和按热度排一样了。
  if (sort === 'new') return (a: VideoItem, b: VideoItem) => (Number(b.id) || 0) - (Number(a.id) || 0)
  if (sort === 'score') return (a: VideoItem, b: VideoItem) => b.score - a.score || b.hot - a.hot
  return (a: VideoItem, b: VideoItem) => b.hot - a.hot
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
