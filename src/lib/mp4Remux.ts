import type { AacConfig, AudioFrame, AvcConfig, Demuxed, VideoSample } from './tsDemux'

/** 把 TS 样本写成普通（非分片）MP4：时间轴从 0 开始连续，moov 写在末尾，带关键帧索引。 */

const TICKS = 90000
const MOVIE_SCALE = 1000
const AAC_FRAME = 1024
const CHUNK_SECONDS = 1
/** 前后 DTS 相差在这之内算同一条时间轴，否则接到上一帧后面。 */
const CONTINUOUS = TICKS
const FRAME_MAX = TICKS / 4
/** 时间戳离开正片（跳走或倒回）、之后正片又从原处接着播：中间这段是插播广告或重复的片段。 */
const AD_SPAN = 60 * TICKS
const RESUME_EARLY = TICKS
const RESUME_LATE = 30 * TICKS
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]

export type Mp4Sink = { write: (data: Uint8Array, position?: number) => Promise<void> }

type Chunk = { offset: number; count: number }

type Piece = { video: VideoSample[]; audio: AudioFrame[]; start: number; end: number }

type Item = { time: number; data: Uint8Array }

function byteWriter() {
  let buffer = new Uint8Array(1 << 16)
  let view = new DataView(buffer.buffer)
  let length = 0
  const room = (size: number) => {
    if (length + size <= buffer.length) return
    let next = buffer.length * 2
    while (next < length + size) next *= 2
    const grown = new Uint8Array(next)
    grown.set(buffer.subarray(0, length))
    buffer = grown
    view = new DataView(buffer.buffer)
  }
  const out = {
    u8(value: number) {
      room(1)
      view.setUint8(length, value)
      length += 1
    },
    u16(value: number) {
      room(2)
      view.setUint16(length, value)
      length += 2
    },
    u32(value: number) {
      room(4)
      view.setUint32(length, value >>> 0)
      length += 4
    },
    u64(value: number) {
      out.u32(Math.floor(value / 2 ** 32))
      out.u32(value % 2 ** 32)
    },
    bytes(data: Uint8Array) {
      room(data.length)
      buffer.set(data, length)
      length += data.length
    },
    zeros(count: number) {
      room(count)
      buffer.fill(0, length, length + count)
      length += count
    },
    text(value: string) {
      for (let index = 0; index < value.length; index += 1) out.u8(value.charCodeAt(index))
    },
    box(type: string, body: () => void) {
      const start = length
      out.u32(0)
      out.text(type)
      body()
      view.setUint32(start, length - start)
    },
    full(type: string, version: number, flags: number, body: () => void) {
      out.box(type, () => {
        out.u32(version * 2 ** 24 + flags)
        body()
      })
    },
    done: () => buffer.slice(0, length),
  }
  return out
}

type Out = ReturnType<typeof byteWriter>

function sum(values: number[]): number {
  let total = 0
  for (const value of values) total += value
  return total
}

function runs(values: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const value of values) {
    const last = out[out.length - 1]
    if (last && last[1] === value) last[0] += 1
    else out.push([1, value])
  }
  return out
}

