const features = [
  { title: '搜索', text: '片名、演员都能搜，边输入边联想。点进去再返回，列表还停在刚才那一条。' },
  { title: '频道', text: '电影、连续剧、动漫、综艺纪录、短剧，还能按类型、地区、年份挑一挑。' },
  { title: '选集', text: '剧集、综艺想看哪集点哪集，详情页和播放页都能选。' },
  { title: '线路', text: '每一集都有好几条线路。开播连不上会自动换一条，觉得卡也可以自己换。' },
  { title: '收藏', text: '喜欢就收下，下次从收藏页一键打开。' },
  { title: '最近看过', text: '看到哪儿都帮你记着，下次打开接着看。记录保存在这台设备上。' },
]

const ways = [
  { title: '推荐', spec: '首页', text: '热门推荐、频道精选和排行榜，不知道看什么时，来这里就对了。' },
  { title: '片单', spec: '按心情', text: '精品影视、追剧时间、二次元乐园、综艺开心局、人气短剧，挑一张一路刷下去。' },
  { title: '搜索', spec: '一个名字', text: '想起一部剧、一个演员，顶部搜一搜就有。' },
]

export function GuidePage() {
  return (
    <>
      <section className="dl-hero">
        <div>
          <p className="kicker">观影说明</p>
          <h1>打开就能看，让精彩马上发生</h1>
          <p>搜一搜、点一下就开播。看到哪儿自动帮你记着，收藏和观看进度都保存在这台设备上。</p>
          <a className="btn btn-light" href="#/discover">
            马上探索
          </a>
        </div>
        <div className="device" aria-hidden="true">
          <div className="device-top">jun.sun</div>
          <div className="device-line">精彩好剧，一眼心动</div>
          <div className="device-line dim">正片 · 正在播放</div>
          <div className="device-bar">
            <span />
          </div>
        </div>
      </section>

      <h2 className="block-title">玩法一览</h2>
      <div className="feature-grid">
        {features.map((item) => (
          <article key={item.title} className="feature">
            <h3>{item.title}</h3>
            <p>{item.text}</p>
          </article>
        ))}
      </div>

      <h2 className="block-title">从这里开始</h2>
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
