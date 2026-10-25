import { CatalogGate } from '../components/CatalogGate'
import { listByChannel } from '../lib/api'
import { SHELVES } from '../lib/catalog'

export function ListsPage() {
  return (
    <CatalogGate>
      <ListsBody />
    </CatalogGate>
  )
}

function ListsBody() {
  return (
    <>
      <header className="page-intro">
        <h1>片单</h1>
        <p>按心情整理的几张片单。点进去，就是这一类片子。</p>
      </header>
      <div className="shelf-grid">
        {SHELVES.map((shelf) => {
          const items = listByChannel(shelf.channel)
          const cover = items.find((item) => item.cover)?.cover
          return (
            <a key={shelf.id} className="shelf-card" href={`#/list/${shelf.id}`}>
              <div
                className="shelf-cover"
                style={
                  cover
                    ? { backgroundImage: `linear-gradient(160deg, rgba(11,31,36,.15), rgba(11,31,36,.55)), url(${cover})` }
                    : undefined
                }
              >
                <strong>{shelf.title}</strong>
                <span>{items.length} 部</span>
              </div>
              <p>{shelf.text}</p>
            </a>
          )
        })}
      </div>
    </>
  )
}
