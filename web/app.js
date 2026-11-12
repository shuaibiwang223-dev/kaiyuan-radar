import { ZH } from './zh.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '—' : Number(n).toLocaleString('zh-CN');
const wan = n => n == null ? '—' : Math.abs(n) >= 10000 ? (n / 10000).toFixed(Math.abs(n) >= 100000 ? 0 : 1) + ' 万' : fmt(n);
const signed = n => n == null ? '积累中' : (n > 0 ? '+' : '') + wan(n);
const time = t => t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无';
const date = s => s ? new Date(s).toLocaleDateString('zh-CN') : '暂无';
const ago = t => { if (!t) return '暂无'; const m = Math.round((Date.now() - t) / 60000); return m < 2 ? '刚刚' : m < 60 ? m + ' 分钟前' : m < 1440 ? Math.round(m / 60) + ' 小时前' : Math.round(m / 1440) + ' 天前'; };
const color = n => n == null ? 'muted' : n < 0 ? 'red' : n > 0 ? 'green' : 'muted';
const clean = s => String(s || '').replace(/:[a-z0-9_+-]+:/g, '').replace(/\s+/g, ' ').trim();
const license = s => !s || ['NOASSERTION', 'OTHER', '未注明'].includes(s) ? '未注明（请到原项目确认）' : s;
const translate = name => 'https://github-com.translate.goog/' + name + '?_x_tr_sl=auto&_x_tr_tl=zh-CN&_x_tr_hl=zh-CN';
const HOUR = 3600000, DAY = 24 * HOUR, DETAIL_SHARDS = 256, HIST_SHARDS = 512, PAGE = 30;

const CATEGORY_HINT = {
  'AI / 大模型': '人工智能相关：大模型、智能助手、AI 代理或机器学习工具。',
  '工业 / 控制': '工业控制、机器人、物联网或嵌入式相关项目。',
  '视频 / 图像': '视频、图片、三维或视觉内容处理相关项目。',
  '办公 / 自动化': '自动化流程、办公文档处理或提高效率的工具。',
  '设计 / 前端': '界面设计、网页开发或前端组件。',
  '数据 / 存储': '数据存储、检索或数据分析相关项目。',
  '移动 / 桌面': '手机应用、桌面软件或相关开发工具。',
  '学习 / 教程': '教程、学习资料、资源合集或示例代码。',
  '安全 / 网络': '网络、安全防护或隐私相关工具。',
  '开发工具': '写代码、构建、调试、部署或服务器相关工具。',
  '其他项目': '暂未归类，可点开原项目查看用途。',
};
const SORTS = { d1: '24 小时涨星', d7: '7 天涨星', d30: '30 天涨星', d180: '近半年涨星', stars: '总星数' };
const KINDS = ['正常增长', '增长加速', '突然上涨', '掉星'];

let view = 'rank', sort = 'd1', category = '', shown = PAGE, range = 'daily', kind = '', query = '';
let meta = null, saved = [];
const cache = new Map();
try { saved = JSON.parse(localStorage.getItem('radar-saved-v2') || '[]'); } catch {}

async function getJSON(path, fresh) {
  const key = path;
  if (!fresh && cache.has(key)) return cache.get(key);
  const url = path + (fresh ? '?t=' + Date.now() : '?v=' + (meta?.updated || 0));
  const p = fetch(url, { cache: fresh ? 'no-store' : 'default', signal: AbortSignal.timeout(40000) }).then(r => {
    if (!r.ok) throw Error(r.status === 404 ? '还没有数据，第一次自动更新完成后就能看到' : '网络错误 ' + r.status);
    return r.json();
  });
  if (!fresh) cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
function explain(r) {
  const de = clean(r.de);
  if (ZH[r.n]) return { text: ZH[r.n], label: '中文释义' };
  if (/[一-鿿]/.test(de)) return { text: de, label: '项目自带中文简介' };
  return { text: CATEGORY_HINT[r.c] || CATEGORY_HINT['其他项目'], label: '按分类推断的用途' };
}
function toast(s) { const t = $('#toast'); t.textContent = s; t.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.style.display = 'none', 2500); }
function toggleSave(r) {
  const i = saved.findIndex(x => x.n === r.n);
  if (i < 0) saved.push(r); else saved.splice(i, 1);
  try { localStorage.setItem('radar-saved-v2', JSON.stringify(saved)); } catch {}
  toast(i < 0 ? '已收藏' : '已取消收藏');
  return i < 0;
}

