import type { ReactNode } from 'react'
import { useCatalog } from '../lib/source'
import { EmptyState } from './EmptyState'
import { LoadingPane } from './LoadingPane'

export function CatalogGate({ children }: { children: ReactNode }) {
  const { ready, error } = useCatalog()
  if (error) return <EmptyState title={error} hint="过一会儿再刷新看看。" />
  if (!ready) return <LoadingPane title="片单还在轻轻赶来，稍等一会儿。" />
  return children
}