function mostCommon<T>(counts: Map<T, number>): T | null {
  let best: T | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function toMovie(duration: number, scale: number): number {
  return Math.round((duration * MOVIE_SCALE) / scale)
}

function ftyp(): Uint8Array {
  const out = byteWriter()
  out.box('ftyp', () => {
    out.text('isom')
    out.u32(512)
    for (const brand of ['isom', 'iso2', 'avc1', 'mp41']) out.text(brand)
  })
  return out.done()
}

function mdatHeader(size: number): Uint8Array {
  const out = byteWriter()
  out.u32(1)
  out.text('mdat')
  out.u64(size)
  return out.done()
}

function tkhd(out: Out, id: number, duration: number, width: number, height: number, volume: number) {
  out.full('tkhd', 0, 3, () => {
    out.u32(0)
    out.u32(0)
    out.u32(id)
    out.u32(0)
    out.u32(duration)
    out.zeros(8)
    out.u16(0)
    out.u16(0)
    out.u16(volume)
    out.u16(0)
    MATRIX.forEach((value) => out.u32(value))
    out.u32(width * 65536)
    out.u32(height * 65536)
  })
}

function edts(out: Out, edits: [number, number][]) {
  out.box('edts', () =>
    out.full('elst', 0, 0, () => {
      out.u32(edits.length)
      for (const [duration, time] of edits) {
        out.u32(duration)
        out.u32(time)
        out.u16(1)
        out.u16(0)
      }
    }),
  )
}

function mdhd(out: Out, scale: number, duration: number) {
  const wide = duration >= 2 ** 32
  out.full('mdhd', wide ? 1 : 0, 0, () => {
    if (wide) {
      out.u64(0)
      out.u64(0)
      out.u32(scale)
      out.u64(duration)
    } else {
      out.u32(0)
      out.u32(0)
      out.u32(scale)
      out.u32(duration)
    }
    out.u16(0x55c4)
    out.u16(0)
  })
}

function hdlr(out: Out, type: string, name: string) {
  out.full('hdlr', 0, 0, () => {
    out.u32(0)
    out.text(type)
    out.zeros(12)
    out.text(name)
    out.u8(0)
  })
}

function dinf(out: Out) {
  out.box('dinf', () =>
    out.full('dref', 0, 0, () => {
      out.u32(1)
      out.full('url ', 0, 1, () => undefined)
    }),
  )
}

function table(out: Out, type: string, entries: [number, number][]) {
  out.full(type, 0, 0, () => {
    out.u32(entries.length)
    for (const [count, value] of entries) {
      out.u32(count)
      out.u32(value)
    }
  })
}

function sampleTables(out: Out, entry: () => void, track: { sizes: number[]; durations: number[]; chunks: Chunk[] }, extra: () => void) {
  out.box('stbl', () => {
    out.full('stsd', 0, 0, () => {
      out.u32(1)
      entry()
    })
    table(out, 'stts', runs(track.durations))
    extra()
    const firsts: [number, number][] = []
    track.chunks.forEach((chunk, index) => {
      if (firsts[firsts.length - 1]?.[1] !== chunk.count) firsts.push([index + 1, chunk.count])
    })
    out.full('stsc', 0, 0, () => {
      out.u32(firsts.length)
      for (const [first, count] of firsts) {
        out.u32(first)
        out.u32(count)
        out.u32(1)
      }
    })
    out.full('stsz', 0, 0, () => {
      out.u32(0)
      out.u32(track.sizes.length)
      track.sizes.forEach((size) => out.u32(size))
    })
    out.full('co64', 0, 0, () => {
      out.u32(track.chunks.length)
      track.chunks.forEach((chunk) => out.u64(chunk.offset))
    })
  })
}

function avc1(out: Out, config: AvcConfig) {
  out.box('avc1', () => {
    out.zeros(6)
    out.u16(1)
    out.zeros(16)
    out.u16(config.width)
    out.u16(config.height)
    out.u32(0x00480000)
    out.u32(0x00480000)
    out.u32(0)
    out.u16(1)
    out.zeros(32)
    out.u16(0x18)
    out.u16(0xffff)
    out.box('avcC', () => {
      const sps = config.sps
      out.u8(1)
      out.u8(sps[1])
      out.u8(sps[2])
      out.u8(sps[3])
      out.u8(0xff)
      out.u8(0xe1)
      out.u16(sps.length)
      out.bytes(sps)
      out.u8(config.pps.length)
      for (const pps of config.pps) {
        out.u16(pps.length)
        out.bytes(pps)
      }
      if ([100, 110, 122, 144].includes(sps[1])) {
        out.u8(0xfc | config.chromaFormat)
        out.u8(0xf8 | (config.bitDepthLuma - 8))
        out.u8(0xf8 | (config.bitDepthChroma - 8))
        out.u8(0)
      }
    })
    if (config.sarWidth !== config.sarHeight) {
      out.box('pasp', () => {
        out.u32(config.sarWidth)
        out.u32(config.sarHeight)
      })
    }
  })
}

function descriptor(out: Out, tag: number, size: number, body: () => void) {
  out.u8(tag)
  out.u8(size)
  body()
}

function mp4a(out: Out, config: AacConfig, id: number, bitrate: number) {
  const specific = [(config.objectType << 3) | (config.rateIndex >> 1), ((config.rateIndex & 1) << 7) | (config.channels << 3)]
  out.box('mp4a', () => {
    out.zeros(6)
    out.u16(1)
    out.zeros(8)
    out.u16(config.channels)
    out.u16(16)
    out.u16(0)
    out.u16(0)
    out.u32((config.sampleRate & 0xffff) * 65536)
    out.full('esds', 0, 0, () => {
      descriptor(out, 3, 3 + 2 + 13 + 2 + specific.length + 3, () => {
        out.u16(id)
        out.u8(0)
        descriptor(out, 4, 13 + 2 + specific.length, () => {
          out.u8(0x40)
          out.u8(0x15)
          out.u8(0)
          out.u16(0)
          out.u32(bitrate)
          out.u32(bitrate)
          descriptor(out, 5, specific.length, () => specific.forEach((byte) => out.u8(byte)))
        })
        descriptor(out, 6, 1, () => out.u8(2))
      })
    })
  })
}

/** 按顺序喂入片段，结束时写 moov 并回填 mdat 大小。 */
export function createMp4Remuxer(sink: Mp4Sink) {
  const video = {
    sizes: [] as number[],
    durations: [] as number[],
    offsets: [] as number[],
    keys: [] as number[],
    chunks: [] as Chunk[],
    configs: new Map<AvcConfig, number>(),
    lastSource: 0,
    lastOut: 0,
    frame: TICKS / 24,
    start: -1,
  }
  const audio = {
    sizes: [] as number[],
    durations: [] as number[],
    chunks: [] as Chunk[],
    configs: new Map<AacConfig, number>(),
    rate: 0,
    start: 0,
    next: 0,
    lastSource: 0,
  }
  let hasVideo = false
  let shift = 0
  let position = 0
  let mdatStart = -1
  let expected: number | null = null
  let pending: Piece[] = []
  let pendingSpan = 0
  let dropped = 0
  let unsupported = ''

  const mapVideo = (samples: VideoSample[], items: Item[]): number | null => {
    let anchor: number | null = null
    const opening = video.start < 0
    for (const sample of samples) {
      if (!video.sizes.length) {
        if (!sample.key || !sample.config) continue
        shift = -sample.dts
      } else {
        const last = video.durations.length - 1
        const delta = sample.dts - video.lastSource
        if (delta > 0 && delta <= CONTINUOUS) {
          video.durations[last] = delta
          if (delta <= FRAME_MAX) video.frame = delta
        } else {
          video.durations[last] = video.frame
          shift = video.lastOut + video.frame - sample.dts
        }
      }
      anchor ??= shift
      const out = sample.dts + shift
      const offset = sample.pts - sample.dts
      if (opening) video.start = video.start < 0 ? out + offset : Math.min(video.start, out + offset)
      video.sizes.push(sample.data.length)
      video.durations.push(video.frame)
      video.offsets.push(offset)
      if (sample.key) video.keys.push(video.sizes.length)
      if (sample.config) video.configs.set(sample.config, (video.configs.get(sample.config) ?? 0) + 1)
      video.lastSource = sample.dts
      video.lastOut = out
      items.push({ time: out / TICKS, data: sample.data })
    }
    return anchor
  }

  const mapAudio = (frames: AudioFrame[], anchor: number | null, items: Item[]) => {
    if (!frames.length) return
    if (!audio.rate) audio.rate = frames[0].config.sampleRate
    const rate = audio.rate
    if (anchor === null && !hasVideo) {
      const first = frames[0].pts
      if (!audio.sizes.length) shift = -first
      else if (Math.abs(first - audio.lastSource - (AAC_FRAME * TICKS) / rate) > CONTINUOUS) shift = (audio.next * TICKS) / rate - first
    }
    const base = anchor ?? shift
    const videoStart = (Math.max(0, video.start) * rate) / TICKS
    for (const frame of frames) {
      const desired = Math.round(((frame.pts + base) * rate) / TICKS)
      if (!audio.sizes.length) {
        if (hasVideo && (video.start < 0 || desired + AAC_FRAME <= videoStart)) continue
        audio.start = desired
        audio.next = desired
      } else {
        const drift = desired - audio.next
        if (Math.abs(drift) <= rate * 2) {
          if (drift < -AAC_FRAME / 2) continue
          if (drift > AAC_FRAME * 1.5) {
            audio.durations[audio.durations.length - 1] += drift
            audio.next += drift
          }
        }
      }
      items.push({ time: audio.next / rate, data: frame.data })
      audio.sizes.push(frame.data.length)
      audio.durations.push(AAC_FRAME)
      audio.configs.set(frame.config, (audio.configs.get(frame.config) ?? 0) + 1)
      audio.next += AAC_FRAME
      audio.lastSource = frame.pts
    }
  }

  const writeItems = async (videoItems: Item[], audioItems: Item[]) => {
    if (!videoItems.length && !audioItems.length) return
    if (mdatStart < 0) {
      const head = ftyp()
      await sink.write(head)
      await sink.write(mdatHeader(0))
      mdatStart = head.length
      position = head.length + 16
    }
    let total = 0
    for (const item of videoItems) total += item.data.length
    for (const item of audioItems) total += item.data.length
    const batch = new Uint8Array(total)
    let at = 0
    const timeAt = (list: Item[], index: number) => list[index]?.time ?? Infinity
    let edge = Math.min(timeAt(videoItems, 0), timeAt(audioItems, 0)) + CHUNK_SECONDS
    const take = (list: Item[], from: number, chunks: Chunk[]) => {
      let index = from
      const start = at
      while (index < list.length && !(list[index].time >= edge)) {
        batch.set(list[index].data, at)
        at += list[index].data.length
        index += 1
      }
      if (index > from) chunks.push({ offset: position + start, count: index - from })
      return index
    }
    let v = 0
    let a = 0
    while (v < videoItems.length || a < audioItems.length) {
      v = take(videoItems, v, video.chunks)
      a = take(audioItems, a, audio.chunks)
      edge = Math.max(edge, Math.min(timeAt(videoItems, v), timeAt(audioItems, a))) + CHUNK_SECONDS
    }
    await sink.write(batch)
    position += total
  }

  const commit = async (piece: Piece) => {
    if (piece.video.length) hasVideo = true
    const videoItems: Item[] = []
    const audioItems: Item[] = []
    const anchor = mapVideo(piece.video, videoItems)
    mapAudio(piece.audio, anchor, audioItems)
    expected = piece.end
    await writeItems(videoItems, audioItems)
  }

  const hold = (piece: Piece) => {
    pending.push(piece)
    pendingSpan += piece.end - piece.start
  }

  const release = async () => {
    const held = pending
    pending = []
    pendingSpan = 0
    for (const piece of held) await commit(piece)
  }

  const pieceOf = ({ video: samples, audio: frames }: Demuxed): Piece | null => {
    if (samples.length) {
      return { video: samples, audio: frames, start: samples[0].dts, end: samples[samples.length - 1].dts + video.frame }
    }
    if (!frames.length) return null
    const frame = (AAC_FRAME * TICKS) / frames[0].config.sampleRate
    return { video: samples, audio: frames, start: frames[0].pts, end: frames[frames.length - 1].pts + frame }
  }

  const moov = (): Uint8Array => {
    const avc = mostCommon(video.configs)
    const aac = mostCommon(audio.configs)
    const withVideo = Boolean(avc && video.sizes.length)
    const withAudio = Boolean(aac && audio.sizes.length)
    const videoStart = Math.max(0, video.start)

    let videoShown = 0
    if (withVideo) {
      let end = 0
      let dts = 0
      for (let index = 0; index < video.sizes.length; index += 1) {
        end = Math.max(end, dts + video.offsets[index] + video.durations[index])
        dts += video.durations[index]
      }
      videoShown = toMovie(end - videoStart, TICKS)
    }

    let audioEdits: [number, number][] = []
    if (withAudio && aac) {
      const media = sum(audio.durations)
      const lead = audio.start / audio.rate - (withVideo ? videoStart / TICKS : 0)
      if (lead > 0.0005) audioEdits = [[Math.round(lead * MOVIE_SCALE), -1], [toMovie(media, aac.sampleRate), 0]]
      else if (lead < -0.0005) {
        const skip = Math.round(-lead * aac.sampleRate)
        audioEdits = [[toMovie(media - skip, aac.sampleRate), skip]]
      } else audioEdits = [[toMovie(media, aac.sampleRate), 0]]
    }
    const audioShown = audioEdits.reduce((total, [duration]) => total + duration, 0)

    const out = byteWriter()
    out.box('moov', () => {
      out.full('mvhd', 0, 0, () => {
        out.u32(0)
        out.u32(0)
        out.u32(MOVIE_SCALE)
        out.u32(Math.max(videoShown, audioShown))
        out.u32(0x00010000)
        out.u16(0x0100)
        out.zeros(10)
        MATRIX.forEach((value) => out.u32(value))
        out.zeros(24)
        out.u32(1 + Number(withVideo) + Number(withAudio))
      })
      let id = 0
      if (withVideo && avc) {
        const trackId = ++id
        const width = Math.round((avc.width * avc.sarWidth) / avc.sarHeight)
        out.box('trak', () => {
          tkhd(out, trackId, videoShown, width, avc.height, 0)
          edts(out, [[videoShown, videoStart]])
          out.box('mdia', () => {
            mdhd(out, TICKS, sum(video.durations))
            hdlr(out, 'vide', 'VideoHandler')
            out.box('minf', () => {
              out.full('vmhd', 0, 1, () => out.zeros(8))
              dinf(out)
              sampleTables(
                out,
                () => avc1(out, avc),
                video,
                () => {
                  if (video.offsets.some(Boolean)) table(out, 'ctts', runs(video.offsets))
                  if (video.keys.length < video.sizes.length) {
                    out.full('stss', 0, 0, () => {
                      out.u32(video.keys.length)
                      video.keys.forEach((key) => out.u32(key))
                    })
                  }
                },
              )
            })
          })
        })
      }
      if (withAudio && aac) {
        const trackId = ++id
        const media = sum(audio.durations)
        const bitrate = Math.round((sum(audio.sizes) * 8 * aac.sampleRate) / Math.max(1, media))
        out.box('trak', () => {
          tkhd(out, trackId, audioShown, 0, 0, 0x0100)
          edts(out, audioEdits)
          out.box('mdia', () => {
            mdhd(out, aac.sampleRate, media)
            hdlr(out, 'soun', 'SoundHandler')
            out.box('minf', () => {
              out.full('smhd', 0, 0, () => out.zeros(4))
              dinf(out)
              sampleTables(out, () => mp4a(out, aac, trackId, bitrate), audio, () => undefined)
            })
          })
        })
      }
    })
    return out.done()
  }

  return {
    /** 一个完整的 TS 片段，或直链 TS 里连续的一段。 */
    async add(demuxed: Demuxed) {
      if (demuxed.unsupported) unsupported = demuxed.unsupported
      const piece = pieceOf(demuxed)
      if (!piece) return
      if (expected === null || (piece.start >= expected - RESUME_EARLY && piece.start <= expected + RESUME_LATE)) {
        dropped += pending.length
        pending = []
        pendingSpan = 0
        await commit(piece)
      } else hold(piece)
      if (pendingSpan > AD_SPAN) await release()
    },
    async finish(): Promise<{ dropped: number }> {
      await release()
      if (!video.sizes.length && !audio.sizes.length) {
        throw new Error(unsupported ? `这段视频是 ${unsupported} 编码，暂时不能保存成 mp4` : '这段视频暂时不能保存成 mp4')
      }
      const size = position - mdatStart
      await sink.write(moov())
      await sink.write(mdatHeader(size), mdatStart)
      return { dropped }
    },
  }
}
