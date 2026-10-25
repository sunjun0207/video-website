import type { ChannelId, SortKey } from './types'

export const CHANNELS: { id: ChannelId; name: string; text: string }[] = [
  { id: 'movie', name: '电影', text: '把灯调暗，一部看完。' },
  { id: 'tv', name: '连续剧', text: '一集连着一集，故事还没说完。' },
  { id: 'anime', name: '动漫', text: '线条、颜色，和还没长大的心。' },
  { id: 'variety', name: '综艺纪录', text: '把真实的生活放近一点。' },
  { id: 'short', name: '短剧', text: '短短一段，也能把故事看完。' },
]

export const CHARTS: { id: SortKey; title: string; desc: string }[] = [
  { id: 'hot', title: '热播', desc: '按此刻热度排下来，方便先看大家都在看的。' },
  { id: 'score', title: '高分', desc: '分数更高的那些，适合慢慢看。' },
  { id: 'new', title: '新片', desc: '年份更近的故事，刚被放上片单。' },
]

export const SHELVES: { id: string; title: string; text: string; channel: ChannelId }[] = [
  { id: 'lamp', title: '灯下电影', text: '适合把灯调暗再开始的长片。', channel: 'movie' },
  { id: 'serial', title: '接着看下去', text: '一集连着一集，故事还没说完。', channel: 'tv' },
  { id: 'draw', title: '画出来的世界', text: '线条、颜色，和还没长大的心。', channel: 'anime' },
  { id: 'real', title: '真实的片刻', text: '综艺和纪录，把生活放近一点。', channel: 'variety' },
  { id: 'brief', title: '短短的一段', text: '几分钟也能把一个故事看完。', channel: 'short' },
]

export function isChannelId(value: string | undefined): value is ChannelId {
  return CHANNELS.some((item) => item.id === value)
}
