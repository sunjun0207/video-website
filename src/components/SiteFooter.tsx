import { CONTACT_EMAIL, PRODUCT } from '../lib/site'

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap footer-grid">
        <div>
          <p className="footer-brand">jun.sun</p>
          <p>好剧、好片、好心情，每天都有新惊喜。</p>
        </div>
        <div>
          <h2>发现精彩</h2>
          <ul>
            <li>
              <a href="#/discover">推荐</a>
            </li>
            <li>
              <a href="#/toplist">排行榜</a>
            </li>
            <li>
              <a href="#/lists">片单</a>
            </li>
            <li>
              <a href="#/channels">频道</a>
            </li>
            <li>
              <a href="#/fresh">最新上线</a>
            </li>
          </ul>
        </div>
        <div>
          <h2>关于</h2>
          <ul>
            <li>
              <a href="#/about">关于 {PRODUCT}</a>
            </li>
            <li>
              <a href="#/guide">观影说明</a>
            </li>
            <li>
              <a href="#/favorites">收藏</a>
            </li>
          </ul>
        </div>
        <div>
          <h2>联系</h2>
          <ul>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </li>
            <li>
              <a href="#/search">站内搜索</a>
            </li>
          </ul>
        </div>
      </div>
      <div className="wrap footer-bottom">
        <span>© 2026 {PRODUCT}</span>
        <span>片名与演职员仅作检索引导，官网不托管片源。</span>
      </div>
    </footer>
  )
}
