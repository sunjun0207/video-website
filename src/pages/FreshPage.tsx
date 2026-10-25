import { CatalogGate } from '../components/CatalogGate'
import { PosterGrid } from '../components/PosterGrid'
import { freshVideos } from '../lib/api'

export function FreshPage() {
  return (
    <CatalogGate>
      <FreshBody />
    </CatalogGate>
  )
}

function FreshBody() {
  return (
    <>
      <header className="page-intro">
        <h1>新片</h1>
        <p>按年份从近到远排开。年份未知的片子会跟在后面。</p>
      </header>
      <PosterGrid items={freshVideos()} />
    </>
  )
}
