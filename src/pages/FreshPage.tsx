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
        <h1>最新上线</h1>
        <p>新鲜内容，抢先一步发现。刚上线的排在最前面。</p>
      </header>
      <PosterGrid items={freshVideos()} />
    </>
  )
}
