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

export type DownloadProgress = {
  percent: number
  received: number
  total: number
  speed: number
}

type Progress = (progress: DownloadProgress) => void

/** 同时拉取的连接数，和常见多线程下载器的默认路数一致。 */
const CONNECTIONS = 8
const MIN_PIECE = 1024 * 1024
const TS_PACKET = 188

type Tracker = {
  open: () => void
  add: (delta: number) => void
  setTotal: (next: number) => void
  finish: () => void
}

function createTracker(onProgress: Progress): Tracker {
  let received = 0
  let total = 0
  let lastEmit = 0
  const marks: { t: number; received: number }[] = []

  const emit = (force: boolean) => {
    const now = performance.now()
    if (!force && now - lastEmit < 200) return
    lastEmit = now
    const cutoff = now - 1000
    while (marks.length > 1 && marks[0].t < cutoff) marks.shift()
    let speed = 0
    if (marks.length >= 2) {
      const span = marks[marks.length - 1].t - marks[0].t
      const bytes = marks[marks.length - 1].received - marks[0].received
      if (span >= 250 && bytes > 0) speed = (bytes * 1000) / span
    }
    const scale = total > 0 ? Math.max(total, received) : 0
    const percent = scale > 0 ? Math.min(99, Math.floor((received / scale) * 100)) : 0
    onProgress({
      percent,
      received: Math.max(0, Math.round(received)),
      total: Math.max(0, Math.round(scale)),
      speed: Math.max(0, Math.round(speed)),
    })
  }

  return {
    open() {
      marks.push({ t: performance.now(), received: 0 })
      emit(true)
    },
    add(delta) {
      if (!delta) return
      received = Math.max(0, received + delta)
      marks.push({ t: performance.now(), received })
      emit(received > 0 && marks.length <= 2)
    },
    setTotal(next) {
      if (!Number.isFinite(next) || next <= 0 || next === total) return
      total = next
      emit(true)
    },
    finish() {
      const receivedNow = Math.max(0, Math.round(received))
      const totalNow = Math.max(receivedNow, Math.round(total))
      onProgress({ percent: 100, received: receivedNow, total: totalNow, speed: 0 })
    },
  }
}

function createWake() {
  let epoch = 0
  let waiting: Array<() => void> = []
  return {
    wake() {
      epoch += 1
      const current = waiting
      waiting = []
      current.forEach((finish) => finish())
    },
    wait(signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
      const seen = epoch
      return new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          signal.removeEventListener('abort', onAbort)
          resolve()
        }
        const onAbort = () => {
          if (settled) return
          settled = true
          waiting = waiting.filter((item) => item !== finish)
          reject(new DOMException('Aborted', 'AbortError'))
        }
        waiting.push(finish)
        signal.addEventListener('abort', onAbort, { once: true })
        if (epoch !== seen) finish()
      })
    },
  }
}

function linkStop(signal: AbortSignal) {
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  if (signal.aborted) stop.abort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return {
    signal: stop.signal,
    abort: () => stop.abort(),
    unlink: () => signal.removeEventListener('abort', onAbort),
  }
}

type Span = {
  start: number
  end: number
  next: number
  chunks: Uint8Array[]
}

function planSpans(size: number, align = 1): Span[] {
  let piece = Math.floor(size / (CONNECTIONS * 4))
  if (piece < MIN_PIECE) piece = Math.min(size, MIN_PIECE)
  if (align > 1) {
    piece -= piece % align
    if (piece < align) piece = align
  }
  const spans: Span[] = []
  for (let start = 0; start < size; ) {
    let end = Math.min(size, start + piece)
    if (align > 1 && end < size) {
      const aligned = end - ((end - start) % align)
      if (aligned > start) end = aligned
    }
    spans.push({ start, end, next: start, chunks: [] })
    start = end
  }
  return spans
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

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

type Range = { offset: number; length: number }

type Part = {
  uri: string
  range?: Range
  map?: boolean
  decrypt?: { uri: string; iv: Uint8Array }
}

type Sink = {
  write: (data: Uint8Array, position?: number) => Promise<void>
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

function totalFromContentRange(header: string | null): number {
  const matched = header?.match(/\/(\d+)\s*$/)
  const total = Number(matched?.[1] || 0)
  return Number.isFinite(total) ? total : 0
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

async function readPart(
  part: Part,
  signal: AbortSignal,
  onBytes: (delta: number, size: number) => void,
): Promise<Uint8Array> {
  const headers: HeadersInit = {}
  if (part.range) headers.Range = `bytes=${part.range.offset}-${part.range.offset + part.range.length - 1}`
  const response = await fetch(part.uri, { signal, headers })
  if (!response.ok && response.status !== 206) throw new Error('片段没有回应')
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > 0) onBytes(0, declared)
  const chunks: Uint8Array[] = []
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    onBytes(bytes.byteLength, declared || bytes.byteLength)
    chunks.push(bytes)
  } else {
    const reader = response.body.getReader()
    while (true) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      onBytes(step.value.byteLength, declared)
    }
  }
  let data = concat(chunks)
  if (part.range && response.status === 200 && data.byteLength > part.range.length) {
    data = data.slice(part.range.offset, part.range.offset + part.range.length)
  }
  if (!part.decrypt) return data
  const key = await cryptoKey(part.decrypt.uri, signal)
  const cipher = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const iv = part.decrypt.iv.buffer.slice(
    part.decrypt.iv.byteOffset,
    part.decrypt.iv.byteOffset + part.decrypt.iv.byteLength,
  ) as ArrayBuffer
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, cipher)
  return new Uint8Array(plain)
}

