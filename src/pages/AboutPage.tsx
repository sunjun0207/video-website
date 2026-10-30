import { CONTACT_EMAIL, PRODUCT, SITE_VERSION } from '../lib/site'

export function AboutPage() {
  return (
    <div className="about-grid">
      <article className="prose-card">
        <p className="kicker">关于 {PRODUCT}</p>
        <h1>发现精彩，从这里开始</h1>
        <p>欢迎来到 {PRODUCT}！</p>
        <p>
          这里是一个汇聚精彩视频内容的娱乐天地。无论你喜欢扣人心弦的短剧、精彩纷呈的影视作品，还是轻松有趣的热门视频，都能在这里发现属于自己的快乐。
        </p>
        <p>我们希望用丰富的内容、有趣的故事和舒适的观看体验，为每一位用户带来更多精彩时刻。</p>
        <p>好内容，值得被发现；好时光，值得被分享。打开 {PRODUCT}，探索更多精彩，让每一次观看都充满惊喜！</p>
        <p>精彩不止，快乐不散场。</p>
        <p>顶部搜一搜，片名、演员都能找到；排行榜、片单和频道帮你更快找到想看的。片名与演职员仅作检索引导，本站不托管片源。</p>
      </article>
      <aside className="fact-card">
        <div>
          <span>名称</span>
          <strong>{PRODUCT}</strong>
        </div>
        <div>
          <span>版本</span>
          <strong>{SITE_VERSION}</strong>
        </div>
        <div>
          <span>邮箱</span>
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        </div>
      </aside>
    </div>
  )
}
