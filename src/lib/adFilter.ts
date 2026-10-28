/** 播放列表里的插播广告。播放和下载都先过这一层，下载时再按时间戳兜底。 */

const LONG_GROUP = 90
const SHORT_GROUP = 40
const AD_RUN_MAX = 60
const AD_ODD_MIN = 4
const MAX_SHARE = 0.15
const MAX_FLOOR = 90
const RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 50, 60000 / 1001, 60]
/** 整秒切片也算一种网格（帧率 1），放在最前面。 */
const GRIDS = [1, ...RATES]
/** 时长按 90kHz 时间戳取整，允许两个 tick 的误差。 */
const TICK = 2 / 90000
const AD_URI = /(?:^|\/)(?:ad|ads|adv|adjump|gg)(?:\/|\.|$)|广告/i
const PLAYLIST_TAGS =
  /^#(?:EXTM3U|EXT-X-(?:VERSION|TARGETDURATION|MEDIA-SEQUENCE|PLAYLIST-TYPE|INDEPENDENT-SEGMENTS|START|DISCONTINUITY-SEQUENCE|ALLOW-CACHE|I-FRAMES-ONLY|SERVER-CONTROL|PART-INF))\b/

type Segment = {
  tags: string[]
  uri: string
  duration: number
  slack: number
  sequence: number
  key: string
  group: number
  discontinuity: boolean
}

type Group = { segments: Segment[]; duration: number }

type Playlist = { head: string[]; segments: Segment[]; tail: string[]; ended: boolean }

function parse(text: string): Playlist {
  const head: string[] = []
  const segments: Segment[] = []
  let pending: string[] = []
  let sequenceBase = 0
  let duration = 0
  let slack = 1
  let key = ''
  let group = 0
  let discontinuity = false
  let ended = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (line === '#EXT-X-ENDLIST') {
      ended = true
      continue
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) sequenceBase = Number(line.split(':')[1]) || 0
    if (PLAYLIST_TAGS.test(line)) {
      head.push(line)
      continue
    }
    if (line.startsWith('#')) {
      pending.push(line)
      if (line === '#EXT-X-DISCONTINUITY') discontinuity = true
      else if (line.startsWith('#EXT-X-KEY:')) key = /METHOD=NONE/i.test(line) ? '' : line
      else if (line.startsWith('#EXTINF:')) {
        const value = line.slice(8).split(',')[0].trim()
        duration = Number(value) || 0
        const decimals = value.includes('.') ? value.length - value.indexOf('.') - 1 : 0
        slack = 1.5 * 10 ** -decimals
      }
      continue
    }
    if (discontinuity && segments.length) group += 1
    segments.push({
      tags: pending,
      uri: line,
      duration,
      slack,
      sequence: sequenceBase + segments.length,
      key,
      group,
      discontinuity,
    })
    pending = []
    duration = 0
    slack = 1
    discontinuity = false
  }
  return { head, segments, tail: pending, ended }
}

function fits(segment: Segment, rate: number): boolean {
  const frames = segment.duration * rate
  return Math.abs(frames - Math.round(frames)) <= (segment.slack + TICK) * rate
}

/** fine 的每一帧边界也是 coarse 的边界，比如 1 和 25、25 和 50。 */
function divides(coarse: number, fine: number): boolean {
  const ratio = fine / coarse
  return Math.abs(ratio - Math.round(ratio)) < 1e-9
}

function sum(segments: Segment[], pick: (segment: Segment) => boolean = () => true): number {
  return segments.reduce((total, segment) => (pick(segment) ? total + segment.duration : total), 0)
}

/** 正片的时长网格。片段时长是整帧数，广告往往是另一种帧率；正片按整秒切时以整秒为准。 */
function mainGrid(segments: Segment[], total: number): number {
  if (segments.filter((segment) => segment.slack < 0.002).length < segments.length * 0.8) return 0
  const covered = (rate: number) => sum(segments, (segment) => fits(segment, rate))
  let best = RATES[0]
  let bestDuration = covered(best)
  for (const rate of RATES) {
    const duration = covered(rate)
    if (duration > bestDuration + 1e-6) {
      best = rate
      bestDuration = duration
    }
  }
  if (bestDuration < total * 0.7) return 0
  return GRIDS.find((rate) => divides(rate, best) && covered(rate) >= bestDuration - total * 0.05) ?? best
}

type Kind = 'main' | 'ad' | 'neutral'

/** 相对正片网格和某个广告帧率，看这一组更像哪边。两边都对得上的片段：正片网格更粗时算正片，否则不作数。 */
function kindOf(group: Group, grid: number, rate: number, last: Segment): Kind {
  const strong = divides(grid, rate)
  let ad = false
  for (const segment of group.segments) {
    if (segment === last) continue
    const inGrid = fits(segment, grid)
    const inRate = fits(segment, rate)
    if (inRate && !inGrid) ad = true
    else if (!inRate || strong) return 'main'
  }
  return ad ? 'ad' : 'neutral'
}

function groupsOf(segments: Segment[]): Group[] {
  const groups: Group[] = []
  for (const segment of segments) {
    const last = groups[groups.length - 1]
    if (last && last.segments[0].group === segment.group) {
      last.segments.push(segment)
      last.duration += segment.duration
    } else groups.push({ segments: [segment], duration: segment.duration })
  }
  return groups
}

