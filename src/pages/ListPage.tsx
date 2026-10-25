import { CatalogGate } from '../components/CatalogGate'
import { EmptyState } from '../components/EmptyState'
import { PosterGrid } from '../components/PosterGrid'
import { shelfVideos } from '../lib/api'
import { SHELVES } from '../lib/catalog'

export function ListPage({ id }: { id: string }) {
  const shelf = SHELVES.find((item) => item.id === id)
  if (!shelf) {
    return <EmptyState title="没有这张片单。" href="#/lists" action="查看全部片单" />
  }
  return (
    <CatalogGate>
      <ListBody id={shelf.id} title={shelf.title} text={shelf.text} />
    </CatalogGate>
  )
}

function ListBody({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <>
      <header className="page-intro">
        <p className="crumb">
          <a href="#/lists">片单</a>
          <span>/</span>
          <em>{title}</em>
        </p>
        <h1>{title}</h1>
        <p>{text}</p>
      </header>
      <PosterGrid items={shelfVideos(id)} />
    </>
  )
}
