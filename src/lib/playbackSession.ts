export type PlaybackSnapshot = {
  playing: boolean
  current: number
  duration: number
  /** 0 到 1，静音时仍保留拖动前的音量。 */
  volume: number
  muted: boolean
  loop: boolean
}

type Controls = {
  toggle: () => void
  pause: () => void
  seek: (seconds: number) => void
  setVolume: (value: number) => void
  toggleMute: () => void
  toggleLoop: () => void
}

let snapshot: PlaybackSnapshot | null = null
let controls: Controls | null = null
let queued = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function publishPlayback(next: PlaybackSnapshot | null, immediate = false) {
  const changed =
    Boolean(snapshot?.playing) !== Boolean(next?.playing) ||
    Boolean(snapshot?.muted) !== Boolean(next?.muted) ||
    Boolean(snapshot?.loop) !== Boolean(next?.loop) ||
    (snapshot?.volume ?? 1) !== (next?.volume ?? 1)
  snapshot = next
  if (next === null || immediate || changed) {
    window.clearTimeout(queued)
    queued = 0
    emit()
    return
  }
  if (queued) return
  queued = window.setTimeout(() => {
    queued = 0
    emit()
  }, 250)
}

export function bindPlayback(next: Controls | null) {
  controls = next
}

export function playbackSnapshot() {
  return snapshot
}

export function togglePlayback() {
  controls?.toggle()
}

export function pausePlayback() {
  controls?.pause()
}

export function seekPlayback(seconds: number) {
  if (!Number.isFinite(seconds)) return
  controls?.seek(Math.max(0, seconds))
}

export function setVolumePlayback(value: number) {
  if (!Number.isFinite(value)) return
  controls?.setVolume(value)
}

export function toggleMutePlayback() {
  controls?.toggleMute()
}

export function toggleLoopPlayback() {
  controls?.toggleLoop()
}

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
