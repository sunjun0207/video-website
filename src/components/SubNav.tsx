import type { Route } from '../lib/route'

const items: { href: string; label: string; names: Route['name'][] }[] = [
  { href: '#/discover', label: '推荐', names: ['discover'] },
  { href: '#/toplist', label: '排行榜', names: ['toplist'] },
  { href: '#/lists', label: '片单', names: ['lists', 'list'] },
  { href: '#/channels', label: '频道', names: ['channels', 'channel'] },
  { href: '#/fresh', label: '最新上线', names: ['fresh'] },
]

export function SubNav({ route }: { route: Route }) {
  return (
    <nav className="subnav" aria-label="发现精彩">
      <div className="wrap subnav-inner">
        {items.map((item) => (
          <a key={item.href} href={item.href} className={item.names.includes(route.name) ? 'active' : ''}>
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  )
}
