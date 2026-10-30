import { CatalogGate } from '../components/CatalogGate'
import { listByChannel } from '../lib/api'
import { CHANNELS } from '../lib/catalog'

export function ChannelsPage() {
  return (
    <CatalogGate>
      <ChannelsBody />
    </CatalogGate>
  )
}

function ChannelsBody() {
  return (
    <>
      <header className="page-intro">
        <h1>频道</h1>
        <p>电影、连续剧、动漫、综艺纪录、短剧，总有一款对你胃口。点进去还能按类型、地区、年份挑一挑。</p>
      </header>
      <div className="channel-grid">
        {CHANNELS.map((channel) => {
          const count = listByChannel(channel.id).length
          return (
            <a key={channel.id} className="channel-card" href={`#/channel/${channel.id}`}>
              <p className="kicker">频道</p>
              <h2>{channel.name}</h2>
              <p>{channel.text}</p>
              <span>{count} 部</span>
            </a>
          )
        })}
      </div>
    </>
  )
}
