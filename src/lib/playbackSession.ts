export type PlaybackSnapshot = {
  playing: boolean
  current: number
  duration: number
}

type Controls = {
  toggle: () => void
  pause: () => void
}

let snapshot: PlaybackSnapshot | null = null
let controls: Controls | null = null
let queued = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function publishPlayback(next: PlaybackSnapshot | null, immediate = false) {
  const playingChanged = Boolean(snapshot?.playing) !== Boolean(next?.playing)
  snapshot = next
  if (next === null || immediate || playingChanged) {
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

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
