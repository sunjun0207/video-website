import muxjs from 'mux.js'
import { absolutePlayUrl, rewritePlaylist, upstreamFromPlay } from './mediaProxy'

/** 用户关掉保存对话框时抛出，页面上不记成失败。 */
export class DownloadCancelled extends Error {
  constructor() {
    super('已取消')
    this.name = 'DownloadCancelled'
  }
}

export type DownloadGate = {
  pause: () => void
  resume: () => void
  readonly paused: boolean
}

type Gate = DownloadGate & {
  checkpoint: (signal: AbortSignal) => Promise<void>
  fork: (signal: AbortSignal) => AbortSignal
}

type Progress = (percent: number) => void

function createGate(): Gate {
  let paused = false
  let resumeWaiters: Array<() => void> = []
  const pauseListeners = new Set<() => void>()
  return {
    get paused() {
      return paused
    },
    pause() {
      if (paused) return
      paused = true
      pauseListeners.forEach((listener) => listener())
    },
    resume() {
      if (!paused) return
      paused = false
      const waiters = resumeWaiters
      resumeWaiters = []
      waiters.forEach((resume) => resume())
    },
    checkpoint(signal) {
      if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
      if (!paused) return Promise.resolve()
      return new Promise((resolve, reject) => {
        const finish = () => {
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          resumeWaiters = resumeWaiters.filter((waiter) => waiter !== finish)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        resumeWaiters.push(finish)
        signal.addEventListener('abort', onAbort, { once: true })
      })
    },
    fork(signal) {
      const local = new AbortController()
      const abortLocal = () => local.abort()
      if (signal.aborted || paused) {
        abortLocal()
        return local.signal
      }
      signal.addEventListener('abort', abortLocal, { once: true })
      pauseListeners.add(abortLocal)
      local.signal.addEventListener(
        'abort',
        () => {
          signal.removeEventListener('abort', abortLocal)
          pauseListeners.delete(abortLocal)
        },
        { once: true },
      )
      return local.signal
    },
  }
}

function percentOf(done: number, total: number): number {
  if (!total) return 0
  return Math.min(99, Math.round((done / total) * 100))
}

async function fetchBatch(parts: Part[], signal: AbortSignal, gate: Gate): Promise<Uint8Array[]> {
  while (true) {
    await gate.checkpoint(signal)
    const local = gate.fork(signal)
    try {
      return await Promise.all(parts.map((part) => fetchPart(part, local)))
    } catch (error) {
      if (signal.aborted) throw error
      if (gate.paused || local.aborted) continue
      throw error
    }
  }
}

type Range = { offset: number; length: number }

type Part = {
  uri: string
  range?: Range
  map?: boolean
  decrypt?: { uri: string; iv: Uint8Array }
}

type Sink = {
  write: (data: Uint8Array) => Promise<void>
  close: () => Promise<void>
  abort: () => Promise<void>
}

const keyCache = new Map<string, Promise<CryptoKey>>()

function tagAttr(line: string, name: string): string {
  const matched = line.match(new RegExp(`${name}=(?:"([^"]*)"|([^,\\s]*))`))
  return (matched?.[1] ?? matched?.[2] ?? '').trim()
}

function resolveUri(uri: string, base: string): string {
  const absolute = new URL(uri, base).href
  if (upstreamFromPlay(absolute)) return absolute
  return absolutePlayUrl(absolute)
}

function parseIv(hex: string): Uint8Array {
  const padded = hex.trim().replace(/^0x/i, '').padStart(32, '0').slice(-32)
  const iv = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) iv[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16)
  return iv
}

function ivFromSequence(sequence: number): Uint8Array {
  const iv = new Uint8Array(16)
  const view = new DataView(iv.buffer)
  view.setUint32(8, Math.floor(sequence / 2 ** 32))
  view.setUint32(12, sequence >>> 0)
  return iv
}

function fixedRange(spec: string): Range | undefined {
  if (!spec) return undefined
  const [lengthText, offsetText] = spec.split('@')
  const length = Number(lengthText)
  const offset = Number(offsetText || 0)
  if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(offset) || offset < 0) return undefined
  return { offset, length }
}

function chooseVariant(text: string, base: string): string {
  const rows = text.split(/\r?\n/)
  let bestUrl = ''
  let bestBandwidth = -1
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number((rows[index].match(/BANDWIDTH=(\d+)/) || [])[1] || 0)
    let uri = ''
    for (let next = index + 1; next < rows.length; next += 1) {
      const candidate = rows[next].trim()
      if (!candidate) continue
      if (candidate.startsWith('#')) break
      uri = candidate
      break
    }
    if (!uri) continue
    if (bandwidth >= bestBandwidth) {
      bestBandwidth = bandwidth
      bestUrl = resolveUri(uri, base)
    }
  }
  if (!bestUrl) throw new Error('没有可下载的清晰度')
  return bestUrl
}

