import { getVideo } from './api'
import { CHARTS, CHANNELS, SHELVES } from './catalog'
import type { Route } from './route'
import { PRODUCT } from './site'

export function documentTitle(route: Route) {
  const base = import.meta.env.VITE_APP_TITLE || PRODUCT
  switch (route.name) {
    case 'discover':
      return `${base} - 发现影片`
    case 'toplist': {
      const chart = CHARTS.find((item) => item.id === route.id) ?? CHARTS[0]
      return `${chart.title} - 排行榜 - ${base}`
    }
    case 'lists':
      return `片单 - ${base}`
    case 'list': {
      const shelf = SHELVES.find((item) => item.id === route.id)
      return shelf ? `${shelf.title} - 片单 - ${base}` : `片单 - ${base}`
    }
    case 'channels':
      return `频道 - ${base}`
    case 'channel': {
      const channel = CHANNELS.find((item) => item.id === route.id)
      return channel ? `${channel.name} - 频道 - ${base}` : `频道 - ${base}`
    }
    case 'fresh':
      return `新片 - ${base}`
    case 'detail':
    case 'play': {
      const item = route.id ? getVideo(route.id) : undefined
      return item ? `${item.title} - ${base}` : `影片 - ${base}`
    }
    case 'search':
      return route.q ? `搜索 ${route.q} - ${base}` : `搜索 - ${base}`
    case 'favorites':
      return `收藏 - ${base}`
    case 'guide':
      return `观影说明 - ${base}`
    case 'about':
      return `关于 - ${base}`
    default:
      return `未找到页面 - ${base}`
  }
}
