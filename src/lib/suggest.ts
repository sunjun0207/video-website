import { useEffect, useState } from 'react'
import { suggestTitles, type SuggestHit } from './api'
import { ensureLibrary, searchRemote } from './source'

function mergeHits(remote: SuggestHit[], local: SuggestHit[], limit: number): SuggestHit[] {
  const hits: SuggestHit[] = []
  const push = (hit: SuggestHit) => {
    const title = hit.title.trim()
    if (!title || hits.some((item) => item.title === title)) return
    hits.push({ title, hint: hit.hint })
  }
  for (const hit of remote) push(hit)
  for (const hit of local) push(hit)
  return hits.slice(0, limit)
}

export function useLiveSuggest(keyword: string, active: boolean) {
  const [suggests, setSuggests] = useState<SuggestHit[]>([])
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const q = keyword.trim()
    if (!active || !q) {
      setSuggests([])
      setPending(false)
      return
    }
    let live = true
    let remoteReady = false
    const applyLocal = () => {
      if (!live || remoteReady) return
      setSuggests(suggestTitles(q))
    }
    applyLocal()
    setPending(true)
    void ensureLibrary().then(applyLocal).catch(() => {})
    const timer = window.setTimeout(() => {
      void searchRemote(q)
        .then((list) => {
          if (!live) return
          remoteReady = true
          const remote = list.slice(0, 8).map((item) => ({
            title: item.title,
            hint: [item.year || '', item.updateText].filter(Boolean).join(' · '),
          }))
          setSuggests(mergeHits(remote, suggestTitles(q), 8))
        })
        .catch(() => {})
        .finally(() => {
          if (live) setPending(false)
        })
    }, 280)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [keyword, active])

  return { suggests, pending }
}