function parseMediaPlaylist(text: string, base: string): Part[] {
  const lines = text.split(/\r?\n/)
  let sequenceBase = 0
  let keyMethod = 'NONE'
  let keyUri = ''
  let keyIv = ''
  let mapUri = ''
  let mapRange = ''
  let mapSent = ''
  let pendingRange = ''
  let mediaOffset = 0
  let segmentIndex = 0
  const parts: Part[] = []

  const pushMap = () => {
    if (!mapUri || mapSent === `${mapUri}|${mapRange}`) return
    parts.push({ uri: resolveUri(mapUri, base), range: fixedRange(mapRange), map: true })
    mapSent = `${mapUri}|${mapRange}`
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequenceBase = Number(line.split(':')[1]) || 0
      continue
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      keyMethod = (tagAttr(line, 'METHOD') || 'NONE').toUpperCase()
      keyUri = tagAttr(line, 'URI')
      keyIv = tagAttr(line, 'IV')
      if (keyMethod !== 'NONE' && keyMethod !== 'AES-128') throw new Error('这段视频的加密方式暂时不能下载')
      continue
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      mapUri = tagAttr(line, 'URI')
      mapRange = tagAttr(line, 'BYTERANGE')
      continue
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingRange = line.slice('#EXT-X-BYTERANGE:'.length).trim()
      continue
    }
    if (line.startsWith('#')) continue
    pushMap()
    let range: Range | undefined
    if (pendingRange) {
      const [lengthText, offsetText] = pendingRange.split('@')
      const length = Number(lengthText)
      const offset = offsetText === undefined ? mediaOffset : Number(offsetText)
      if (Number.isFinite(length) && length > 0 && Number.isFinite(offset) && offset >= 0) {
        range = { offset, length }
        mediaOffset = offset + length
      }
      pendingRange = ''
    }
    const sequence = sequenceBase + segmentIndex
    segmentIndex += 1
    const decrypt =
      keyMethod === 'AES-128'
        ? { uri: resolveUri(keyUri, base), iv: keyIv ? parseIv(keyIv) : ivFromSequence(sequence) }
        : undefined
    if (decrypt && !keyUri) throw new Error('缺少解密密钥')
    parts.push({ uri: resolveUri(line, base), range, decrypt })
  }
  if (!parts.length) throw new Error('这一集没有可下载的片段')
  return parts
}

async function fetchBytes(url: string, signal: AbortSignal, headers?: HeadersInit): Promise<{ bytes: Uint8Array; status: number }> {
  const once = async () => {
    const response = await fetch(url, { signal, headers })
    if (!response.ok && response.status !== 206) throw new Error('片段没有回应')
    return { bytes: new Uint8Array(await response.arrayBuffer()), status: response.status }
  }
  try {
    return await once()
  } catch (error) {
    if (signal.aborted) throw error
    return await once()
  }
}

function cryptoKey(uri: string, signal: AbortSignal): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) return Promise.reject(new Error('当前页面不能解密这段视频'))
  const cached = keyCache.get(uri)
  if (cached) return cached
  const pending = fetchBytes(uri, signal).then(({ bytes }) => {
    if (bytes.byteLength !== 16) throw new Error('密钥长度不正确')
    const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    return crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])
  })
  keyCache.set(uri, pending)
  pending.catch(() => {
    if (keyCache.get(uri) === pending) keyCache.delete(uri)
  })
  return pending
}

async function fetchPart(part: Part, signal: AbortSignal): Promise<Uint8Array> {
  const headers: HeadersInit = {}
  if (part.range) headers.Range = `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}`
  const { bytes, status } = await fetchBytes(part.uri, signal, headers)
  let data = bytes
  if (part.range && status === 200 && data.byteLength > part.range.length) {
    data = data.slice(part.range.offset, part.range.offset + part.range.length)
  }
  if (!part.decrypt) return data
  const key = await cryptoKey(part.decrypt.uri, signal)
  const cipher = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
  const iv = part.decrypt.iv.buffer.slice(part.decrypt.iv.byteOffset, part.decrypt.iv.byteOffset + part.decrypt.iv.byteLength)
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cipher)
  return new Uint8Array(plain)
}

function extensionFrom(url: string, contentType: string): { ext: string; mime: string } {
  const path = url.split('?')[0]
  const matched = path.match(/\.([a-z0-9]{2,5})$/i)
  const fromUrl = matched?.[1].toLowerCase() || ''
  if (fromUrl === 'mp4' || contentType.includes('mp4')) return { ext: 'mp4', mime: 'video/mp4' }
  if (fromUrl === 'ts' || contentType.includes('mp2t')) return { ext: 'ts', mime: 'video/mp2t' }
  if (fromUrl) return { ext: fromUrl, mime: contentType.split(';')[0] || 'application/octet-stream' }
  return { ext: 'mp4', mime: 'video/mp4' }
}

