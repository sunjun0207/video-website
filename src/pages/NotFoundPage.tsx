import { EmptyState } from '../components/EmptyState'

export function NotFoundPage() {
  return <EmptyState title="这一页还没有片子。" hint="地址可能写错了。" href="#/discover" action="回到发现影片" />
}
