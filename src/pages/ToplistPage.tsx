import { CatalogGate } from '../components/CatalogGate'
import { PosterFace } from '../components/Poster'
import { channelName, rankVideos } from '../lib/api'
import { CHARTS } from '../lib/catalog'

export function ToplistPage({ id }: { id?: string }) {
  const current = CHARTS.find((item) => item.id === id) ?? CHARTS[0]
  return (
    <CatalogGate>
      <ToplistBody id={current.id} title={current.title} desc={current.desc} />
    </CatalogGate>
  )
}

function ToplistBody({ id, title, desc }: { id: 'hot' | 'new' | 'score'; title: string; desc: string }) {
  const videos = rankVideos(30, id)
  return (
    <>
      <header className="page-intro">
        <h1>排行榜</h1>
        <p>爆款热播、高分推荐、最新上线，三张榜单帮你找到下一部心头好。</p>
      </header>
      <div className="toplist-layout">
        <aside className="side-list">
          {CHARTS.map((chart) => (
            <a key={chart.id} href={`#/toplist/${chart.id}`} className={chart.id === id ? 'active' : ''}>
              {chart.title}
            </a>
          ))}
        </aside>
        <div>
          <div className="detail-head chart-head">
            <div>
              <p className="kicker">榜单</p>
              <h2>{title}</h2>
              <p>{desc}</p>
              <p className="meta">{videos.length} 部</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="rank-table">
              <thead>
                <tr>
                  <th>序</th>
                  <th>影片</th>
                  <th className="hide-sm">频道</th>
                  <th>分数</th>
                </tr>
              </thead>
              <tbody>
                {videos.map((item, index) => (
                  <tr key={item.id}>
                    <td className={index < 3 ? 'rank top' : 'rank'}>{index + 1}</td>
                    <td>
                      <a className="rank-film" href={`#/detail/${item.id}`}>
                        <PosterFace item={item} compact />
                        <span>
                          <strong>{item.title}</strong>
                          <em>{item.updateText}</em>
                        </span>
                      </a>
                    </td>
                    <td className="hide-sm">{channelName(item.channel)}</td>
                    <td>{item.score > 0 ? item.score.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
