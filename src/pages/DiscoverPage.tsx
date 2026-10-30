import { useEffect, useMemo, useState } from 'react'
import { CatalogGate } from '../components/CatalogGate'
import { Poster, usePrefetchDetail } from '../components/Poster'
import { SectionHead } from '../components/SectionHead'
import { heroVideos, homeShelves, rankVideos } from '../lib/api'
import { CHARTS } from '../lib/catalog'
import { PRODUCT } from '../lib/site'
import { getHistory, historyOf, type WatchRecord } from '../lib/storage'

const TONES = ['ink', 'teal', 'sand'] as const

function Banner() {
  const items = heroVideos()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused || items.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const timer = window.setInterval(() => {
      setIndex((value) => (value + 1) % items.length)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [paused, items.length])

  if (!items.length) return null
  const active = index % items.length

  return (
    <section
      className="banner"
      aria-roledescription="carousel"
      aria-label="推荐"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`banner-slide tone-${TONES[i % TONES.length]}${item.cover ? ' has-photo' : ''}${i === active ? ' is-on' : ''}`}
          aria-hidden={i !== active}
          style={
            item.cover
              ? { backgroundImage: `linear-gradient(100deg, rgba(11,31,36,.88) 18%, rgba(11,31,36,.28)), url(${item.cover})` }
              : undefined
          }
        >
          <div className="banner-copy">
            <p className="kicker">{item.badge || '推荐'}</p>
            <h2>{item.title}</h2>
            <p>{item.summary || item.updateText}</p>
            <a
              className={item.cover || TONES[i % TONES.length] !== 'sand' ? 'btn btn-light' : 'btn'}
              href={`#/play/${item.id}/${historyOf(item.id)?.ep ?? 0}`}
            >
              立即观看
            </a>
          </div>
          <div className="banner-frame" aria-hidden="true" />
        </div>
      ))}
      <button
        type="button"
        className="banner-arrow prev"
        aria-label="上一张"
        onClick={() => setIndex((active + items.length - 1) % items.length)}
      >
        ‹
      </button>
      <button
        type="button"
        className="banner-arrow next"
        aria-label="下一张"
        onClick={() => setIndex((active + 1) % items.length)}
      >
        ›
      </button>
      <div className="banner-dots">
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            className={i === active ? 'on' : ''}
            aria-label={`第 ${i + 1} 张`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </section>
  )
}

function RecentItem({ item }: { item: WatchRecord }) {
  const prefetch = usePrefetchDetail(item.id)
  return (
    <a className="recent-item" href={`#/play/${item.id}/${item.ep}`} {...prefetch}>
      {item.cover ? <img src={item.cover} alt="" loading="lazy" decoding="async" /> : <span />}
      <span>
        <strong>{item.title}</strong>
        <em>{item.ep > 0 ? `第 ${item.ep + 1} 集` : '正片'}</em>
      </span>
    </a>
  )
}

export function DiscoverPage({ libraryVersion }: { libraryVersion: number }) {
  return (
    <CatalogGate>
      <DiscoverBody libraryVersion={libraryVersion} />
    </CatalogGate>
  )
}

function DiscoverBody({ libraryVersion }: { libraryVersion: number }) {
  const recent = useMemo(() => getHistory().slice(0, 6), [libraryVersion])
  const shelves = homeShelves()
  return (
    <>
      <h1 className="sr-only">{PRODUCT} - 好看的，都在这里</h1>
      <div className="home-top">
        <Banner />
        <aside className="client-card">
          <p className="kicker">{PRODUCT}</p>
          <h2>
            好看的，
            <br />
            都在这里！
          </h2>
          <p>热门短剧、精彩影视、潮流视频，每一次打开都有新发现。精彩不设限，快乐不打烊。</p>
          <a className="btn btn-light" href="#/search">
            马上探索
          </a>
          <a className="text-link" href="#/guide">
            观影说明
          </a>
        </aside>
      </div>

      <section>
        <SectionHead title="最近看过" desc="接着看，精彩别错过" more="#/favorites" moreLabel="收藏" />
        {recent.length === 0 ? (
          <p className="note">还没有观看记录，去发现更多精彩吧。</p>
        ) : (
          <div className="recent-list">
            {recent.map((item) => (
              <RecentItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>

      {shelves.hot.length ? (
        <section>
          <SectionHead title="热门推荐" desc="大家都在看，精彩不容错过" more="#/toplist/hot" />
          <div className="poster-grid">
            {shelves.hot.map((item) => (
              <Poster key={item.id} item={item} />
            ))}
          </div>
        </section>
      ) : null}

      {shelves.channels.map((channel) => {
        if (!channel.items.length) return null
        return (
          <section key={channel.id}>
            <SectionHead title={channel.name} desc={channel.text} more={`#/channel/${channel.id}`} />
            <div className="poster-grid">
              {channel.items.map((item) => (
                <Poster key={item.id} item={item} />
              ))}
            </div>
          </section>
        )
      })}

      <section>
        <SectionHead title="排行榜" desc="热度、口碑、新鲜度，一榜看尽" more="#/toplist" />
        <div className="billboard">
          {CHARTS.map((chart) => (
            <div key={chart.id} className="bill-col">
              <div className="bill-head">
                <div>
                  <a href={`#/toplist/${chart.id}`}>{chart.title}</a>
                  <span>{chart.desc}</span>
                </div>
              </div>
              {rankVideos(5, chart.id).map((item, index) => (
                <a key={item.id} className="bill-row" href={`#/detail/${item.id}`}>
                  <span className={index < 3 ? 'rank top' : 'rank'}>{index + 1}</span>
                  <span className="bill-title">{item.title}</span>
                  <span className="bill-artist">{item.score > 0 ? item.score.toFixed(1) : item.updateText}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
