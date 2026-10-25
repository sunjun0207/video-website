import { CONTACT_EMAIL, PRODUCT, SITE_VERSION } from '../lib/site'

export function AboutPage() {
  return (
    <div className="about-grid">
      <article className="prose-card">
        <p className="kicker">关于</p>
        <h1>{PRODUCT}</h1>
        <p>
          这里是一处轻轻的观影处。你可以寻一个片名，或一个忽然想起的人，让画面在灯下慢慢展开。想再看一遍，就停在这一部；想接着看下去，就交给选集。最近看过的片子会留下来，喜欢的也可以先收好。愿每一部都成为一段从容的停留。
        </p>
        <p>顶部搜索可以按片名或演员找片。片单、榜单和频道是整理好的入口。片名与演职员只作检索引导，本站不托管片源。</p>
      </article>
      <aside className="fact-card">
        <div>
          <span>名称</span>
          <strong>{PRODUCT}</strong>
        </div>
        <div>
          <span>官网</span>
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
