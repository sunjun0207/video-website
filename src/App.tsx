import { useCallback, useEffect, useState } from 'react'
import { MiniPlayer } from './components/MiniPlayer'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { SubNav } from './components/SubNav'
import { pausePlayback } from './lib/playbackSession'
import { useRoute } from './lib/route'
import { onCatalogChange } from './lib/source'
import { searchAnchor } from './lib/storage'
import { documentTitle } from './lib/title'
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
  const [kept, setKept] = useState<{ id: string; ep: number } | null>(null)
  const bump = useCallback(() => setLibraryVersion((value) => value + 1), [])
  const playing = route.name === 'play' && Boolean(route.id)
  const live = playing && route.id ? { id: route.id, ep: route.ep } : kept
  const showMini = Boolean(live) && !playing

  useEffect(() => onCatalogChange(bump), [bump])

  useEffect(() => {
    if (route.name === 'play' && route.id) setKept({ id: route.id, ep: route.ep })
  }, [route])

  useEffect(() => {
    document.body.classList.toggle('has-player', showMini)
    if (!playing && document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    return () => document.body.classList.remove('has-player')
  }, [showMini, playing])

  useEffect(() => {
    document.title = documentTitle(route)
    if (route.name === 'search' && searchAnchor(route.q)) return
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
        {route.name === 'search' && <SearchPage q={route.q} libraryVersion={libraryVersion} />}
        {route.name === 'favorites' && <FavoritesPage libraryVersion={libraryVersion} onLibraryChange={bump} />}
        {route.name === 'guide' && <GuidePage />}
        {route.name === 'about' && <AboutPage />}
        {route.name === 'notfound' && <NotFoundPage />}
        {live ? (
          <div className={playing ? undefined : 'play-dock'} inert={playing ? undefined : true}>
            <PlayPage
              key={live.id}
              id={live.id}
              ep={live.ep}
              visible={playing}
              onKeepEp={(ep) => setKept((current) => (current ? { id: current.id, ep } : current))}
              onLibraryChange={bump}
            />
          </div>
        ) : null}
      </main>
      <SiteFooter />
      {showMini && live ? (
        <MiniPlayer
          id={live.id}
          ep={live.ep}
          onClose={() => {
            pausePlayback()
            setKept(null)
          }}
        />
      ) : null}
    </>
  )
}