function runs(groups: Group[], match: (index: number) => boolean): number[][] {
  const found: number[][] = []
  let current: number[] = []
  groups.forEach((_, index) => {
    if (match(index)) current.push(index)
    else if (current.length) {
      found.push(current)
      current = []
    }
  })
  if (current.length) found.push(current)
  return found
}

function runDuration(groups: Group[], run: number[]): number {
  return run.reduce((total, index) => total + groups[index].duration, 0)
}

function contains(haystack: string[], needle: string[]): boolean {
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((value, offset) => haystack[start + offset] === value)) return true
  }
  return false
}

/**
 * 单独编码的插播：整组只有另一种帧率的证据。
 * 紧挨着的两可组（两种帧率都对得上）只有在同一段广告别处也连着它出现时才算进去。
 */
function gridAds(groups: Group[], segments: Segment[], total: number): number[][] {
  const grid = mainGrid(segments, total)
  if (!grid) return []
  const last = segments[segments.length - 1]
  const durations = (indices: number[]) =>
    indices.flatMap((index) => groups[index].segments.map((segment) => segment.duration.toFixed(3)))
  const found: number[][] = []
  for (const rate of RATES) {
    if (divides(rate, grid)) continue
    const kinds = groups.map((group) => kindOf(group, grid, rate, last))
    const neutral = (index: number) => (kinds[index] === 'neutral' ? [index] : [])
    const cores = runs(groups, (index) => kinds[index] === 'ad').filter((run) => {
      const odd = run.flatMap((index) => groups[index].segments).filter((segment) => segment !== last && !fits(segment, grid))
      if (sum(odd) < AD_ODD_MIN) return false
      return !RATES.some(
        (other) => other < rate && divides(other, rate) && !divides(other, grid) && odd.every((segment) => fits(segment, other)),
      )
    })
    const spans = cores.map((run) => durations([...neutral(run[0] - 1), ...run, ...neutral(run[run.length - 1] + 1)]))
    cores.forEach((run, at) => {
      const elsewhere = (indices: number[]) => {
        const needle = durations(indices)
        return spans.some((span, other) => other !== at && contains(span, needle))
      }
      const before = neutral(run[0] - 1)
      const after = neutral(run[run.length - 1] + 1)
      const full = [
        ...(before.length && elsewhere([...before, ...run]) ? before : []),
        ...run,
        ...(after.length && elsewhere([...run, ...after]) ? after : []),
      ]
      if (runDuration(groups, full) <= AD_RUN_MAX) found.push(full)
      else if (runDuration(groups, run) <= AD_RUN_MAX) found.push(run)
    })
  }
  return found
}

function adGroups(groups: Group[], segments: Segment[], total: number): Set<number> {
  const flagged = new Set<number>()
  const flag = (run: number[]) => run.forEach((index) => flagged.add(index))

  gridAds(groups, segments, total).forEach(flag)

  const isLong = (index: number) => (groups[index]?.duration ?? 0) >= LONG_GROUP
  const longDuration = groups.reduce((acc, group) => (group.duration >= LONG_GROUP ? acc + group.duration : acc), 0)
  if (longDuration >= total * 0.85) {
    for (const run of runs(groups, (index) => groups[index].duration > 0 && groups[index].duration <= SHORT_GROUP)) {
      const before = run[0] - 1
      const after = run[run.length - 1] + 1
      if (runDuration(groups, run) <= AD_RUN_MAX && (isLong(before) || isLong(after))) flag(run)
    }
  }

  for (const run of runs(groups, (index) => groups[index].segments.some((segment) => AD_URI.test(segment.uri)))) {
    if (runDuration(groups, run) <= AD_RUN_MAX) flag(run)
  }
  return flagged
}

function withIv(keyLine: string, sequence: number): string {
  return `${keyLine},IV=0x${sequence.toString(16).padStart(32, '0')}`
}

function serialize(playlist: Playlist, drop: Set<Segment>): string {
  const out = [...playlist.head]
  let carry: string[] = []
  let discontinuity = false
  let removed = false
  for (const segment of playlist.segments) {
    if (drop.has(segment)) {
      removed = true
      if (segment.discontinuity) discontinuity = true
      carry.push(...segment.tags.filter((line) => line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-MAP:')))
      continue
    }
    if (discontinuity || segment.discontinuity) out.push('#EXT-X-DISCONTINUITY')
    out.push(...carry, ...segment.tags.filter((line) => line !== '#EXT-X-DISCONTINUITY'))
    if (removed && segment.key && !/IV=/i.test(segment.key)) out.push(withIv(segment.key, segment.sequence))
    out.push(segment.uri)
    carry = []
    discontinuity = false
  }
  out.push(...playlist.tail)
  if (playlist.ended) out.push('#EXT-X-ENDLIST')
  return out.join('\n')
}

/** 去掉插播广告：帧率和正片不同的碎片、长正片之间的短插段、地址像广告的段落。删得过多时原样返回。 */
export function stripAdBreaks(text: string): string {
  if (!text.includes('#EXTINF')) return text
  const playlist = parse(text)
  const segments = playlist.segments
  const total = sum(segments)
  if (segments.length < 2 || total <= 0) return text
  const groups = groupsOf(segments)
  const flagged = adGroups(groups, segments, total)
  if (!flagged.size) return text
  const removed = [...flagged].reduce((acc, index) => acc + groups[index].duration, 0)
  if (removed > Math.max(total * MAX_SHARE, MAX_FLOOR)) return text
  const drop = new Set([...flagged].flatMap((index) => groups[index].segments))
  return serialize(playlist, drop)
}
