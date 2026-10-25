import { useEffect, useState } from 'react'
import { PosterGrid } from '../components/PosterGrid'
import { searchHash } from '../lib/route'
import { searchRemote } from '../lib/source'
import { addSearchHistory, getSearchHistory } from '../lib/storage'
import type { VideoItem } from '../lib/types'

export function SearchPage({ q, libraryVersion }: { q: string; libraryVersion: number }) {
  const [items, setItems] = useState<VideoItem[] | null>(null)
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState(q)
  const history = getSearchHistory()
  void libraryVersion

  useEffect(() => {
    setKeyword(q)
    if (!q.trim()) {
      setItems(null)
      setError('')
      return
    }
    let live = true
    setItems(null)
    setError('')
    addSearchHistory(q)
    searchRemote(q)
      .then((list) => {
        if (live) setItems(list)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '搜索暂时没有回应')
      })
    return () => {
      live = false
    }
  }, [q])

  return (
    <>
      <header className="search-hero">
        <h1>搜索</h1>
        <p>按片名或演员找。结果来自片库，点进去就能看。</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const text = keyword.trim()
            if (text) window.location.hash = searchHash(text)
          }}
        >
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索片名、演员"
            aria-label="搜索"
          />
          <button className="btn" type="submit">
            搜索
          </button>
        </form>
        {history.length ? (
          <div className="chips">
            {history.map((item) => (
              <a key={item} className="chip" href={searchHash(item)}>
                {item}
              </a>
            ))}
          </div>
        ) : null}
      </header>
      {q.trim() ? (
        <section>
          {error ? <p className="note">{error}</p> : null}
          {items === null && !error ? <p className="note">正在片库里找「{q}」…</p> : null}
          {items && items.length === 0 ? <p className="note">没有找到和「{q}」有关的片子。</p> : null}
          {items && items.length > 0 ? <PosterGrid items={items} /> : null}
        </section>
      ) : (
        <p className="note">输入一个片名，或一个忽然想起的名字。</p>
      )}
    </>
  )
}
