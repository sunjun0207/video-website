import { EmptyState } from '../components/EmptyState'

export function NotFoundPage() {
  return <EmptyState title="页面走丢了" hint="地址可能写错了，回首页看看更多精彩吧。" href="#/discover" action="回到首页" />
}