// ---------- 卡片 ----------
function card(r, focus = 'd1') {
  const x = explain(r), on = saved.some(s => s.n === r.n), de = clean(r.de);
  const metric = (k, label) => `<span class="${k === focus ? 'focus' : ''}">${label}<strong class="${color(r[k])}">${signed(r[k])}</strong></span>`;
  return `<article class="card">
    <div class="card-top"><span class="icon">${esc((r.n.split('/')[1] || '?')[0].toUpperCase())}</span>${r.su ? '<span class="badge">🚀 急剧上涨</span>' : ''}<button class="save ${on ? 'on' : ''}" data-save="${r.id}" aria-label="收藏">${on ? '★' : '☆'}</button></div>
    <h3><button data-detail="${r.id}">${esc(r.n)}</button></h3>
    <div><span class="tag">${esc(r.c)}</span>${r.p === 'B' ? ' <span class="tag new">新星</span>' : ''}</div>
    <p class="hint">${esc(x.text)}</p>
    ${de && x.label !== '项目自带中文简介' ? `<p class="original">原文简介：${esc(de)}</p>` : '<p class="original"></p>'}
    <div class="metrics"><span>总星数<strong>${wan(r.s)}</strong></span>${metric('d1', '24 小时')}${focus === 'd30' || focus === 'd180' ? metric(focus, SORTS[focus].replace('涨星', '')) : metric('d7', '7 天')}</div>
    <div class="meta">${esc(r.l || '')} · 更新于 ${time(r.u)}</div>
  </article>`;
}
const cards = (list, focus) => `<div class="cards">${list.map(r => card(r, focus)).join('')}</div>`;
function bind(list) {
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { const r = list.find(x => x.id == b.dataset.save) || saved.find(x => x.id == b.dataset.save); if (!r) return; const on = toggleSave(r); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; });
  document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(+b.dataset.detail, list));
}
function more(list) {
  if (list.length <= shown) return '';
  return `<button id="more" class="more">再看 ${Math.min(PAGE, list.length - shown)} 个（已显示 ${shown} / ${list.length}）</button>`;
}
function bindMore() { if ($('#more')) $('#more').onclick = () => { shown += PAGE; render(true); }; }

