import type { ReactNode } from 'react'
import { useCatalog } from '../lib/source'
import { EmptyState } from './EmptyState'

export function CatalogGate({ children }: { children: ReactNode }) {
  const { ready, error } = useCatalog()
  if (error) return <EmptyState title={error} hint="稍后再刷新一次。" />
  if (!ready) return <p className="note">片单还在轻轻赶来，稍等一会儿。</p>
  return children
}
