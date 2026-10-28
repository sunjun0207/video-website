/** MPEG-TS 解复用：取出 H.264 访问单元和 AAC 帧。时间戳单位 90kHz，已展开 33 位回绕。 */

const PACKET = 188
const WRAP = 2 ** 33
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350]
const SAR: [number, number][] = [
  [1, 1],
  [1, 1],
  [12, 11],
  [10, 11],
  [16, 11],
  [40, 33],
  [24, 11],
  [20, 11],
  [32, 11],
  [80, 33],
  [18, 11],
  [15, 11],
  [64, 33],
  [160, 99],
  [4, 3],
  [3, 2],
  [2, 1],
]
const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135])
const OTHER_VIDEO: Record<number, string> = { 0x01: 'MPEG-1', 0x02: 'MPEG-2', 0x10: 'MPEG-4', 0x24: 'HEVC', 0x42: 'AVS' }
const OTHER_AUDIO: Record<number, string> = { 0x03: 'MP3', 0x04: 'MP3', 0x11: 'AAC-LATM', 0x81: 'AC-3', 0x87: 'E-AC-3' }

export type AvcConfig = {
  sps: Uint8Array
  pps: Uint8Array[]
  width: number
  height: number
  sarWidth: number
  sarHeight: number
  chromaFormat: number
  bitDepthLuma: number
  bitDepthChroma: number
}

export type AacConfig = { sampleRate: number; channels: number; objectType: number; rateIndex: number }

export type VideoSample = { dts: number; pts: number; key: boolean; data: Uint8Array; config: AvcConfig | null }

export type AudioFrame = { pts: number; data: Uint8Array; config: AacConfig }

export type Demuxed = { video: VideoSample[]; audio: AudioFrame[]; unsupported: string }

type Pes = { chunks: Uint8Array[]; size: number }

type AccessUnit = { pts: number; dts: number; chunks: Uint8Array[]; size: number }

