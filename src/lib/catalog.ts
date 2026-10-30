import type { ChannelId, SortKey } from './types'

export const CHANNELS: { id: ChannelId; name: string; text: string }[] = [
  { id: 'movie', name: '电影', text: '精选好片，享受视觉盛宴' },
  { id: 'tv', name: '连续剧', text: '高人气好剧，越追越上头' },
  { id: 'anime', name: '动漫', text: '热血、治愈、脑洞大开，总有一部戳中你' },
  { id: 'variety', name: '综艺纪录', text: '爆笑综艺、真实纪录，轻松一刻马上开启' },
  { id: 'short', name: '短剧', text: '高能剧情，根本停不下来' },
]

export const CHARTS: { id: SortKey; title: string; desc: string }[] = [
  { id: 'hot', title: '爆款热播', desc: '高人气作品，越看越精彩' },
  { id: 'score', title: '高分推荐', desc: '好内容值得反复回味' },
  { id: 'new', title: '最新上线', desc: '新鲜内容，抢先一步发现' },
]

export const SHELVES: { id: string; title: string; text: string; channel: ChannelId }[] = [
  { id: 'lamp', title: '精品影视', text: '精选好内容，享受视觉盛宴', channel: 'movie' },
  { id: 'serial', title: '追剧时间', text: '一集接一集，越追越上头', channel: 'tv' },
  { id: 'draw', title: '二次元乐园', text: '热血、治愈、脑洞大开，总有一部戳中你', channel: 'anime' },
  { id: 'real', title: '综艺开心局', text: '爆笑综艺、真实纪录，轻松一刻马上开启', channel: 'variety' },
  { id: 'brief', title: '人气短剧', text: '高能剧情，根本停不下来', channel: 'short' },
]

export function isChannelId(value: string | undefined): value is ChannelId {
  return CHANNELS.some((item) => item.id === value)
}
