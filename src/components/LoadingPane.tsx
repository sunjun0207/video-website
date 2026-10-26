type Kind = 'search' | 'page' | 'detail' | 'play'

const CARDS = { search: 8, page: 10, detail: 0, play: 0 }

export function LoadingPane({ title, kind = 'page' }: { title: string; kind?: Kind }) {
  const count = CARDS[kind]
  return (
    <div className={`loading-pane loading-${kind}`} role="status" aria-live="polite">
      {kind === 'play' ? <div className="loading-stage" /> : null}
      {kind === 'detail' ? (
        <div className="loading-detail">
          <span className="shimmer loading-poster" />
          <span className="loading-copy">
            <i className="shimmer" />
            <i className="shimmer" />
            <i className="shimmer short" />
          </span>
        </div>
      ) : null}
      {count > 0 ? (
        <div className="loading-grid">
          {Array.from({ length: count }, (_, index) => (
            <span key={index} className="shimmer loading-card" style={{ animationDelay: `${index * 70}ms` }} />
          ))}
        </div>
      ) : null}
      <p>
        <span className="spin" />
        {title}
      </p>
    </div>
  )
}
