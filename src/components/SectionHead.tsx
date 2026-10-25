type Props = {
  title: string
  more?: string
  moreLabel?: string
}

export function SectionHead({ title, more, moreLabel = '更多' }: Props) {
  return (
    <div className="section-head">
      <h2>{title}</h2>
      {more ? <a href={more}>{moreLabel}</a> : null}
    </div>
  )
}
