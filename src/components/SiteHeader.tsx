import { useEffect, useRef, useState } from 'react'
import { searchHash, type Route } from '../lib/route'
import { useLiveSuggest } from '../lib/suggest'
import { addSearchHistory, clearSearchHistory, getSearchHistory } from '../lib/storage'

const DISCOVER = new Set<Route['name']>([
  'discover',
  'toplist',
  'lists',
  'list',
  'channels',
  'channel',
  'fresh',
  'detail',
  'play',
  'search',
])

export function SiteHeader({ route }: { route: Route }) {
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState(route.name === 'search' ? route.q : '')
  const [history, setHistory] = useState<string[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [composing, setComposing] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)
  const { suggests, pending } = useLiveSuggest(keyword, suggestOpen, composing)

  useEffect(() => {
    const close = () => setOpen(false)
    window.addEventListener('hashchange', close)
    return () => window.removeEventListener('hashchange', close)
  }, [])

  useEffect(() => {
    setKeyword(route.name === 'search' ? route.q : '')
    setSuggestOpen(false)
  }, [route.key, route.name, route.q])

  useEffect(() => {
    if (suggestOpen) setHistory(getSearchHistory())
  }, [suggestOpen, route.key])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!slotRef.current?.contains(event.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [])

  const go = (value: string) => {
    const q = value.trim()
    if (!q) return
    addSearchHistory(q)
    setKeyword(q)
    setSuggestOpen(false)
    setOpen(false)
    window.location.hash = searchHash(q)
  }

  const typed = Boolean(keyword.trim())
  const panelOpen = suggestOpen && (typed ? suggests.length > 0 || pending : history.length > 0)

  return (
    <header className="site-header">
      <div className={`wrap header-inner${open ? ' open' : ''}`}>
        <a className="logo" href="#/discover">
          <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
            <rect x="4" y="8" width="28" height="20" rx="3" fill="#1aa6a0" />
            <path d="M15 13.5v9l8-4.5-8-4.5z" fill="#0b1f24" />
          </svg>
          <span className="logo-text">
            <small>观影</small>
            jun.sun
          </span>
        </a>
        <nav className="main-nav" aria-label="主导航">
          <a className={DISCOVER.has(route.name) ? 'active' : ''} href="#/discover">
            发现影片
          </a>
          <a className={route.name === 'favorites' ? 'active' : ''} href="#/favorites">
            收藏
          </a>
          <a className={route.name === 'guide' ? 'active' : ''} href="#/guide">
            观影说明
          </a>
          <a className={route.name === 'about' ? 'active' : ''} href="#/about">
            关于
          </a>
        </nav>
        <div className="search-slot" ref={slotRef}>
          <form
            className="search-form"
            role="search"
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
              placeholder="搜索片名、演员"
              aria-label="搜索"
              aria-autocomplete="list"
              aria-expanded={panelOpen}
            />
            <button type="submit">搜索</button>
          </form>
          {panelOpen ? (
            <ul className="suggest-list" role="listbox">
              {keyword.trim() ? null : (
                <li className="suggest-label">
                  <span>搜索历史</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearSearchHistory()
                      setHistory([])
                    }}
                  >
                    清空
                  </button>
                </li>
              )}
              {typed && pending && suggests.length === 0 ? (
                <li className="suggest-label suggest-pending">
                  <span className="spin" />
                  <span>正在联想…</span>
                </li>
              ) : null}
              {typed
                ? suggests.map((item) => (
                    <li key={item.title}>
                      <button type="button" role="option" onClick={() => go(item.title)}>
                        <span>{item.title}</span>
                        {item.hint ? <small>{item.hint}</small> : null}
                      </button>
                    </li>
                  ))
                : history.map((item) => (
                    <li key={item}>
                      <button type="button" role="option" onClick={() => go(item)}>
                        {item}
                      </button>
                    </li>
                  ))}
            </ul>
          ) : null}
        </div>
        <a className="header-search" href="#/search" aria-label="搜索">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
        </a>
        <button
          type="button"
          className="nav-toggle"
          aria-expanded={open}
          aria-label={open ? '关闭菜单' : '打开菜单'}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </div>
    </header>
  )
}
