import type Hls from 'hls.js'
import type { Fragment, FragmentLoaderContext, HlsConfig, Loader, LoaderCallbacks, LoaderConfiguration, LoaderContext } from 'hls.js'

/** 片段一段一段地拉，每段都要等一次回应。有的线路一段要等一两秒，刚好够跟上播放，稍慢一点就卡。往后多拉几段一起等。 */
const AHEAD = 3
/** 这么久还没有回应，多半是连接卡死了，重新请求。浏览器里排队的时间也算在内，不能太短。 */
const FIRST_BYTE_MS = 12_000
/** 开始回数据以后，这么久一个字节都没再来，同样重新请求。 */
const STALL_MS = 10_000
/** 一段最多请求几次，还不行就交给 hls.js 按它自己的规则重试。 */
const ATTEMPTS = 3
/** 有的节点坏了只回“OK”几个字节，不到一个 TS 包的回应不是视频。 */
const MIN_BYTES = 188

type LoaderClass = new (config: HlsConfig) => Loader<LoaderContext>

type ByteRange = [number, number]

type Loaded = {
  data: ArrayBuffer
  url: string
  start: number
  first: number
  end: number
}

type Entry = {
  sn: number
  level: number
  controller: AbortController
  promise: Promise<Loaded>
}

class LoadFailure extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
  }
}

/** 和 hls.js 自己发请求时一样：只有给了结束位置才带 Range。 */
function rangeOf(start: number | undefined, end: number | undefined): ByteRange | null {
  return end ? [start || 0, end] : null
}

function keyOf(url: string, range: ByteRange | null) {
  return range ? `${url}|${range[0]}-${range[1]}` : url
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      window.clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function readBody(response: Response, onChunk: () => void): Promise<ArrayBuffer> {
  const reader = response.body?.getReader()
  if (!reader) return response.arrayBuffer()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    onChunk()
  }
  const data = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data.buffer
}

async function fetchOnce(url: string, range: ByteRange | null, signal: AbortSignal, priority: RequestPriority): Promise<Loaded> {
  const local = new AbortController()
  const stop = () => local.abort()
  signal.addEventListener('abort', stop, { once: true })
  const start = performance.now()
  let first = 0
  let last = start
  let stalled = false
  const watchdog = window.setInterval(() => {
    if (performance.now() - last < (first ? STALL_MS : FIRST_BYTE_MS)) return
    stalled = true
    local.abort()
  }, 1000)
  try {
    const response = await fetch(url, {
      headers: range ? { Range: `bytes=${range[0]}-${range[1] - 1}` } : undefined,
      signal: local.signal,
      priority,
    })
    first = last = performance.now()
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      throw new LoadFailure(response.status, `HTTP ${response.status}`)
    }
    const data = await readBody(response, () => {
      last = performance.now()
    })
    if (data.byteLength < MIN_BYTES) throw new LoadFailure(502, '片段内容不完整')
    return { data, url: response.url || url, start, first, end: performance.now() }
  } catch (error) {
    if (stalled && !signal.aborted) throw new LoadFailure(0, '片段长时间没有回应')
    throw error
  } finally {
    window.clearInterval(watchdog)
    signal.removeEventListener('abort', stop)
  }
}

async function fetchSegment(url: string, range: ByteRange | null, signal: AbortSignal, priority: RequestPriority): Promise<Loaded> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fetchOnce(url, range, signal, priority)
    } catch (error) {
      const code = error instanceof LoadFailure ? error.code : 0
      const lasting = code >= 400 && code < 500 && code !== 408 && code !== 429
      if (signal.aborted || lasting || attempt >= ATTEMPTS) throw error
      await pause(attempt * 600, signal)
    }
  }
}

export type SegmentPrefetch = {
  Loader: new (config: HlsConfig) => Loader<FragmentLoaderContext>
  dispose: () => void
}

/**
 * 给 hls.js 用的片段加载器：hls.js 要第 N 段时，把后面几段也一起请求着，轮到它们时多半已经拉好了。
 * 只管主画面的点播片段；初始化段、分片、直播仍走原来的加载器。
 */
