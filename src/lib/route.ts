import { useEffect, useState } from 'react'
import { isChannelId } from './catalog'
import type { SortKey } from './types'

export type RouteName =
  | 'discover'
  | 'toplist'
  | 'lists'
  | 'list'
  | 'channels'
  | 'channel'
  | 'fresh'
  | 'detail'
  | 'play'
  | 'search'
  | 'favorites'
  | 'guide'
  | 'about'
  | 'notfound'

export type Route = {
  name: RouteName
  id?: string
  ep: number
  q: string
  genre: string
  region: string
  year: string
  sort: SortKey
  key: string
}

const KNOWN = new Set<RouteName>([
  'discover',
  'toplist',
  'lists',
  'list',
  'channels',
  'channel',
  'fresh',
  'detail',
  'play',
  'search',
  'favorites',
  'guide',
  'about',
])

const NEEDS_ID = new Set<RouteName>(['list', 'channel', 'detail', 'play'])

function decodePart(part: string) {
  try {
    return decodeURIComponent(part)
  } catch {
    return part
  }
}

function parseSort(value: string | null): SortKey {
  if (value === 'new' || value === 'score' || value === 'hot') return value
  return 'hot'
}

function parseEp(value: string | undefined) {
  const ep = Number(value)
  if (!Number.isInteger(ep) || ep < 0) return 0
  return ep
}

export function searchHash(q: string) {
  const keyword = q.trim()
  return keyword ? `#/search?q=${encodeURIComponent(keyword)}` : '#/search'
}

export function channelHash(
  id: string,
  query: { genre?: string; region?: string; year?: string; sort?: SortKey } = {},
) {
  const params = new URLSearchParams()
  if (query.genre && query.genre !== '全部') params.set('genre', query.genre)
  if (query.region && query.region !== '全部') params.set('region', query.region)
  if (query.year && query.year !== '全部') params.set('year', query.year)
  if (query.sort && query.sort !== 'hot') params.set('sort', query.sort)
  const qs = params.toString()
  return qs ? `#/channel/${id}?${qs}` : `#/channel/${id}`
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/discover'
  const qIndex = raw.indexOf('?')
  const path = qIndex >= 0 ? raw.slice(0, qIndex) : raw
  const query = qIndex >= 0 ? raw.slice(qIndex + 1) : ''
  const params = new URLSearchParams(query)
  const parts = path.split('/').filter(Boolean).map(decodePart)
  const head = (parts[0] || 'discover') as RouteName
  const id = parts[1]
  const ep = head === 'play' ? parseEp(parts[2]) : 0
  const q = params.get('q') ?? ''
  const genre = params.get('genre') || '全部'
  const region = params.get('region') || '全部'
  const year = params.get('year') || '全部'
  const sort = parseSort(params.get('sort'))
  const key = `${head}/${id ?? ''}/${ep}?q=${q}&genre=${genre}&region=${region}&year=${year}&sort=${sort}`
  const blank = { q, genre, region, year, sort, ep, key }
  if (!KNOWN.has(head)) return { name: 'notfound', ...blank }
  if (NEEDS_ID.has(head) && !id) return { name: 'notfound', ...blank }
  if (head === 'channel' && !isChannelId(id)) return { name: 'notfound', ...blank }
  return { name: head, id, ...blank }
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseHash(window.location.hash))

  useEffect(() => {
    const sync = () => setRoute(parseHash(window.location.hash))
    window.addEventListener('hashchange', sync)
    if (!window.location.hash) window.location.replace('#/discover')
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  return route
}
