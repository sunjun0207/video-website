type Props = {
  title: string
  hint?: string
  href?: string
  action?: string
}

export function EmptyState({ title, hint, href, action }: Props) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {href && action ? (
        <a className="btn" href={href}>
          {action}
        </a>
      ) : null}
    </div>
  )
}
