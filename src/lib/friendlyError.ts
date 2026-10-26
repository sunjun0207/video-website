/** 浏览器原始报错多为英文。页面上只留下已经写好的中文，其余换成当下这句话。 */
export function friendlyError(reason: unknown, fallback: string): string {
  const raw = reason instanceof Error ? reason.message.trim() : typeof reason === 'string' ? reason.trim() : ''
  if (!raw) return fallback
  if (/failed to fetch|networkerror|typeerror|not allowed|timed out|timeout|aborted|cors|access-control|unexpected/i.test(raw)) {
    return fallback
  }
  if (/[^\u0000-\u007F]/.test(raw)) return raw
  return fallback
}
