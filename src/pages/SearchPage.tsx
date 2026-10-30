import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { LoadingPane } from '../components/LoadingPane'
import { PosterGrid } from '../components/PosterGrid'
import { localMatches } from '../lib/api'
import { searchHash } from '../lib/route'
import { useLiveSuggest } from '../lib/suggest'
import { friendlyError } from '../lib/friendlyError'
import { cachedSearch, searchRemote } from '../lib/source'
import { addSearchHistory, getSearchHistory, searchAnchor, setSearchAnchor } from '../lib/storage'
import type { VideoItem } from '../lib/types'

export function SearchPage({ q, libraryVersion }: { q: string; libraryVersion: number }) {
  const [items, setItems] = useState<VideoItem[] | null>(() => (q.trim() ? cachedSearch(q) ?? null : null))
  const [error, setError] = useState('')
  const [keyword, setKeyword] = useState(q)
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const [history, setHistory] = useState<string[]>(() => getSearchHistory())
  const boxRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const { suggests, pending } = useLiveSuggest(keyword, suggestOpen, composing)
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
        if (live && !known) setError(friendlyError(reason, '网络开了个小差，请稍后再试。'))
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

  const local = items === null && !error ? localMatches(q) : []
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
        <p>搜一搜，发现更多精彩。片名、演员都能搜，边输入边联想。</p>
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
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onFocus={() => setSuggestOpen(true)}
              placeholder="搜一搜，发现更多精彩"
              aria-label="搜索"
              aria-autocomplete="list"
              aria-expanded={panelOpen}
            />
            <button className="btn" type="submit">
              开始探索
            </button>
          </form>
          {panelOpen ? (
            <ul className="suggest-list" role="listbox">
              {pending && suggests.length === 0 ? (
                <li className="suggest-label suggest-pending">
                  <span className="spin" />
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
          {items === null && !error && local.length ? (
            <>
              <p className="note search-pending">
                <span className="spin" />
                <span>先看看这些，正在为你搜索更多「{q}」…</span>
              </p>
              <PosterGrid items={local} onOpen={(item) => setSearchAnchor(q, item.id)} />
            </>
          ) : null}
          {items === null && !error && !local.length ? <LoadingPane kind="search" title={`正在为你搜索「${q}」…`} /> : null}
          {items && items.length === 0 ? <p className="note">没有找到「{q}」相关内容，换个关键词试试。</p> : null}
          {items && items.length > 0 ? (
            <PosterGrid
              items={items}
              anchorId={anchorId}
              onOpen={(item) => setSearchAnchor(q, item.id)}
            />
          ) : null}
        </section>
      ) : (
        <p className="note">输入片名或演员，开始探索吧。</p>
      )}
    </>
  )
}
