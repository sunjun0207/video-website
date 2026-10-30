type Props = {
  title: string
  desc?: string
  more?: string
  moreLabel?: string
}

export function SectionHead({ title, desc, more, moreLabel = '更多' }: Props) {
  return (
    <div className="section-head">
      <div className="section-title">
        <h2>{title}</h2>
        {desc ? <span>{desc}</span> : null}
      </div>
      {more ? <a href={more}>{moreLabel}</a> : null}
    </div>
  )
}