function isFmp4(parts: Part[]): boolean {
  return parts.some((part) => part.map || /\.(mp4|m4s|cmfv|cmfa)(?:$|\?)/i.test(part.uri))
}

function alignTs(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 188 && bytes[0] === 0x47) return bytes
  const limit = Math.min(bytes.length - 188, 188 * 4)
  for (let index = 0; index <= limit; index += 1) {
    if (bytes[index] === 0x47 && bytes[index + 188] === 0x47) return bytes.subarray(index)
  }
  return bytes
}

function createTransmuxer() {
  return new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: true })
}

type SaveHandle = {
  createWritable: () => Promise<{
    write: (data: Uint8Array) => Promise<void>
    close: () => Promise<void>
    abort: () => Promise<void>
  }>
}

type SavePicker = (options: {
  suggestedName?: string
  types?: { description?: string; accept: Record<string, string[]> }[]
}) => Promise<SaveHandle>

function savePicker(): SavePicker | null {
  const candidate = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker
  return candidate ? candidate.bind(window) : null
}

async function openSink(filename: string, ext: string, mime: string): Promise<Sink> {
  const picker = savePicker()
  if (picker) {
    try {
      const handle = await picker({
        suggestedName: `${filename}.${ext}`,
        types: [{ description: '视频', accept: { [mime]: [`.${ext}`] } }],
      })
      const writable = await handle.createWritable()
      return writable
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new DownloadCancelled()
    }
  }
  const parts: Uint8Array[] = []
  return {
    write: async (data) => {
      parts.push(data)
    },
    close: async () => {
      const blob = new Blob(parts, { type: mime })
      const href = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = href
      link.download = `${filename}.${ext}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(href), 60_000)
    },
    abort: async () => {
      parts.length = 0
    },
  }
}

async function withSink(sink: Sink, task: () => Promise<void>) {
  try {
    await task()
    await sink.close()
  } catch (error) {
    await sink.abort().catch(() => undefined)
    throw error
  }
}

async function readPlaylist(url: string, signal: AbortSignal): Promise<{ text: string; base: string }> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('播放列表没有回应')
  const raw = await response.text()
  if (!raw.includes('#EXTM3U')) throw new Error('播放列表无效')
  const upstream = upstreamFromPlay(response.url) || upstreamFromPlay(url) || url
  return { text: rewritePlaylist(raw, upstream), base: upstream }
}

async function mediaParts(startUrl: string, signal: AbortSignal): Promise<Part[]> {
  let url = startUrl
  for (let depth = 0; depth < 4; depth += 1) {
    const playlist = await readPlaylist(url, signal)
    if (!playlist.text.includes('#EXT-X-STREAM-INF')) return parseMediaPlaylist(playlist.text, playlist.base)
    url = chooseVariant(playlist.text, playlist.base)
  }
  throw new Error('播放列表嵌套过深')
}

async function downloadDirect(url: string, filename: string, signal: AbortSignal, gate: Gate, onProgress: Progress) {
  onProgress(0)
  await gate.checkpoint(signal)
  const response = await fetch(url, { signal: gate.fork(signal) })
  if (!response.ok || !response.body) throw new Error('视频没有回应')
  const type = response.headers.get('content-type') || ''
  if (type.includes('mpegurl') || type.includes('m3u8')) {
    const raw = await response.text()
    if (!raw.includes('#EXTM3U')) throw new Error('播放列表无效')
    const upstream = upstreamFromPlay(response.url) || upstreamFromPlay(url) || url
    const text = rewritePlaylist(raw, upstream)
    const parts = text.includes('#EXT-X-STREAM-INF')
      ? await mediaParts(chooseVariant(text, upstream), signal)
      : parseMediaPlaylist(text, upstream)
    await saveParts(parts, filename, signal, gate, onProgress)
    return
  }
  const file = extensionFrom(url, type)
  const total = Number(response.headers.get('content-length') || 0)
  if (file.ext === 'ts') {
    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    let received = 0
    while (true) {
      await gate.checkpoint(signal)
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      received += step.value.length
      onProgress(percentOf(received, total))
    }
    const pieces = transmuxTs(chunks)
    const sink = await openSink(filename, 'mp4', 'video/mp4')
    await withSink(sink, async () => {
      for (const piece of pieces) await sink.write(piece)
      onProgress(100)
    })
    return
  }
  const sink = await openSink(filename, file.ext === 'mp4' ? 'mp4' : file.ext, file.ext === 'mp4' ? 'video/mp4' : file.mime)
  await withSink(sink, async () => {
    const reader = response.body!.getReader()
    let received = 0
    while (true) {
      await gate.checkpoint(signal)
      const step = await reader.read()
      if (step.done) break
      await sink.write(step.value)
      received += step.value.length
      onProgress(percentOf(received, total))
    }
    onProgress(100)
  })
}

function transmuxTs(chunks: Uint8Array[]): Uint8Array[] {
  const transmuxer = createTransmuxer()
  const pieces: Uint8Array[] = []
  let wroteInit = false
  transmuxer.on('data', (segment) => {
    if (!wroteInit && segment.initSegment?.byteLength) {
      pieces.push(segment.initSegment)
      wroteInit = true
    }
    if (segment.data?.byteLength) pieces.push(segment.data)
  })
  for (const chunk of chunks) {
    transmuxer.push(alignTs(chunk))
    transmuxer.flush()
  }
  if (!wroteInit) throw new Error('这段视频暂时不能保存成 mp4')
  return pieces
}

async function writeParts(sink: Sink, parts: Part[], signal: AbortSignal, gate: Gate, onProgress: Progress) {
  const batchSize = 4
  let done = 0
  for (let offset = 0; offset < parts.length; offset += batchSize) {
    const batch = parts.slice(offset, offset + batchSize)
    const chunks = await fetchBatch(batch, signal, gate)
    for (const chunk of chunks) {
      await sink.write(chunk)
      done += 1
      onProgress(percentOf(done, parts.length))
    }
  }
}

async function writeTransmuxed(sink: Sink, parts: Part[], signal: AbortSignal, gate: Gate, onProgress: Progress) {
  const transmuxer = createTransmuxer()
  const pending: Uint8Array[] = []
  let wroteInit = false
  transmuxer.on('data', (segment) => {
    if (!wroteInit && segment.initSegment?.byteLength) {
      pending.push(segment.initSegment)
      wroteInit = true
    }
    if (segment.data?.byteLength) pending.push(segment.data)
  })
  const batchSize = 4
  let done = 0
  for (let offset = 0; offset < parts.length; offset += batchSize) {
    const batch = parts.slice(offset, offset + batchSize)
    const chunks = await fetchBatch(batch, signal, gate)
    for (const chunk of chunks) {
      transmuxer.push(alignTs(chunk))
      transmuxer.flush()
      while (pending.length) {
        const piece = pending.shift()
        if (piece) await sink.write(piece)
      }
      done += 1
      onProgress(percentOf(done, parts.length))
    }
  }
  if (!wroteInit) throw new Error('这段视频暂时不能保存成 mp4')
}

async function saveParts(parts: Part[], filename: string, signal: AbortSignal, gate: Gate, onProgress: Progress) {
  const sink = await openSink(filename, 'mp4', 'video/mp4')
  await withSink(sink, async () => {
    if (isFmp4(parts)) await writeParts(sink, parts, signal, gate, onProgress)
    else await writeTransmuxed(sink, parts, signal, gate, onProgress)
    onProgress(100)
  })
}

const QUALITY_WORDS = ['4K', '2160P', '1080P', '720P', '蓝光', '超清', '高清', '标清', '流畅']

function cleanName(value: string): string {
  return value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function qualityFromLine(line: string): string {
  const upper = line.toUpperCase()
  for (const word of QUALITY_WORDS) {
    if (upper.includes(word.toUpperCase())) return word
  }
  const note = line.split('·').pop()?.trim() || ''
  const piece = note
    .split('/')
    .map((item) => item.trim())
    .find((item) => item && !/加速|秒播|线路/.test(item))
  return cleanName(piece || '') || '高清'
}

export function downloadFilename(title: string, quality: string, episode = ''): string {
  const level = cleanName(quality) || '高清'
  const head = [cleanName(title) || '视频', cleanName(episode)].filter(Boolean).join('-')
  const room = Math.max(1, 100 - level.length - 1)
  return `${head.slice(0, room)}-${level}`
}

/** 下载当前播放地址。VITE_USE_PROXY 为 true 时片段走本站代理，否则直连片源。 */
export async function downloadMedia(options: {
  url: string
  filename: string
  signal: AbortSignal
  onProgress: Progress
  onGate?: (gate: DownloadGate) => void
}): Promise<void> {
  const { url, filename, signal, onProgress, onGate } = options
  if (!url) throw new Error('还没有播放地址')
  const gate = createGate()
  onGate?.(gate)
  onProgress(0)
  if (url.includes('.m3u8')) {
    const parts = await mediaParts(url, signal)
    await saveParts(parts, filename, signal, gate, onProgress)
    return
  }
  await downloadDirect(url, filename, signal, gate, onProgress)
}
