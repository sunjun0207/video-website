const features = [
  { title: '搜索', text: '按片名或演员寻找。输入时会实时联想片名。点进一部再返回，列表会停在刚才那一条。' },
  { title: '频道', text: '电影、连续剧、动漫、综艺纪录和短剧，可以再按类型、地区、年份筛选。' },
  { title: '选集', text: '一部片子有多段时，详情页和播放页都可以换一段接着看。' },
  { title: '线路', text: '同一段可能有多条线路。画面不顺的时候，换一条再试。' },
  { title: '收藏', text: '喜欢的片子可以留下，下次从收藏页直接打开。' },
  { title: '最近看过', text: '看过的会记在这台浏览器里，进度也跟着留下来。' },
]

const ways = [
  { title: '推荐', spec: '首页', text: '焦点图、频道海报和三张榜，适合不知道看什么的时候。' },
  { title: '片单', spec: '按心情', text: '灯下电影、连续剧、动漫、纪录和短剧，各自成一张片单。' },
  { title: '搜索', spec: '一个名字', text: '忽然想起某一部，或某一个人，就从顶部搜。' },
]

export function GuidePage() {
  return (
    <>
      <section className="dl-hero">
        <div>
          <p className="kicker">观影</p>
          <h1>在浏览器里，把一部片子看完</h1>
          <p>搜一部片子，选一段，按列表接着看。收藏和观看进度留在这台浏览器里。</p>
          <a className="btn btn-light" href="#/discover">
            去发现影片
          </a>
        </div>
        <div className="device" aria-hidden="true">
          <div className="device-top">jun.sun</div>
          <div className="device-line">灯下的一部</div>
          <div className="device-line dim">正片 · 正在播放</div>
          <div className="device-bar">
            <span />
          </div>
        </div>
      </section>

      <h2 className="block-title">能做什么</h2>
      <div className="feature-grid">
        {features.map((item) => (
          <article key={item.title} className="feature">
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      <h2 className="block-title">从哪里开始</h2>
      <div className="quality-grid">
        {ways.map((item) => (
          <article key={item.spec} className="quality-card">
            <h3>{item.title}</h3>
            <p className="spec">{item.spec}</p>
            <p>{item.text}</p>
          </article>
        ))}
      </div>
    </>
  )
}
