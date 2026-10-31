import { useEffect, useState } from 'react'
import { rankVideos } from '../lib/api'
import { ensureLibrary, onCatalogChange } from '../lib/source'

const HOT_SIZE = 10

function useHotBoard() {
  const [titles, setTitles] = useState<{ id: string; title: string }[]>([])
  useEffect(() => {
    const sync = () => setTitles(rankVideos(HOT_SIZE).map((item) => ({ id: item.id, title: item.title })))
    sync()
    const stop = onCatalogChange(sync)
    void ensureLibrary()
      .then(sync)
      .catch(() => undefined)
    return stop
  }, [])
  return titles
}

export function SearchBrowse({
  history = [],
  onPick,
  onClear,
  showHistory = true,
}: {
  history?: string[]
  onPick: (keyword: string) => void
  onClear?: () => void
  showHistory?: boolean
}) {
  const hot = useHotBoard()
  return (
    <div className={showHistory ? 'search-browse' : 'search-browse is-hot'}>
      {showHistory ? (
        <section>
          <header>
            <h2>搜索历史</h2>
            {history.length && onClear ? (
              <button type="button" onClick={onClear}>
                清空
              </button>
            ) : null}
          </header>
          {history.length ? (
            <div className="chips">
              {history.map((item) => (
                <button key={item} type="button" className="chip" onClick={() => onPick(item)}>
                  {item}
                </button>
              ))}
            </div>
          ) : (
            <p className="search-browse-empty">还没有搜索记录</p>
          )}
        </section>
      ) : null}
      <section>
        <header>
          <h2>热搜榜</h2>
        </header>
        {hot.length ? (
          <ol>
            {hot.map((item, index) => (
              <li key={item.id} className={index < 3 ? 'is-top' : undefined}>
                <button type="button" onClick={() => onPick(item.title)}>
                  <em>{index + 1}</em>
                  <span>{item.title}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="search-browse-empty">热搜正在赶来…</p>
        )}
      </section>
    </div>
  )
}