async function fetchPart(part: Part, signal: AbortSignal, onBytes: (delta: number, size: number) => void): Promise<Uint8Array> {
  let reported = 0
  const note = (delta: number, size: number) => {
    reported += delta
    onBytes(delta, size)
  }
  const undo = () => {
    if (!reported) return
    onBytes(-reported, 0)
    reported = 0
  }
  try {
    return await readPart(part, signal, note)
  } catch (error) {
    undo()
    if (signal.aborted) throw error
    try {
      return await readPart(part, signal, note)
    } catch (retryError) {
      undo()
      throw retryError
    }
  }
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

type WriteData = Uint8Array | { type: 'write'; position: number; data: Uint8Array }

type SaveHandle = {
  createWritable: () => Promise<{
    write: (data: WriteData) => Promise<void>
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

function serializeSink(sink: Sink): Sink {
  let chain = Promise.resolve()
  const enqueue = <T>(run: () => Promise<T>) => {
    const result = chain.then(run)
    chain = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  return {
    write: (data, position) => enqueue(() => sink.write(data, position)),
    close: () => enqueue(() => sink.close()),
    abort: () => enqueue(() => sink.abort()),
  }
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
      return serializeSink({
        write: async (data, position) => {
          if (position === undefined) await writable.write(data)
          else await writable.write({ type: 'write', position, data })
        },
        close: () => writable.close(),
        abort: () => writable.abort(),
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new DownloadCancelled()
    }
  }
  const stored: { at: number; data: Uint8Array }[] = []
  let cursor = 0
  return serializeSink({
    write: async (data, position) => {
      const at = position ?? cursor
      cursor = Math.max(cursor, at + data.byteLength)
      stored.push({ at, data })
    },
    close: async () => {
      stored.sort((left, right) => left.at - right.at)
      const blob = new Blob(
        stored.map((item) => item.data),
        { type: mime },
      )
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
      stored.length = 0
    },
  })
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

function isPlaylist(url: string, type: string): boolean {
  return url.includes('.m3u8') || type.includes('mpegurl') || type.includes('m3u8')
}

function isTransportStream(url: string, type: string): boolean {
  return type.includes('mp2t') || /\.ts(?:$|[?#])/i.test(url)
}

function outputFile(url: string): { ext: string; mime: string } {
  const path = url.split(/[?#]/)[0].toLowerCase()
  if (path.endsWith('.webm')) return { ext: 'webm', mime: 'video/webm' }
  if (path.endsWith('.mkv')) return { ext: 'mkv', mime: 'video/x-matroska' }
  return { ext: 'mp4', mime: 'video/mp4' }
}

async function partsFromPlaylist(raw: string, responseUrl: string, requestUrl: string, signal: AbortSignal): Promise<Part[]> {
  if (!raw.includes('#EXTM3U')) throw new Error('播放列表无效')
  const upstream = upstreamFromPlay(responseUrl) || upstreamFromPlay(requestUrl) || requestUrl
  const text = rewritePlaylist(raw, upstream)
  if (text.includes('#EXT-X-STREAM-INF')) return mediaParts(chooseVariant(text, upstream), signal)
  return parseMediaPlaylist(text, upstream)
}

async function runPool(
  count: number,
  signal: AbortSignal,
  gate: Gate,
  task: (index: number, signal: AbortSignal) => Promise<void>,
) {
  if (!count) return
  const queue = Array.from({ length: count }, (_, index) => index)
  let failed: unknown = null
  const stop = linkStop(signal)
  const workers = Array.from({ length: Math.min(CONNECTIONS, count) }, async () => {
    while (!failed) {
      try {
        await gate.checkpoint(stop.signal)
      } catch (error) {
        if (failed || signal.aborted) return
        throw error
      }
      if (failed || signal.aborted) return
      const index = queue.shift()
      if (index === undefined) return
      const local = gate.fork(stop.signal)
      try {
        await task(index, local)
      } catch (error) {
        if (signal.aborted || failed || stop.signal.aborted) {
          failed = failed || error
          return
        }
        if (gate.paused || local.aborted) {
          queue.unshift(index)
          continue
        }
        failed = error
        stop.abort()
        return
      }
    }
  })
  try {
    await Promise.all(workers)
  } catch (error) {
    if (failed) throw failed
    throw error
  } finally {
    stop.unlink()
    stop.abort()
  }
  if (failed) throw failed
}

async function downloadOrdered(
  count: number,
  signal: AbortSignal,
  gate: Gate,
  task: (index: number, signal: AbortSignal) => Promise<Uint8Array>,
  consume: (index: number, bytes: Uint8Array) => Promise<void>,
) {
  if (!count) return
  const windowSize = CONNECTIONS * 2
  const queue = Array.from({ length: count }, (_, index) => index)
  const ready = new Map<number, Uint8Array>()
  let nextWrite = 0
  let active = 0
  let failed: unknown = null
  const wake = createWake()
  const stop = linkStop(signal)

  const take = (): number | undefined | null => {
    const index = queue.findIndex((item) => item < nextWrite + windowSize)
    if (index < 0) return queue.length ? null : undefined
    return queue.splice(index, 1)[0]
  }

  const workers = Array.from({ length: Math.min(CONNECTIONS, count) }, async () => {
    while (!failed) {
      try {
        await gate.checkpoint(stop.signal)
      } catch (error) {
        if (failed || signal.aborted) return
        throw error
      }
      if (failed || signal.aborted) return
      const job = take()
      if (job === undefined) {
        if (active === 0) return
        await wake.wait(stop.signal)
        continue
      }
      if (job === null) {
        await wake.wait(stop.signal)
        continue
      }
      active += 1
      const local = gate.fork(stop.signal)
      try {
        const bytes = await task(job, local)
        if (!failed) ready.set(job, bytes)
      } catch (error) {
        if (signal.aborted || stop.signal.aborted) failed = failed || error
        else if (gate.paused || local.aborted) queue.unshift(job)
        else {
          failed = error
          stop.abort()
        }
      } finally {
        active -= 1
        wake.wake()
      }
    }
  })

  const writer = (async () => {
    while (nextWrite < count) {
      const bytes = ready.get(nextWrite)
      if (!bytes) {
        if (failed && active === 0) throw failed
        await wake.wait(stop.signal)
        continue
      }
      ready.delete(nextWrite)
      try {
        await consume(nextWrite, bytes)
      } catch (error) {
        failed = error
        stop.abort()
        throw error
      }
      nextWrite += 1
      wake.wake()
    }
  })()

  try {
    await Promise.all([...workers, writer])
  } catch (error) {
    failed = failed || error
    wake.wake()
    throw failed
  } finally {
    stop.unlink()
    stop.abort()
  }
  if (failed) throw failed
}

async function pullRange(
  url: string,
  span: Span,
  signal: AbortSignal,
  onChunk: (chunk: Uint8Array, offset: number) => Promise<void>,
  onBytes: (size: number) => void,
) {
  let failures = 0
  while (span.next < span.end) {
    const before = span.next
    try {
      const response = await fetch(url, {
        signal,
        headers: { Range: `bytes=${span.next}-${span.end - 1}` },
      })
      if (response.status !== 206) throw new Error('视频没有回应')
      if (!response.body) throw new Error('视频没有回应')
      const reader = response.body.getReader()
      while (span.next < span.end) {
        const step = await reader.read()
        if (step.done) break
        let chunk = step.value
        const room = span.end - span.next
        if (chunk.byteLength > room) chunk = chunk.subarray(0, room)
        await onChunk(chunk, span.next)
        span.next += chunk.byteLength
        onBytes(chunk.byteLength)
      }
      if (span.next >= span.end) return
      if (span.next === before) {
        failures += 1
        if (failures > 2) throw new Error('视频没有回应')
      } else failures = 0
    } catch (error) {
      if (signal.aborted) throw error
      failures += 1
      if (failures > 2) throw error instanceof Error ? error : new Error('视频没有回应')
    }
  }
}

type Probe = {
  response: Response | null
  size: number
  ranged: boolean
  type: string
  playlist: string
  playlistUrl: string
}

function responseProbe(response: Response, playlist = ''): Probe {
  return {
    response,
    size: Number(response.headers.get('content-length') || 0),
    ranged: false,
    type: (response.headers.get('content-type') || '').toLowerCase(),
    playlist,
    playlistUrl: playlist ? response.url : '',
  }
}

async function probe(url: string, signal: AbortSignal, gate: Gate): Promise<Probe> {
  await gate.checkpoint(signal)
  try {
    const ranged = await fetch(url, { signal, headers: { Range: 'bytes=0-0' } })
    const type = (ranged.headers.get('content-type') || '').toLowerCase()
    if (!ranged.ok && ranged.status !== 206) throw new Error('视频没有回应')
    if (isPlaylist(url, type)) {
      if (ranged.status === 206) {
        await ranged.body?.cancel()
        return { response: null, size: 0, ranged: false, type, playlist: '', playlistUrl: '' }
      }
      return { response: null, size: 0, ranged: false, type, playlist: await ranged.text(), playlistUrl: ranged.url }
    }
    if (ranged.status === 206) {
      const size = totalFromContentRange(ranged.headers.get('content-range'))
      await ranged.body?.cancel()
      if (size > 0) return { response: null, size, ranged: true, type, playlist: '', playlistUrl: '' }
    } else {
      return responseProbe(ranged)
    }
  } catch (error) {
    if (signal.aborted) throw error
  }
  const full = await fetch(url, { signal })
  if (!full.ok || !full.body) throw new Error('视频没有回应')
  const type = (full.headers.get('content-type') || '').toLowerCase()
  if (isPlaylist(url, type)) {
    return { response: null, size: 0, ranged: false, type, playlist: await full.text(), playlistUrl: full.url }
  }
  return responseProbe(full)
}

async function streamBody(response: Response, signal: AbortSignal, gate: Gate, tracker: Tracker, onChunk: (chunk: Uint8Array) => Promise<void>) {
  if (!response.body) throw new Error('视频没有回应')
  const total = Number(response.headers.get('content-length') || 0)
  if (total > 0) tracker.setTotal(total)
  const reader = response.body.getReader()
  while (true) {
    await gate.checkpoint(signal)
    const step = await reader.read()
    if (step.done) break
    await onChunk(step.value)
    tracker.add(step.value.byteLength)
  }
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

const MEDIA_SAMPLE = 8 * 1024

function estimateTotal(sizes: number[], parts: Part[]): number {
  let known = 0
  let sample = 0
  let sampleCount = 0
  let unknown = 0
  for (let index = 0; index < parts.length; index += 1) {
    const size = sizes[index] || 0
    if (size > 0) {
      known += size
      if (!parts[index]?.map && size >= MEDIA_SAMPLE) {
        sample += size
        sampleCount += 1
      }
    } else unknown += 1
  }
  if (!known || (unknown > 0 && !sampleCount)) return 0
  if (!unknown) return known
  return known + (unknown * sample) / sampleCount
}

function notePart(sizes: number[], parts: Part[], tracker: Tracker, index: number, delta: number, declared: number) {
  if (declared > 0) sizes[index] = declared
  if (delta) tracker.add(delta)
  const estimate = estimateTotal(sizes, parts)
  if (estimate > 0) tracker.setTotal(estimate)
}

async function writeParts(sink: Sink, parts: Part[], signal: AbortSignal, gate: Gate, tracker: Tracker) {
  const sizes = new Array<number>(parts.length).fill(0)
  await downloadOrdered(
    parts.length,
    signal,
    gate,
    (index, local) => fetchPart(parts[index], local, (delta, size) => notePart(sizes, parts, tracker, index, delta, size)),
    async (_index, bytes) => {
      if (!sizes[_index]) {
        sizes[_index] = bytes.byteLength
        const estimate = estimateTotal(sizes, parts)
        if (estimate > 0) tracker.setTotal(estimate)
      }
      await sink.write(bytes)
    },
  )
}

async function writeTransmuxed(sink: Sink, parts: Part[], signal: AbortSignal, gate: Gate, tracker: Tracker) {
  const sizes = new Array<number>(parts.length).fill(0)
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
  await downloadOrdered(
    parts.length,
    signal,
    gate,
    (index, local) => fetchPart(parts[index], local, (delta, size) => notePart(sizes, parts, tracker, index, delta, size)),
    async (_index, bytes) => {
      if (!sizes[_index]) {
        sizes[_index] = bytes.byteLength
        const estimate = estimateTotal(sizes, parts)
        if (estimate > 0) tracker.setTotal(estimate)
      }
      transmuxer.push(alignTs(bytes))
      transmuxer.flush()
      while (pending.length) {
        const piece = pending.shift()
        if (piece) await sink.write(piece)
      }
    },
  )
  if (!wroteInit) throw new Error('这段视频暂时不能保存成 mp4')
}

async function saveParts(parts: Part[], sink: Sink, signal: AbortSignal, gate: Gate, tracker: Tracker) {
  if (isFmp4(parts)) await writeParts(sink, parts, signal, gate, tracker)
  else await writeTransmuxed(sink, parts, signal, gate, tracker)
}

async function downloadByteSpans(url: string, spans: Span[], signal: AbortSignal, gate: Gate, sink: Sink, tracker: Tracker) {
  await runPool(spans.length, signal, gate, async (index, local) => {
    const span = spans[index]
    await pullRange(
      url,
      span,
      local,
      async (chunk, offset) => {
        await sink.write(chunk, offset)
      },
      (size) => tracker.add(size),
    )
  })
}

async function downloadTsSpans(url: string, spans: Span[], signal: AbortSignal, gate: Gate, sink: Sink, tracker: Tracker) {
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
  await downloadOrdered(
    spans.length,
    signal,
    gate,
    async (index, local) => {
      const span = spans[index]
      await pullRange(
        url,
        span,
        local,
        async (chunk) => {
          span.chunks.push(chunk)
        },
        (size) => tracker.add(size),
      )
      const data = concat(span.chunks)
      span.chunks = []
      return data
    },
    async (index, bytes) => {
      transmuxer.push(index === 0 ? alignTs(bytes) : bytes)
      transmuxer.flush()
      while (pending.length) {
        const piece = pending.shift()
        if (piece) await sink.write(piece)
      }
    },
  )
  if (!wroteInit) throw new Error('这段视频暂时不能保存成 mp4')
}

async function downloadDirect(url: string, sink: Sink, signal: AbortSignal, gate: Gate, tracker: Tracker) {
  const found = await probe(url, signal, gate)
  if (found.playlist) {
    const parts = await partsFromPlaylist(found.playlist, found.playlistUrl, url, signal)
    await saveParts(parts, sink, signal, gate, tracker)
    return
  }
  if (isPlaylist(url, found.type)) {
    const parts = await mediaParts(url, signal)
    await saveParts(parts, sink, signal, gate, tracker)
    return
  }
  if (found.ranged && found.size > 0) {
    tracker.setTotal(found.size)
    const align = isTransportStream(url, found.type) ? TS_PACKET : 1
    const spans = planSpans(found.size, align)
    if (isTransportStream(url, found.type)) await downloadTsSpans(url, spans, signal, gate, sink, tracker)
    else await downloadByteSpans(url, spans, signal, gate, sink, tracker)
    return
  }
  if (!found.response) throw new Error('视频没有回应')
  if (isTransportStream(url, found.type)) {
    const chunks: Uint8Array[] = []
    await streamBody(found.response, signal, gate, tracker, async (chunk) => {
      chunks.push(chunk)
    })
    const pieces = transmuxTs(chunks)
    for (const piece of pieces) await sink.write(piece)
    return
  }
  await streamBody(found.response, signal, gate, tracker, async (chunk) => {
    await sink.write(chunk)
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
  const tracker = createTracker(onProgress)
  tracker.open()
  const file = outputFile(url)
  const sink = await openSink(filename, file.ext, file.mime)
  await withSink(sink, async () => {
    if (url.includes('.m3u8')) {
      const parts = await mediaParts(url, signal)
      await saveParts(parts, sink, signal, gate, tracker)
      return
    }
    await downloadDirect(url, sink, signal, gate, tracker)
  })
  tracker.finish()
}
