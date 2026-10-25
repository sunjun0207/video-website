import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PosterGrid } from '../components/PosterGrid'
import { searchHash } from '../lib/route'
import { useLiveSuggest } from '../lib/suggest'
import { cachedSearch, searchRemote } from '../lib/source'
import { addSearchHistory, getSearchHistory, searchAnchor, setSearchAnchor } from '../lib/storage'
import type { VideoItem } from '../lib/types'

export function SearchPage({ q, libraryVersion }: { q: string; libraryVersion: number }) {
  const [items, setItems] = useState<VideoItem[] | null>(() => (q.trim() ? cachedSearch(q) ?? null : null))
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState(q)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [history, setHistory] = useState<string[]>(() => getSearchHistory())
  const boxRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { suggests, pending } = useLiveSuggest(keyword, suggestOpen)
  void libraryVersion

  useEffect(() => {
    setKeyword(q)
    setSuggestOpen(false)
    if (!q.trim()) {
      setItems(null)
      setError('')
      return
    }
    let live = true
    const known = cachedSearch(q)
    setItems(known ?? null)
    setError('')
    addSearchHistory(q)
    setHistory(getSearchHistory())
    searchRemote(q)
      .then((list) => {
        if (live) setItems(list)
      })
      .catch((reason: unknown) => {
        if (live && !known) setError(reason instanceof Error ? reason.message : '搜索暂时没有回应')
      })
    return () => {
      live = false
    }
  }, [q])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [])

  const anchorId = searchAnchor(q)

  useLayoutEffect(() => {
    if (!anchorId || !items?.some((item) => item.id === anchorId)) return
    const node = gridRef.current?.querySelector(`[data-video-id="${anchorId}"]`)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'start' })
  }, [anchorId, items])

  const typed = Boolean(keyword.trim())
  const panelOpen = suggestOpen && typed && (suggests.length > 0 || pending)

  const go = (value: string) => {
    const text = value.trim()
    if (!text) return
    setKeyword(text)
    setSuggestOpen(false)
    window.location.hash = searchHash(text)
  }

  return (
    <>
      <header className="search-hero">
        <h1>搜索</h1>
        <p>按片名或演员找。输入时会联想片名，点进去再返回会停在刚才那一条。</p>
        <div className="search-box" ref={boxRef}>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              go(keyword)
            }}
          >
            <input
              value={keyword}
              onChange={(event) => {
                setKeyword(event.target.value)
                setSuggestOpen(true)
              }}
              onFocus={() => setSuggestOpen(true)}
              placeholder="搜索片名、演员"
              aria-label="搜索"
              aria-autocomplete="list"
              aria-expanded={panelOpen}
            />
            <button className="btn" type="submit">
              搜索
            </button>
          </form>
          {panelOpen ? (
            <ul className="suggest-list" role="listbox">
              {pending && suggests.length === 0 ? (
                <li className="suggest-label">
                  <span>正在联想…</span>
                </li>
              ) : null}
              {suggests.map((item) => (
                <li key={item.title}>
                  <button type="button" role="option" onClick={() => go(item.title)}>
                    <span>{item.title}</span>
                    {item.hint ? <small>{item.hint}</small> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
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
        <section ref={gridRef}>
          {error ? <p className="note">{error}</p> : null}
          {items === null && !error ? <p className="note">正在片库里找「{q}」…</p> : null}
          {items && items.length === 0 ? <p className="note">没有找到和「{q}」有关的片子。</p> : null}
          {items && items.length > 0 ? (
            <PosterGrid
              items={items}
              anchorId={anchorId}
              onOpen={(item) => setSearchAnchor(q, item.id)}
            />
          ) : null}
        </section>
      ) : (
        <p className="note">输入一个片名，或一个忽然想起的名字。</p>
      )}
    </>
  )
}
