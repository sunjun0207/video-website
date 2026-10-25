import { useCallback, useEffect, useState } from 'react'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { SubNav } from './components/SubNav'
import { documentTitle } from './lib/title'
import { useRoute } from './lib/route'
import { AboutPage } from './pages/AboutPage'
import { ChannelPage } from './pages/ChannelPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { DetailPage } from './pages/DetailPage'
import { DiscoverPage } from './pages/DiscoverPage'
import { FavoritesPage } from './pages/FavoritesPage'
import { FreshPage } from './pages/FreshPage'
import { GuidePage } from './pages/GuidePage'
import { ListPage } from './pages/ListPage'
import { ListsPage } from './pages/ListsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PlayPage } from './pages/PlayPage'
import { SearchPage } from './pages/SearchPage'
import { ToplistPage } from './pages/ToplistPage'

export default function App() {
  const route = useRoute()
  const [libraryVersion, setLibraryVersion] = useState(0)
  const bump = useCallback(() => setLibraryVersion((value) => value + 1), [])

  useEffect(() => {
    document.title = documentTitle(route)
    window.scrollTo(0, 0)
  }, [route])

  return (
    <>
      <a className="skip" href="#main">
        跳到内容
      </a>
      <div className="sticky-top">
        <SiteHeader route={route} />
        <SubNav route={route} />
      </div>
      <main id="main" className="wrap page">
        {route.name === 'discover' && <DiscoverPage libraryVersion={libraryVersion} />}
        {route.name === 'toplist' && <ToplistPage id={route.id} />}
        {route.name === 'lists' && <ListsPage />}
        {route.name === 'list' && <ListPage id={route.id || ''} />}
        {route.name === 'channels' && <ChannelsPage />}
        {route.name === 'channel' && <ChannelPage route={route} />}
        {route.name === 'fresh' && <FreshPage />}
        {route.name === 'detail' && <DetailPage id={route.id || ''} libraryVersion={libraryVersion} onLibraryChange={bump} />}
        {route.name === 'play' && <PlayPage id={route.id || ''} ep={route.ep} onLibraryChange={bump} />}
        {route.name === 'search' && <SearchPage q={route.q} libraryVersion={libraryVersion} />}
        {route.name === 'favorites' && <FavoritesPage libraryVersion={libraryVersion} onLibraryChange={bump} />}
        {route.name === 'guide' && <GuidePage />}
        {route.name === 'about' && <AboutPage />}
        {route.name === 'notfound' && <NotFoundPage />}
      </main>
      <SiteFooter />
    </>
  )
}