// ---------- 各个页面 ----------
async function rankView() {
  const data = await getJSON('data/rank/' + sort + '.json');
  const ids = category ? data.cats[category] || [] : data.all;
  const list = ids.map(id => data.cards[id]);
  const cats = Object.keys(CATEGORY_HINT);
  $('#content').innerHTML = `
    <div class="toolbar">
      <div class="seg">${Object.entries(SORTS).map(([v, t]) => `<button data-sort="${v}" class="${v === sort ? 'active' : ''}">${t}</button>`).join('')}</div>
      <select id="category" aria-label="分类"><option value="">全部分类</option>${cats.map(c => `<option ${c === category ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </div>
    <p class="note">${category ? esc(category) + ' 分类' : '全部项目'}按${SORTS[sort]}排名，显示前 ${fmt(ids.length)} 名（参与排名 ${fmt(data.total)} 个）。${sort === 'd180' || sort === 'd30' ? '历史数据还在积累，暂时只有区间内新建的项目有数字，会越来越全。' : ''}</p>
    ${cards(list.slice(0, shown), sort)}${more(list)}`;
  document.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => { sort = b.dataset.sort; shown = PAGE; render(); });
  $('#category').onchange = e => { category = e.target.value; shown = PAGE; render(); };
  bind(list); bindMore();
}
async function surgeView() {
  const data = await getJSON('data/rank/surge.json');
  const ids = category ? data.cats[category] || [] : data.all;
  const list = ids.map(id => data.cards[id]);
  $('#content').innerHTML = `
    <div class="toolbar"><select id="category" aria-label="分类"><option value="">全部分类</option>${Object.keys(CATEGORY_HINT).map(c => `<option ${c === category ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="notice">这里只看<b>还没大火的项目</b>（5000 星以下，或 90 天内新建），按 24 小时涨星排。这些项目<b>每小时刷新一次</b>，比其他项目勤 3 倍。带 🚀 的是一天涨了 20% 以上的。</div>
    ${cards(list.slice(0, shown), 'd1')}${more(list)}`;
  $('#category').onchange = e => { category = e.target.value; shown = PAGE; render(); };
  bind(list); bindMore();
}
async function trendingView() {
  const labels = { daily: '今日', weekly: '本周', monthly: '本月', half: '近半年' };
  let rows, note;
  if (range === 'half') {
    const data = await getJSON('data/rank/d180.json');
    rows = data.all.slice(0, 100).map((id, i) => ({ rank: i + 1, name: data.cards[id].n, gain: data.cards[id].d180, card: data.cards[id] }));
    note = '近半年榜是我们自己算的：每个项目现在的总星数减去半年前的总星数。历史数据还在积累，目前主要是半年内新建的项目，会越来越全。';
  } else {
    const t = await getJSON('data/trending.json');
    rows = t.lists?.[range] || [];
    note = `GitHub 官方热门榜，排名由 GitHub 给出。抓取时间：${time(t.at)}（每 6 小时抓一次）。`;
  }
  $('#content').innerHTML = `
    <div class="seg">${Object.entries(labels).map(([v, t]) => `<button data-range="${v}" class="${range === v ? 'active' : ''}">${t}</button>`).join('')}</div>
    <p class="note">${note}</p>
    <div class="panel rows">${rows.map(r => `<div class="row"><span class="rank">${String(r.rank).padStart(2, '0')}</span>
      <div class="row-main"><h3>${r.card ? `<button class="link" data-detail="${r.card.id}">${esc(r.name)}</button>` : `<a href="https://github.com/${esc(r.name)}" target="_blank" rel="noopener">${esc(r.name)}</a>`}</h3>
      <p>${r.card ? `<span class="tag">${esc(r.card.c)}</span> ${esc(explain(r.card).text)}` : '下次更新时会加入监测'}</p></div>
      <span class="row-value"><b class="green">${r.gain == null ? '' : '+' + fmt(r.gain)}</b><small>${labels[range]}${r.card ? ' · 总 ' + wan(r.card.s) : ''}</small></span></div>`).join('') || '<div class="empty">热门榜还没抓到，等下次自动更新。</div>'}</div>`;
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { range = b.dataset.range; render(); });
  bind(rows.filter(r => r.card).map(r => r.card));
}
async function changesView() {
  const changes = await getJSON('data/changes.json');
  const list = changes.filter(c => !kind || c.kind === kind).slice(0, 200);
  $('#content').innerHTML = `
    <div class="seg">${['', ...KINDS].map(k => `<button data-kind="${k}" class="${kind === k ? 'active' : ''}">${k || '全部'}</button>`).join('')}</div>
    <div class="notice">最近 30 天里，每次更新时星数变化 10 颗以上的项目。“突然上涨”“增长加速”只是按速度给的提示，不代表一定有刷星。</div>
    <div class="panel rows">${list.map(c => `<div class="row"><span class="rank">${c.delta < 0 ? '↘' : '↗'}</span>
      <div class="row-main"><h3><button class="link" data-detail="${c.id}">${esc(c.name)}</button></h3><p>${esc(c.kind)} · ${time(c.from)} → ${time(c.t)}</p></div>
      <strong class="row-value ${c.delta < 0 ? 'red' : 'green'}">${signed(c.delta)}</strong></div>`).join('') || '<div class="empty">还没有记录到变化。<br>第一次采集只是打基础，之后才会有变化。</div>'}</div>`;
  document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; render(); });
  bind([]);
}
async function searchView() {
  const idx = await getJSON('data/search.json');
  const k = query.trim().toLowerCase();
  const catHit = idx.cats.findIndex(c => c.toLowerCase().includes(k));
  const rows = idx.rows.filter(r => r[1].toLowerCase().includes(k) || (catHit >= 0 && r[2] === catHit)).slice(0, 300);
  const list = rows.map(r => ({ id: r[0], n: r[1], c: idx.cats[r[2]], s: r[3], d1: r[4], d7: r[5] }));
  $('#content').innerHTML = `
    <p class="note">在全站 ${fmt(idx.rows.length)} 个监测项目里搜“${esc(query)}”，找到 ${fmt(rows.length)} 个${rows.length >= 300 ? '（只显示前 300 个，按总星数排）' : ''}。点项目名看详情。</p>
    <div class="panel rows">${list.map((r, i) => `<div class="row"><span class="rank">${String(i + 1).padStart(2, '0')}</span>
      <div class="row-main"><h3><button class="link" data-detail="${r.id}">${esc(r.n)}</button></h3><p><span class="tag">${esc(r.c)}</span> ${esc(CATEGORY_HINT[r.c])}</p></div>
      <span class="row-value"><b>${wan(r.s)}</b><small>24 小时 <i class="${color(r.d1)}">${signed(r.d1)}</i> · 7 天 <i class="${color(r.d7)}">${signed(r.d7)}</i></small></span></div>`).join('') || `<div class="empty">监测范围里没有找到。<br>可以 <a href="https://github.com/search?q=${encodeURIComponent(query)}&type=repositories" target="_blank" rel="noopener">到 GitHub 全站搜索 ↗</a></div>`}</div>`;
  bind(list);
}
function savedView() {
  $('#content').innerHTML = saved.length ? cards(saved) : '<div class="empty">还没有收藏。<br>点卡片右上角的 ☆ 就能收藏。</div>';
  bind(saved);
}
function aboutView() {
  const runs = meta.runs || [];
  $('#content').innerHTML = `<div class="status-grid">
    <div class="panel"><h3>监测哪些项目</h3><p>① <b>全站所有 1000 星以上的项目</b>（现在 ${fmt(meta.core)} 个），一个不漏，每 3 小时全部刷新一次。<br>② <b>新星池</b>：1000 星以下、但最近新建或涨得快的项目（现在 ${fmt(meta.rising)} 个），<b>每小时刷新一次</b>。<br>③ GitHub 官方热门榜上的项目。<br>新星池里 14 天都没怎么涨的项目会被移走，涨过 1000 星就自动进入①。</p></div>
    <div class="panel"><h3>多久更新一次</h3><p>每小时自动运行一次，每 3 小时其中一次是全站扫描（大约 25 分钟扫完）。由 GitHub 免费的定时任务完成，不用开电脑，也不消耗 AI 额度。<br>GitHub 高峰期可能晚几分钟到半小时，属于正常现象。</p></div>
    <div class="panel"><h3>数字怎么算</h3><p>“24 小时涨星”= 现在的总星数 − 24 小时前的总星数，7 天、30 天、近半年同理。是净变化，有人取消收藏也算进去，所以可能是负数。<br>历史不够时：如果项目是这段时间内新建的，涨星就是它全部的星数（新项目从 0 开始）；否则显示“积累中”，不编造。</p></div>
    <div class="panel"><h3>中文说明从哪里来</h3><p>常见项目有人工写的中文释义；其他项目按关键词自动分类，给出大致用途。想看完整说明，点“中文阅读”，会用谷歌翻译打开项目页面。</p></div>
    <div class="panel"><h3>手机和电脑上怎么用</h3><p>手机：浏览器打开网址，菜单里选“添加到主屏幕”。<br>电脑：Chrome 打开网址，右上角 ⋮ →“投放、保存和分享”→“将页面作为应用安装”，桌面就有图标了。<br>收藏只保存在当前这台设备上。</p></div>
    <div class="panel"><h3>最近的自动更新记录</h3>
      <table><tr><th>时间</th><th>类型</th><th>刷新</th><th>新发现</th><th>用时</th><th>问题</th></tr>${runs.slice(0, 12).map(r => `<tr><td>${time(r.at)}</td><td>${esc(r.mode || '')}</td><td>${fmt(r.sampled)}</td><td>${fmt(r.discovered)}</td><td>${r.seconds != null ? Math.round(r.seconds / 60) + ' 分钟' : ''}</td><td class="${r.errors ? 'error' : ''}">${r.errors ? r.errors + ' 条' : '无'}</td></tr>`).join('')}</table>
      ${runs[0]?.errors ? `<p class="error">最近一次的问题：<br>${runs[0].notes.filter(n => /失败|出错|额度|HTTP|中断|超时|异常/.test(n)).map(esc).join('<br>')}</p>` : ''}</div>
  </div>`;
}

