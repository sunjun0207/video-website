import { CatalogGate } from '../components/CatalogGate'
import { PosterGrid } from '../components/PosterGrid'
import { channelFacets, channelName, queryChannel } from '../lib/api'
import { channelHash, type Route } from '../lib/route'
import type { ChannelId, SortKey } from '../lib/types'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'hot', label: '热度' },
  { id: 'new', label: '最新' },
  { id: 'score', label: '高分' },
]

export function ChannelPage({ route }: { route: Route }) {
  const channel = route.id as ChannelId
  return (
    <CatalogGate>
      <ChannelBody channel={channel} route={route} />
    </CatalogGate>
  )
}

function ChannelBody({ channel, route }: { channel: ChannelId; route: Route }) {
  const facets = channelFacets(channel)
  const items = queryChannel({
    channel,
    genre: route.genre,
    region: route.region,
    year: route.year,
    sort: route.sort,
  })
  return (
    <>
      <header className="page-intro">
        <p className="crumb">
          <a href="#/channels">频道</a>
          <span>/</span>
          <em>{channelName(channel)}</em>
        </p>
        <h1>{channelName(channel)}</h1>
        <p>共 {items.length} 部。筛选项来自当前片库。</p>
      </header>
      <FilterRow
        label="类型"
        value={route.genre}
        options={['全部', ...facets.genres]}
        hrefFor={(value) => channelHash(channel, { ...route, genre: value })}
      />
      <FilterRow
        label="地区"
        value={route.region}
        options={['全部', ...facets.regions]}
        hrefFor={(value) => channelHash(channel, { ...route, region: value })}
      />
      <FilterRow
        label="年份"
        value={route.year}
        options={['全部', ...facets.years]}
        hrefFor={(value) => channelHash(channel, { ...route, year: value })}
      />
      <div className="filter-row">
        <span>排序</span>
        <div className="chips">
          {SORTS.map((item) => (
            <a
              key={item.id}
              className={route.sort === item.id ? 'chip active' : 'chip'}
              href={channelHash(channel, { ...route, sort: item.id })}
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
      <PosterGrid items={items} />
    </>
  )
}

function FilterRow({
  label,
  value,
  options,
  hrefFor,
}: {
  label: string
  value: string
  options: string[]
  hrefFor: (value: string) => string
}) {
  if (options.length <= 1) return null
  return (
    <div className="filter-row">
      <span>{label}</span>
      <div className="chips">
        {options.map((option) => (
          <a key={option} className={option === value ? 'chip active' : 'chip'} href={hrefFor(option)}>
            {option}
          </a>
        ))}
      </div>
    </div>
  )
}
