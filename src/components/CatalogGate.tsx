import type { ReactNode } from 'react'
import { useCatalog } from '../lib/source'
import { EmptyState } from './EmptyState'
import { LoadingPane } from './LoadingPane'

export function CatalogGate({ children }: { children: ReactNode }) {
  const { ready, error } = useCatalog()
  if (error) return <EmptyState title={error} hint="刷新一下，或者稍后再来看看。" />
  if (!ready) return <LoadingPane title="正在为你加载精彩内容…" />
  return children
}
