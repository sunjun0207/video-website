import type Hls from 'hls.js'
import type { InitPTSFoundData } from 'hls.js'

/** 一段插播最长这么久；时间线在这之内接不回去的，不当广告。 */
const AD_SPAN = 60
/** 播放列表里标的时长和片段里的时间戳之间允许的误差（秒）。 */
const SLACK = 1.5
/** 跳过广告时落在正片开头稍后一点，免得停在两段之间的缝上。 */
const LAND = 0.05
/** 单独编码的片子从头计时，第一帧的时间戳在这么多秒以内。 */
const RESTART = 10

type Group = { cc: number; start: number }

function wrapped(value: number, wrap: number) {
  return ((value % wrap) + wrap) % wrap
}

function signed(diff: number, wrap: number) {
  const value = wrapped(diff, wrap)
  return value > wrap / 2 ? value - wrap : value
}

export type AdSkipper = {
  found: (data: InitPTSFoundData) => void
  stop: () => void
}

/**
 * 播放列表里认不出来的插播（帧率和正片一样，或者正片本身就切得很碎）：正片的时间戳在广告前后是接着走的，广告自己从头计时。
 * hls.js 每解析到一个新分段就报一次时间基准（片段时间戳减去它在播放列表里的位置）。正片各段的基准相同；
 * 广告那几段的基准跳开，紧随其后的正片又回到原来的基准、正好少了广告那么长，这几段就是广告，播到时直接跳过。
 * 接在片尾的广告后面没有正片可对照，只认从头计时、而前面的正片时间戳已经走了很久的那种，播到时直接跳到结尾。
 */
export function createAdSkipper(video: HTMLVideoElement, owner: () => Hls | undefined): AdSkipper {
  const anchors = new Map<number, number>()
  let ranges: [number, number][] = []
  let timer = 0

  const layoutOf = (level: number) => {
    const groups: Group[] = []
    let end = 0
    for (const fragment of owner()?.levels[level]?.details?.fragments ?? []) {
      if (groups[groups.length - 1]?.cc !== fragment.cc) groups.push({ cc: fragment.cc, start: fragment.start })
      end = fragment.start + fragment.duration
    }
    return { groups, end }
  }

  const detect = (groups: Group[], end: number, wrap: number) => {
    const found: [number, number][] = []
    let resumed = 0
    for (let x = 0; x + 2 < groups.length; x += 1) {
      const base = anchors.get(groups[x].cc)
      const first = groups[x + 1]
      const jump = anchors.get(first.cc)
      if (base === undefined || jump === undefined || Math.abs(signed(jump - base, wrap)) <= SLACK) continue
      for (let z = x + 2; z < groups.length && groups[z].start - first.start <= AD_SPAN; z += 1) {
        const anchor = anchors.get(groups[z].cc)
        if (anchor === undefined) break
        if (Math.abs(signed(anchor - base, wrap) + (groups[z].start - first.start)) > SLACK) continue
        found.push([first.start, groups[z].start])
        resumed = z
        x = z - 1
        break
      }
    }
    const clockOf = (group: Group) => {
      const anchor = anchors.get(group.cc)
      return anchor === undefined ? undefined : wrapped(anchor + group.start, wrap)
    }
    for (let k = resumed + 1; k < groups.length; k += 1) {
      if (end - groups[k].start > AD_SPAN) continue
      const before = clockOf(groups[k - 1])
      const after = clockOf(groups[k])
      if (before === undefined || after === undefined || before < RESTART || after >= RESTART) continue
      if (groups.slice(k + 1).every((group) => anchors.has(group.cc))) found.push([groups[k].start, end])
      break
    }
    return found
  }

  const check = () => {
    window.clearTimeout(timer)
    if (!ranges.length || video.seeking) return
    const now = video.currentTime
    const inside = ranges.find(([start, end]) => now >= start - LAND && now < end)
    if (inside) {
      const target = Math.min(inside[1] + LAND, video.duration || Infinity)
      if (target > now) video.currentTime = target
      return
    }
    if (video.paused) return
    const next = ranges.find(([start]) => start > now)
    if (next && next[0] - now < 1) timer = window.setTimeout(check, ((next[0] - now) / (video.playbackRate || 1)) * 1000)
  }

  video.addEventListener('timeupdate', check)
  video.addEventListener('seeked', check)
  video.addEventListener('play', check)

  return {
    found: ({ id, frag, initPTS, timescale }) => {
      if (String(id) !== 'main' || !timescale) return
      anchors.set(frag.cc, initPTS / timescale)
      const { groups, end } = layoutOf(frag.level)
      ranges = detect(groups, end, 2 ** 33 / timescale)
      check()
    },
    stop: () => {
      window.clearTimeout(timer)
      video.removeEventListener('timeupdate', check)
      video.removeEventListener('seeked', check)
      video.removeEventListener('play', check)
    },
  }
}