// ---------- 右侧栏 ----------
async function rail() {
  const el = $('#rail');
  if (getComputedStyle(el).display === 'none') return;
  try {
    const [surge, t] = await Promise.all([getJSON('data/rank/surge.json'), getJSON('data/trending.json')]);
    const top = surge.all.slice(0, 10).map(id => surge.cards[id]);
    const daily = (t.lists?.daily || []).slice(0, 10);
    el.innerHTML = `
      <div class="panel mini"><h3>🚀 急剧上涨 Top 10 <button class="link small" data-go="surge">全部 ›</button></h3>
        ${top.map((r, i) => `<div class="mini-row"><span class="rank">${i + 1}</span><button class="link" data-detail="${r.id}">${esc(r.n)}</button><b class="green">${signed(r.d1)}</b></div>`).join('') || '<p class="note">暂无</p>'}</div>
      <div class="panel mini"><h3>🔥 今日官方热门 <button class="link small" data-go="trending">全部 ›</button></h3>
        ${daily.map(r => `<div class="mini-row"><span class="rank">${r.rank}</span>${r.card ? `<button class="link" data-detail="${r.card.id}">${esc(r.name)}</button>` : `<a href="https://github.com/${esc(r.name)}" target="_blank" rel="noopener">${esc(r.name)}</a>`}<b class="green">${r.gain == null ? '' : '+' + fmt(r.gain)}</b></div>`).join('') || '<p class="note">暂无</p>'}</div>
      <div class="panel mini"><h3>📡 监测状态</h3><p class="note">全站 1000 星以上：<b>${fmt(meta.core)}</b> 个<br>新星池（每小时刷新）：<b>${fmt(meta.rising)}</b> 个<br>上次更新：${ago(meta.updated)}<br>上次全站扫描：${ago(meta.lastFull)}</p></div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    el.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(+b.dataset.detail, [...top, ...daily.filter(r => r.card).map(r => r.card)]));
  } catch { el.innerHTML = ''; }
}

// ---------- 统计条 ----------
function stats() {
  const stale = Date.now() - meta.updated > 3 * HOUR;
  $('#live').textContent = stale ? '● 更新延迟' : '● 真实数据';
  $('#live').classList.toggle('warn', stale);
  $('#stats').innerHTML = [
    ['全站 1000 星以上', fmt(meta.core), '全部监测，每 3 小时刷新'],
    ['新星池', fmt(meta.rising), '涨得快的小项目，每小时刷新'],
    ['🚀 急剧上涨', fmt(meta.surging), '一天涨 20% 以上'],
    ['最近更新', ago(meta.updated), time(meta.updated) + ' · 每小时一次'],
  ].map(([k, v, n]) => `<div class="stat"><p>${k}</p><b>${v}</b><small>${esc(n)}</small></div>`).join('');
  $('#side-note').innerHTML = `全站 ${fmt(meta.core)} 个<br>新星 ${fmt(meta.rising)} 个<br>${ago(meta.updated)}更新`;
}

// ---------- 详情 ----------
async function detail(id, list = []) {
  const base = list.find(x => x.id === id) || saved.find(x => x.id === id);
  $('#detail-body').innerHTML = '<div class="empty">正在读取…</div>';
  $('#detail').showModal();
  try {
    const [d, h] = await Promise.all([getJSON('data/detail/' + (id % DETAIL_SHARDS) + '.json'), getJSON('data/hist/' + (id % HIST_SHARDS) + '.json')]);
    const r = d[id] || base;
    if (!r) throw Error('这个项目已不在监测范围内');
    const x = explain(r);
    const pts = expand(h[id]);
    let chart = '<p class="note">至少要两次更新后才会画出走势图。</p>';
    if (pts.length > 1) {
      const lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1])), start = pts[0][0], end = pts.at(-1)[0];
      const xy = pts.map(p => `${(10 + (p[0] - start) / (end - start || 1) * 530).toFixed(1)},${(125 - (p[1] - lo) / (hi - lo || 1) * 110).toFixed(1)}`).join(' ');
      chart = `<svg class="chart" viewBox="0 0 550 150" role="img" aria-label="星数走势图"><path d="M10 130H540" stroke="#eee"/><polyline points="${xy}" fill="none" stroke="#7561d6" stroke-width="2.5" stroke-linejoin="round"/></svg>
        <p class="note">星数走势：${time(start)} → ${time(end)}，从 ${fmt(lo)} 到 ${fmt(hi)}</p>`;
    }
    $('#detail-body').innerHTML = `<h2 class="detail-name">${esc(r.n)}</h2>
      <span class="tag">${esc(r.c)}</span>${r.p === 'B' ? ' <span class="tag new">新星 · 每小时刷新</span>' : ''}${r.su ? ' <span class="badge">🚀 急剧上涨</span>' : ''}
      <p class="hint">${esc(x.text)}</p><p class="note">${x.label}</p>
      ${clean(r.de) ? `<p class="original full">原文简介：${esc(clean(r.de))}</p>` : ''}
      <div class="detail-stats">
        <span>总星数<b>${fmt(r.s)}</b></span>
        <span>24 小时<b class="${color(r.d1)}">${signed(r.d1)}</b></span>
        <span>7 天<b class="${color(r.d7)}">${signed(r.d7)}</b></span>
        <span>30 天<b class="${color(r.d30)}">${signed(r.d30)}</b></span>
        <span>近半年<b class="${color(r.d180)}">${signed(r.d180)}</b></span>
      </div>
      ${chart}
      <p class="note">编程语言：${esc(r.l)} · 分叉数：${fmt(r.f)}<br>开源许可：${esc(license(r.lic))}（商用前请看清条款）<br>项目创建：${date(r.cr)} · 最近提交代码：${date(r.pu)}<br>来源：${esc(r.src || '')} · 加入监测：${time(r.di)} · 数据更新：${time(r.u)}${r.err ? '<br><span class="error">' + esc(r.err) + '</span>' : ''}</p>
      ${r.err ? '<div class="notice">⚠️ 最近一次查询时 GitHub 上已经找不到这个项目，可能被作者删除、被 GitHub 封禁或改成了私有，下面的链接可能打不开。</div>' : ''}
      <div class="links"><button class="save-big" id="save-detail">${saved.some(s => s.n === r.n) ? '★ 已收藏' : '☆ 收藏'}</button><a href="${translate(r.n)}" target="_blank" rel="noopener">中文阅读全文 ↗</a><a href="https://github.com/${esc(r.n)}" target="_blank" rel="noopener">打开原项目 ↗</a></div>`;
    $('#save-detail').onclick = () => { const on = toggleSave(r); $('#save-detail').textContent = on ? '★ 已收藏' : '☆ 收藏'; };
  } catch (e) { $('#detail-body').innerHTML = '<div class="panel error">读取失败：' + esc(e.message) + '</div>'; }
}
// 解开压缩的走势数据
function expand(c) {
  if (!c) return [];
  let v = 0; const pts = c.d.map((dv, i) => [(c.d0 + i) * DAY + DAY - 1, v = i ? v + dv : dv]);
  const rec = []; let t = 0, s = 0;
  for (let i = 0; i < c.r.length; i += 2) { t = i ? t + c.r[i] : c.r[i]; s = i ? s + c.r[i + 1] : c.r[i + 1]; rec.push([t * HOUR, s]); }
  const first = rec[0]?.[0] ?? Infinity;
  return [...pts.filter(p => p[0] < first), ...rec];
}

// ---------- 路由 ----------
const TITLES = {
  rank: ['涨星排行', '全站 1000 星以上的项目 + 涨得快的新星项目，看谁涨得最猛。'],
  surge: ['🚀 急剧上涨', '还没大火、但正在猛涨的项目，每小时刷新，最值得盯。'],
  trending: ['热门榜', '今日、本周、本月是 GitHub 官方榜；近半年是我们自己算的。'],
  changes: ['涨星变化', '每次更新时星数明显变化的项目，涨的掉的都看得到。'],
  saved: ['我的收藏', '你收藏的项目。'],
  about: ['使用说明', '监测哪些项目、多久更新、数字怎么算。'],
  search: ['搜索结果', ''],
};
function go(v) { view = v; shown = PAGE; if (v !== 'rank' && v !== 'surge') category = ''; render(); window.scrollTo({ top: 0 }); }
async function render(keepScroll) {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  [$('#title').textContent, $('#subtitle').textContent] = TITLES[view];
  const y = window.scrollY;
  try {
    if (!meta) { $('#content').innerHTML = '<div class="empty">正在读取数据…</div>'; meta = await getJSON('data/meta.json', true); rail(); }
    stats();
    $('#stats').style.display = ['rank', 'about'].includes(view) ? '' : 'none';
    await { rank: rankView, surge: surgeView, trending: trendingView, changes: changesView, saved: savedView, about: aboutView, search: searchView }[view]();
    if (keepScroll) window.scrollTo({ top: y });
  } catch (e) {
    $('#content').innerHTML = `<div class="panel error">读取失败：${esc(e.message)}<br>请稍后点“重新读取”。</div>`;
  }
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => go(b.dataset.view));
$('#top-search').onsubmit = e => { e.preventDefault(); query = $('#q').value.trim(); if (query) go('search'); };
$('#refresh').onclick = () => { meta = null; cache.clear(); render(); };
$('.close').onclick = () => $('#detail').close();
$('#detail').addEventListener('click', e => { if (e.target.id === 'detail') $('#detail').close(); });
render();