function join(chunks: Uint8Array[], size: number): Uint8Array {
  if (chunks.length === 1) return chunks[0]
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function findSync(data: Uint8Array, from: number): number {
  for (let index = from; index + PACKET <= data.length; index += 1) {
    if (data[index] !== 0x47) continue
    if (index + PACKET < data.length && data[index + PACKET] !== 0x47) continue
    if (index + PACKET * 2 < data.length && data[index + PACKET * 2] !== 0x47) continue
    return index
  }
  return -1
}

function readTimestamp(data: Uint8Array, at: number): number {
  return (
    (data[at] & 0x0e) * 2 ** 29 +
    data[at + 1] * 2 ** 22 +
    (data[at + 2] & 0xfe) * 2 ** 14 +
    data[at + 3] * 2 ** 7 +
    (data[at + 4] >> 1)
  )
}

/** 去掉防竞争字节 00 00 03。 */
function unescape(nal: Uint8Array): Uint8Array {
  const out = new Uint8Array(nal.length)
  let length = 0
  let zeros = 0
  for (const byte of nal) {
    if (zeros >= 2 && byte === 3) {
      zeros = 0
      continue
    }
    out[length++] = byte
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return out.subarray(0, length)
}

function bitReader(bytes: Uint8Array) {
  let bit = 0
  const u = (count: number) => {
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const byte = bytes[bit >> 3] ?? 0
      value = value * 2 + ((byte >> (7 - (bit & 7))) & 1)
      bit += 1
    }
    return value
  }
  const ue = () => {
    let zeros = 0
    while (u(1) === 0 && zeros < 32) zeros += 1
    return 2 ** zeros - 1 + u(zeros)
  }
  const se = () => {
    const value = ue()
    return value % 2 ? (value + 1) / 2 : -value / 2
  }
  return { u, ue, se }
}

function skipScalingList(bits: ReturnType<typeof bitReader>, size: number) {
  let last = 8
  let next = 8
  for (let index = 0; index < size; index += 1) {
    if (next !== 0) next = (last + bits.se() + 256) % 256
    if (next !== 0) last = next
  }
}

function parseSps(nal: Uint8Array): Omit<AvcConfig, 'sps' | 'pps'> {
  const bits = bitReader(unescape(nal.subarray(1)))
  const profile = bits.u(8)
  bits.u(16)
  bits.ue()
  let chromaFormat = 1
  let bitDepthLuma = 8
  let bitDepthChroma = 8
  if (HIGH_PROFILES.has(profile)) {
    chromaFormat = bits.ue()
    if (chromaFormat === 3) bits.u(1)
    bitDepthLuma = bits.ue() + 8
    bitDepthChroma = bits.ue() + 8
    bits.u(1)
    if (bits.u(1)) {
      for (let index = 0; index < (chromaFormat === 3 ? 12 : 8); index += 1) {
        if (bits.u(1)) skipScalingList(bits, index < 6 ? 16 : 64)
      }
    }
  }
  bits.ue()
  const pocType = bits.ue()
  if (pocType === 0) bits.ue()
  else if (pocType === 1) {
    bits.u(1)
    bits.se()
    bits.se()
    const cycle = bits.ue()
    for (let index = 0; index < cycle; index += 1) bits.se()
  }
  bits.ue()
  bits.u(1)
  const widthMbs = bits.ue() + 1
  const heightUnits = bits.ue() + 1
  const frameMbsOnly = bits.u(1)
  if (!frameMbsOnly) bits.u(1)
  bits.u(1)
  let crop = [0, 0, 0, 0]
  if (bits.u(1)) crop = [bits.ue(), bits.ue(), bits.ue(), bits.ue()]
  let [sarWidth, sarHeight] = [1, 1]
  if (bits.u(1) && bits.u(1)) {
    const idc = bits.u(8)
    if (idc === 255) [sarWidth, sarHeight] = [bits.u(16), bits.u(16)]
    else if (SAR[idc]) [sarWidth, sarHeight] = SAR[idc]
  }
  const cropX = chromaFormat === 1 || chromaFormat === 2 ? 2 : 1
  const cropY = (chromaFormat === 1 ? 2 : 1) * (2 - frameMbsOnly)
  return {
    width: widthMbs * 16 - cropX * (crop[0] + crop[1]),
    height: (2 - frameMbsOnly) * heightUnits * 16 - cropY * (crop[2] + crop[3]),
    sarWidth: sarWidth || 1,
    sarHeight: sarHeight || 1,
    chromaFormat,
    bitDepthLuma,
    bitDepthChroma,
  }
}

function isIntraSlice(nal: Uint8Array): boolean {
  const bits = bitReader(nal.subarray(1, 9))
  bits.ue()
  const type = bits.ue() % 5
  return type === 2 || type === 4
}

/** Annex-B 字节流按起始码切成 NAL。 */
function splitNals(bytes: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = []
  let start = -1
  let from = 0
  while (from < bytes.length) {
    const one = bytes.indexOf(1, from)
    if (one < 0) break
    if (one >= 2 && bytes[one - 1] === 0 && bytes[one - 2] === 0) {
      if (start >= 0) units.push(trimZeros(bytes, start, one - 2))
      start = one + 1
    }
    from = one + 1
  }
  if (start >= 0) units.push(trimZeros(bytes, start, bytes.length))
  return units
}

function trimZeros(bytes: Uint8Array, start: number, end: number): Uint8Array {
  while (end > start && bytes[end - 1] === 0) end -= 1
  return bytes.subarray(start, end)
}

function keyOf(bytes: Uint8Array): string {
  return Array.prototype.join.call(bytes, ',')
}

/** 流式解复用。HLS 片段用 push + flush；直链 TS 分段 push + take，最后 flush。 */
export function createTsDemuxer() {
  let carry: Uint8Array | null = null
  let pmtPid = -1
  let videoPid = -1
  let audioPid = -1
  let unsupported = ''
  let reference: number | null = null
  let videoPes: Pes | null = null
  let audioPes: Pes | null = null
  let unit: AccessUnit | null = null
  let audioCarry: Uint8Array | null = null
  let audioNext: number | null = null
  let avc: AvcConfig | null = null
  const avcConfigs = new Map<string, AvcConfig>()
  const aacConfigs = new Map<string, AacConfig>()
  let video: VideoSample[] = []
  let audio: AudioFrame[] = []

  const unwrap = (value: number) => {
    if (reference !== null) {
      while (value - reference > WRAP / 2) value -= WRAP
      while (reference - value > WRAP / 2) value += WRAP
    }
    reference = value
    return value
  }

  const parsePat = (payload: Uint8Array) => {
    const at = payload[0] + 1
    if (payload[at] !== 0x00) return
    const end = Math.min(payload.length, at + 3 + (((payload[at + 1] & 0x0f) << 8) | payload[at + 2]) - 4)
    for (let entry = at + 8; entry + 4 <= end; entry += 4) {
      const program = (payload[entry] << 8) | payload[entry + 1]
      if (program !== 0) {
        pmtPid = ((payload[entry + 2] & 0x1f) << 8) | payload[entry + 3]
        return
      }
    }
  }

  const parsePmt = (payload: Uint8Array) => {
    const at = payload[0] + 1
    if (payload[at] !== 0x02) return
    const end = Math.min(payload.length, at + 3 + (((payload[at + 1] & 0x0f) << 8) | payload[at + 2]) - 4)
    let entry = at + 12 + (((payload[at + 10] & 0x0f) << 8) | payload[at + 11])
    let nextVideo = -1
    let nextAudio = -1
    let otherVideo = ''
    let otherAudio = ''
    while (entry + 5 <= end) {
      const type = payload[entry]
      const pid = ((payload[entry + 1] & 0x1f) << 8) | payload[entry + 2]
      if (type === 0x1b && nextVideo < 0) nextVideo = pid
      else if (type === 0x0f && nextAudio < 0) nextAudio = pid
      else if (OTHER_VIDEO[type]) otherVideo ||= OTHER_VIDEO[type]
      else if (OTHER_AUDIO[type]) otherAudio ||= OTHER_AUDIO[type]
      entry += 5 + (((payload[entry + 3] & 0x0f) << 8) | payload[entry + 4])
    }
    if (nextVideo !== videoPid) {
      finishVideoPes()
      finishUnit()
      videoPid = nextVideo
    }
    if (nextAudio !== audioPid) {
      finishAudioPes()
      audioPid = nextAudio
    }
    unsupported = (nextVideo < 0 && otherVideo) || (nextAudio < 0 && otherAudio) || ''
  }

  const pesBody = (pes: Pes) => {
    const data = join(pes.chunks, pes.size)
    if (data.length < 9 || data[0] !== 0 || data[1] !== 0 || data[2] !== 1) return null
    const flags = data[7]
    const start = 9 + data[8]
    const declared = (data[4] << 8) | data[5]
    const end = declared ? Math.min(data.length, 6 + declared) : data.length
    if (start >= end) return null
    const pts = flags & 0x80 ? readTimestamp(data, 9) : null
    const dts = (flags & 0xc0) === 0xc0 ? readTimestamp(data, 14) : pts
    return { pts, dts, payload: data.subarray(start, end) }
  }

  const finishUnit = () => {
    const current = unit
    unit = null
    if (!current) return
    let size = 0
    let key = false
    let intra = false
    let hasSps = false
    const kept: Uint8Array[] = []
    for (const nal of splitNals(join(current.chunks, current.size))) {
      if (!nal.length) continue
      const type = nal[0] & 0x1f
      if (type === 9 || type === 12) continue
      if (type === 7) {
        hasSps = true
        const id = keyOf(nal)
        let config = avcConfigs.get(id)
        if (!config) {
          config = { sps: nal.slice(), pps: [], ...parseSps(nal) }
          avcConfigs.set(id, config)
        }
        avc = config
      } else if (type === 8 && avc && !avc.pps.some((pps) => keyOf(pps) === keyOf(nal))) {
        avc.pps.push(nal.slice())
      } else if (type === 5) key = true
      else if (type === 1 && !intra && !key) intra = isIntraSlice(nal)
      kept.push(nal)
      size += 4 + nal.length
    }
    if (!kept.length) return
    const data = new Uint8Array(size)
    const view = new DataView(data.buffer)
    let offset = 0
    for (const nal of kept) {
      view.setUint32(offset, nal.length)
      data.set(nal, offset + 4)
      offset += 4 + nal.length
    }
    video.push({ dts: current.dts, pts: current.pts, key: key || (hasSps && intra), data, config: avc })
  }

  const finishVideoPes = () => {
    const pes = videoPes
    videoPes = null
    if (!pes) return
    const body = pesBody(pes)
    if (!body) return
    if (body.pts === null || body.dts === null) {
      if (unit) {
        unit.chunks.push(body.payload)
        unit.size += body.payload.length
      }
      return
    }
    finishUnit()
    const dts = unwrap(body.dts)
    const offset = (body.pts - body.dts + WRAP) % WRAP
    const pts = offset < WRAP / 2 ? dts + offset : dts
    unit = { pts, dts, chunks: [body.payload], size: body.payload.length }
  }

  const aacConfig = (data: Uint8Array, at: number): AacConfig | null => {
    const objectType = ((data[at + 2] >> 6) & 3) + 1
    const rateIndex = (data[at + 2] >> 2) & 0x0f
    const channels = ((data[at + 2] & 1) << 2) | (data[at + 3] >> 6) || 2
    const sampleRate = AAC_RATES[rateIndex]
    if (!sampleRate) return null
    const id = `${objectType}-${rateIndex}-${channels}`
    let config = aacConfigs.get(id)
    if (!config) {
      config = { sampleRate, channels, objectType, rateIndex }
      aacConfigs.set(id, config)
    }
    return config
  }

  const finishAudioPes = () => {
    const pes = audioPes
    audioPes = null
    if (!pes) return
    const body = pesBody(pes)
    if (!body) return
    const carried = audioCarry?.length ?? 0
    const data = audioCarry ? join([audioCarry, body.payload], carried + body.payload.length) : body.payload
    audioCarry = null
    const pesPts = body.pts === null ? null : unwrap(body.pts)
    let next = audioNext ?? pesPts
    let usedPts = false
    let at = 0
    while (at + 7 <= data.length) {
      if (data[at] !== 0xff || (data[at + 1] & 0xf6) !== 0xf0) {
        at += 1
        continue
      }
      const header = data[at + 1] & 1 ? 7 : 9
      const length = ((data[at + 3] & 3) << 11) | (data[at + 4] << 3) | (data[at + 5] >> 5)
      if (length <= header) {
        at += 1
        continue
      }
      if (at + length > data.length) break
      const config = aacConfig(data, at)
      if (!usedPts && at >= carried && pesPts !== null) {
        next = pesPts
        usedPts = true
      }
      if (config && next !== null) {
        audio.push({ pts: next, data: data.subarray(at + header, at + length), config })
        next += (1024 * 90000) / config.sampleRate
      }
      at += length
    }
    audioNext = next
    if (at < data.length) audioCarry = data.slice(at)
  }

  const addPes = (kind: 'video' | 'audio', payload: Uint8Array, start: boolean) => {
    const current = kind === 'video' ? videoPes : audioPes
    if (start) {
      if (kind === 'video') finishVideoPes()
      else finishAudioPes()
      const pes = { chunks: [payload], size: payload.length }
      if (kind === 'video') videoPes = pes
      else audioPes = pes
      return
    }
    if (!current) return
    current.chunks.push(payload)
    current.size += payload.length
  }

  const parsePacket = (data: Uint8Array, at: number) => {
    if (data[at + 1] & 0x80) return
    const start = (data[at + 1] & 0x40) !== 0
    const pid = ((data[at + 1] & 0x1f) << 8) | data[at + 2]
    const control = (data[at + 3] >> 4) & 3
    let offset = at + 4
    if (control & 2) offset += 1 + data[at + 4]
    if (!(control & 1) || offset >= at + PACKET) return
    const payload = data.subarray(offset, at + PACKET)
    if (pid === 0) {
      if (start) parsePat(payload)
    } else if (pid === pmtPid) {
      if (start) parsePmt(payload)
    } else if (pid === videoPid) addPes('video', payload, start)
    else if (pid === audioPid) addPes('audio', payload, start)
  }

  const output = (): Demuxed => {
    const result = { video, audio, unsupported: video.length || audio.length ? '' : unsupported }
    video = []
    audio = []
    return result
  }

  return {
    push(bytes: Uint8Array) {
      let data = bytes
      if (carry) {
        data = join([carry, bytes], carry.length + bytes.length)
        carry = null
      }
      let at = 0
      while (at + PACKET <= data.length) {
        if (data[at] !== 0x47) {
          const next = findSync(data, at + 1)
          if (next < 0) {
            at = data.length - PACKET + 1
            break
          }
          at = next
          continue
        }
        parsePacket(data, at)
        at += PACKET
      }
      if (at < data.length) carry = data.slice(at)
    },
    /** 取出已经完整的样本，PES 未结束的部分留到下一次。 */
    take: output,
    /** 一段数据结束：收尾所有未完成的 PES。 */
    flush(): Demuxed {
      finishVideoPes()
      finishUnit()
      finishAudioPes()
      carry = null
      audioCarry = null
      audioNext = null
      return output()
    },
  }
}