export function createSegmentPrefetch(Base: LoaderClass, owner: () => Hls | undefined, mapUrl: (url: string) => string): SegmentPrefetch {
  const entries = new Map<string, Entry>()

  const drop = (key: string) => {
    const entry = entries.get(key)
    if (!entry) return
    entries.delete(key)
    entry.controller.abort()
  }

  const begin = (key: string, sn: number, level: number, url: string, range: ByteRange | null, priority: RequestPriority) => {
    const controller = new AbortController()
    const promise = fetchSegment(url, range, controller.signal, priority)
    const entry: Entry = { sn, level, controller, promise }
    entries.set(key, entry)
    promise.catch(() => {
      if (entries.get(key) === entry) entries.delete(key)
    })
    return entry
  }

  const detailsOf = (frag: Fragment) => {
    const details = owner()?.levels[frag.level]?.details
    return details && !details.live ? details : null
  }

  /** 只留第 sn 段和它后面几段；跳转、换清晰度以后，之前提前拉的就停掉。 */
  const keepAround = (sn: number, level: number) => {
    for (const [key, entry] of entries) {
      if (entry.level !== level || entry.sn < sn || entry.sn > sn + AHEAD) drop(key)
    }
  }

  const prefetchAfter = (frag: Fragment, sn: number) => {
    const details = detailsOf(frag)
    if (!details) return
    const list = details.fragments
    let index = sn - details.startSN
    if (list[index]?.sn !== sn) index = list.findIndex((item) => item.sn === sn)
    if (index < 0) return
    for (const next of list.slice(index + 1, index + 1 + AHEAD)) {
      if (next.gap) continue
      const url = mapUrl(next.url)
      const range = rangeOf(next.byteRangeStartOffset, next.byteRangeEndOffset)
      const key = keyOf(url, range)
      if (!entries.has(key)) begin(key, next.sn, next.level, url, range, 'auto')
    }
  }

  class SegmentLoader extends Base {
    private hooks: LoaderCallbacks<LoaderContext> | null = null
    private release: (() => void) | null = null

    load(context: LoaderContext, config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
      const { frag, part } = context as Partial<FragmentLoaderContext>
      const sn = frag?.sn
      if (!frag || typeof sn !== 'number' || String(frag.type) !== 'main' || part || !detailsOf(frag)) {
        super.load(context, config, callbacks)
        return
      }
      const stats = this.stats
      if (stats.loading.start) throw new Error('Loader can only be used once.')
      stats.loading.start = performance.now()
      this.context = context
      this.hooks = callbacks
      const url = mapUrl(context.url)
      const range = rangeOf(context.rangeStart, context.rangeEnd)
      const key = keyOf(url, range)
      keepAround(sn, frag.level)

      let settled = false
      const timer = window.setTimeout(() => {
        if (settled) return
        settled = true
        this.release = null
        drop(key)
        stats.loading.end = performance.now()
        callbacks.onTimeout(stats, context, null)
      }, config.loadPolicy.maxLoadTimeMs || config.timeout)
      const finish = () => {
        settled = true
        this.release = null
        window.clearTimeout(timer)
      }
      this.release = finish

      const wait = (entry: Entry, early: boolean) => {
        entry.promise.then(
          (loaded) => {
            if (settled) return
            finish()
            if (entries.get(key) === entry) entries.delete(key)
            stats.loading.start = Math.min(stats.loading.start, loaded.start)
            stats.loading.first = Math.max(loaded.first, stats.loading.start)
            stats.loading.end = Math.max(loaded.end, stats.loading.first)
            stats.loaded = stats.total = loaded.data.byteLength
            if (!early) prefetchAfter(frag, sn)
            callbacks.onSuccess({ url: loaded.url, data: loaded.data }, stats, context, null)
          },
          (error: unknown) => {
            if (settled) return
            // 提前拉的那次失败了，可能是好一阵之前的事，先马上重拉一次，再不行才报给 hls.js。
            if (early) {
              wait(begin(key, sn, frag.level, url, range, 'high'), false)
              return
            }
            finish()
            stats.loading.end = performance.now()
            const code = error instanceof LoadFailure ? error.code : 0
            const text = error instanceof Error ? error.message : String(error)
            callbacks.onError({ code, text }, context, null, stats)
          },
        )
      }

      const early = entries.get(key)
      if (early) {
        prefetchAfter(frag, sn)
        wait(early, true)
      } else {
        wait(begin(key, sn, frag.level, url, range, 'high'), false)
      }
    }

    abort() {
      if (!this.release) {
        super.abort()
        return
      }
      this.release()
      this.stats.aborted = true
      this.hooks?.onAbort?.(this.stats, this.context as LoaderContext, null)
    }

    destroy() {
      this.release?.()
      this.hooks = null
      super.destroy()
    }
  }

  return {
    Loader: SegmentLoader as unknown as SegmentPrefetch['Loader'],
    dispose: () => {
      for (const key of [...entries.keys()]) drop(key)
    },
  }
}
