import { ZH } from './zh.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n == null ? '—' : Number(n).toLocaleString('zh-CN');
const wan = n => n == null ? '—' : Math.abs(n) >= 10000 ? (n / 10000).toFixed(Math.abs(n) >= 100000 ? 0 : 1) + ' 万' : fmt(n);
const signed = n => n == null ? '积累中' : (n > 0 ? '+' : '') + wan(n);
const time = t => t ? new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '暂无';
const date = s => s ? new Date(s).toLocaleDateString('zh-CN') : '暂无';
const ago = t => { if (!t) return '暂无'; const m = Math.round((Date.now() - t) / 60000); return m < 2 ? '刚刚' : m < 60 ? m + ' 分钟前' : m < 1440 ? Math.round(m / 60) + ' 小时前' : Math.round(m / 1440) + ' 天前'; };
const later = ms => { const m = Math.round(ms / 60000); return m < 60 ? '约 ' + Math.max(1, m) + ' 分钟后' : '约 ' + (Math.round(m / 30) / 2) + ' 小时后'; };
const clean = s => String(s || '').replace(/:[a-z0-9_+-]+:/g, '').replace(/\s+/g, ' ').trim();
const license = s => !s || ['NOASSERTION', 'OTHER', '未注明'].includes(s) ? '未注明（请到原项目确认）' : s;
const color = n => n == null ? 'muted' : n < 0 ? 'red' : n > 0 ? 'green' : 'muted';
const SHARDS = 64;

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
const SORTS = { d1: '24 小时涨星', d7: '7 天涨星', d30: '30 天涨星', stars: '总星数', recent: '最近发现', newest: '最近创建' };
const KINDS = ['正常增长', '增长加速', '突然上涨', '掉星'];

let view = 'explore', shown = 24, q = '', category = '', sort = 'd1', kind = '', range = 'daily';
let meta = null, repos = [], trending = null, changes = null, saved = [];
const historyCache = new Map();
try { saved = JSON.parse(localStorage.getItem('radar-saved') || '[]'); } catch {}

async function getJSON(path, fresh) {
  const url = path + (fresh ? '?t=' + Date.now() : '?v=' + (meta?.updated || 0));
  const r = await fetch(url, { cache: fresh ? 'no-store' : 'default', signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Error(r.status === 404 ? '还没有数据，第一次自动更新完成后就能看到' : '网络错误 ' + r.status);
  return r.json();
}
async function loadData() {
  meta = await getJSON('data/meta.json', true);
  repos = (await getJSON('data/repos.json')).map(r => ({ ...r, description: clean(r.description) }));
  trending = changes = null;
  const byName = new Map(repos.map(r => [r.name, r]));
  saved = saved.map(s => byName.get(s.name) || s);
}
function explain(r) {
  if (ZH[r.name]) return { text: ZH[r.name], label: '中文释义' };
  if (/[一-鿿]/.test(r.description || '')) return { text: r.description, label: '项目自带中文简介' };
  return { text: CATEGORY_HINT[r.category] || CATEGORY_HINT['其他项目'], label: '按分类推断的用途' };
}
const translate = name => 'https://github-com.translate.goog/' + name + '?_x_tr_sl=auto&_x_tr_tl=zh-CN&_x_tr_hl=zh-CN';
function toast(s) { const t = $('#toast'); t.textContent = s; t.style.display = 'block'; clearTimeout(toast.timer); toast.timer = setTimeout(() => t.style.display = 'none', 2500); }
function toggleSave(r) {
  const i = saved.findIndex(x => x.name === r.name);
  if (i < 0) saved.push(r); else saved.splice(i, 1);
  try { localStorage.setItem('radar-saved', JSON.stringify(saved)); } catch {}
  toast(i < 0 ? '已收藏' : '已取消收藏');
  return i < 0;
}

function stats() {
  const rising = repos.filter(r => r.d1 > 0).length;
  const next = meta.updated + (meta.everyHours || 3) * 3600000;
  $('#stats').innerHTML = [
    ['监测中的项目', fmt(repos.length), '按你关心的领域自动发现'],
    ['24 小时内涨星', fmt(rising), '个项目星数在增加'],
    ['最近更新', ago(meta.updated), time(meta.updated)],
    ['下次更新', next > Date.now() ? later(next - Date.now()) : '即将更新', '每 3 小时自动一次'],
  ].map(([k, v, n]) => `<div class="stat"><p>${k}</p><b>${v}</b><small>${esc(n)}</small></div>`).join('');
  const last = meta.runs?.[0];
  const stale = Date.now() - meta.updated > 8 * 3600000;
  $('#live').textContent = stale ? '● 更新延迟' : '● 真实数据';
  $('#live').classList.toggle('warn', stale);
  $('#scope').innerHTML = stale
    ? `<b>注意：</b>已经超过 8 小时没有更新了，自动更新可能出了问题，请到“使用说明”里查看。`
    : `上次自动更新：${time(meta.updated)}，刷新了 ${fmt(last?.sampled)} 个项目${last?.discovered ? '，新发现 ' + fmt(last.discovered) + ' 个' : ''}。涨星数 = 两个时间点的总星数之差。`;
}

function card(r) {
  const x = explain(r), on = saved.some(s => s.name === r.name);
  return `<article class="card">
    <div class="card-top"><span class="icon">${esc((r.name.split('/')[1] || '?')[0].toUpperCase())}</span><button class="save ${on ? 'on' : ''}" data-save="${esc(r.name)}" aria-label="收藏">${on ? '★' : '☆'}</button></div>
    <h3><button data-detail="${esc(r.name)}">${esc(r.name)}</button></h3>
    <div><span class="tag">${esc(r.category)}</span>${r.archived ? ' <span class="tag">已停止维护</span>' : ''}</div>
    <p class="hint">${esc(x.text)}</p>
    <div class="meta">${x.label}</div>
    ${r.description && x.label !== '项目自带中文简介' ? `<p class="original">原文简介：${esc(r.description)}</p>` : ''}
    <div class="metrics">
      <span>总星数<strong>${wan(r.stars)}</strong></span>
      <span>24 小时<strong class="${color(r.d1)}">${signed(r.d1)}</strong></span>
      <span>7 天<strong class="${color(r.d7)}">${signed(r.d7)}</strong></span>
    </div>
    <div class="meta">${esc(r.language)} · 更新于 ${time(r.updated)}${r.error ? '<br><span class="error">' + esc(r.error) + '</span>' : ''}</div>
    <div class="links"><a href="${translate(r.name)}" target="_blank" rel="noopener">中文阅读 ↗</a><a href="https://github.com/${esc(r.name)}" target="_blank" rel="noopener">打开原项目 ↗</a></div>
  </article>`;
}
function bindCards(list) {
  document.querySelectorAll('[data-save]').forEach(b => b.onclick = () => { const r = list.find(x => x.name === b.dataset.save); const on = toggleSave(r); b.classList.toggle('on', on); b.textContent = on ? '★' : '☆'; });
  document.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => detail(b.dataset.detail));
}

function filtered() {
  const k = q.trim().toLowerCase();
  let list = repos.filter(r => (!category || r.category === category) && (!k || (r.name + ' ' + r.description + ' ' + r.category + ' ' + (ZH[r.name] || '') + ' ' + (r.topics || []).join(' ')).toLowerCase().includes(k)));
  const num = v => v == null ? -Infinity : v;
  const by = { d1: (a, b) => num(b.d1) - num(a.d1), d7: (a, b) => num(b.d7) - num(a.d7), d30: (a, b) => num(b.d30) - num(a.d30), stars: (a, b) => b.stars - a.stars, recent: (a, b) => b.discovered - a.discovered, newest: (a, b) => String(b.created).localeCompare(String(a.created)) }[sort];
  return list.sort((a, b) => by(a, b) || b.stars - a.stars);
}

function explore() {
  const list = filtered(), page = list.slice(0, shown);
  const cats = Object.keys(CATEGORY_HINT);
  $('#content').innerHTML = `
    <form class="toolbar" id="search-form">
      <input id="query" value="${esc(q)}" placeholder="搜项目名、用途或关键词" aria-label="搜索">
      <button>搜索</button>
      <select id="category" aria-label="分类"><option value="">全部分类</option>${cats.map(c => `<option ${c === category ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select id="sort" aria-label="排序">${Object.entries(SORTS).map(([v, t]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>按${t}</option>`).join('')}</select>
    </form>
    <p class="note">找到 ${fmt(list.length)} 个项目。刚加入的项目要等满 24 小时 / 7 天才有对应的涨星数，之前显示“积累中”。</p>
    <div class="cards">${page.map(card).join('') || '<div class="empty">没有找到匹配的项目，换个关键词试试。</div>'}</div>
    ${list.length > shown ? `<button id="more" class="more">再看 24 个（还有 ${fmt(list.length - shown)} 个）</button>` : ''}`;
  $('#search-form').onsubmit = e => { e.preventDefault(); q = $('#query').value; shown = 24; render(); };
  $('#category').onchange = e => { category = e.target.value; shown = 24; render(); };
  $('#sort').onchange = e => { sort = e.target.value; shown = 24; render(); };
  if ($('#more')) $('#more').onclick = () => { shown += 24; render(true); };
  bindCards(page);
}

async function trendingView() {
  trending ||= await getJSON('data/trending.json');
  const labels = { daily: '今日', weekly: '本周', monthly: '本月' }, rows = trending.lists?.[range] || [];
  const inPool = new Set(repos.map(r => r.name));
  $('#content').innerHTML = `
    <div class="range">${Object.entries(labels).map(([v, t]) => `<button data-range="${v}" class="${range === v ? 'active' : ''}">${t}</button>`).join('')}</div>
    <p class="note">这是 GitHub 官方热门榜，排名是 GitHub 给的。抓取时间：${time(trending.at)}（每 6 小时抓一次）。</p>
    <div class="panel">${rows.map(r => `<div class="row"><span class="rank">${String(r.rank).padStart(2, '0')}</span>
      <div class="row-main"><h3>${inPool.has(r.name) ? `<button class="link" data-detail="${esc(r.name)}">${esc(r.name)}</button>` : `<a href="https://github.com/${esc(r.name)}" target="_blank" rel="noopener">${esc(r.name)}</a>`}</h3>
      <p>${inPool.has(r.name) ? esc(explain(repos.find(x => x.name === r.name)).text) : '下次更新时会加入监测'} · <a href="${translate(r.name)}" target="_blank" rel="noopener">中文阅读 ↗</a></p></div>
      <span class="row-value green">${r.gain == null ? '' : '+' + fmt(r.gain) + ' ' + labels[range]}</span></div>`).join('') || '<div class="empty">热门榜还没抓到，等下次自动更新。</div>'}</div>`;
  document.querySelectorAll('[data-range]').forEach(b => b.onclick = () => { range = b.dataset.range; render(); });
  bindCards(repos);
}

async function changesView() {
  changes ||= await getJSON('data/changes.json');
  const list = changes.filter(c => !kind || c.kind === kind).slice(0, 150);
  $('#content').innerHTML = `
    <div class="range wrap">${['', ...KINDS].map(k => `<button data-kind="${k}" class="${kind === k ? 'active' : ''}">${k || '全部'}</button>`).join('')}</div>
    <div class="notice">这里列出最近 30 天里，每次自动更新时星数有变化的项目。“突然上涨”“增长加速”只是按速度给的提示，不代表一定有刷星。</div>
    <div class="panel">${list.map(c => `<div class="row"><span class="rank">${c.delta < 0 ? '↘' : '↗'}</span>
      <div class="row-main"><h3><button class="link" data-detail="${esc(c.name)}">${esc(c.name)}</button></h3><p>${esc(c.kind)} · ${time(c.from)} → ${time(c.t)}</p></div>
      <strong class="row-value ${c.delta < 0 ? 'red' : 'green'}">${signed(c.delta)}</strong></div>`).join('') || '<div class="empty">还没有记录到变化。<br>第一次采集只是打基础，第二次更新后才会有变化。</div>'}</div>`;
  document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; render(); });
  bindCards(repos);
}

function savedView() {
  $('#content').innerHTML = `<div class="cards">${saved.map(card).join('') || '<div class="empty">还没有收藏。<br>在“发现项目”里点卡片右上角的 ☆ 就能收藏。</div>'}</div>`;
  bindCards(saved);
}

function aboutView() {
  const runs = meta.runs || [];
  $('#content').innerHTML = `<div class="status-grid">
    <div class="panel"><h3>多久更新一次</h3><p>每 3 小时自动更新一次，由 GitHub 免费的定时任务完成，不用开电脑，也不消耗 AI 额度。<br>GitHub 的定时任务高峰期可能晚几分钟到半小时，属于正常现象。</p></div>
    <div class="panel"><h3>项目从哪里来</h3><p>① 按你关心的领域搜索：AI、自动化、办公、视频图像、工业控制（PLC、Modbus、机器人、物联网）、设计等，每次轮换几个领域。<br>② 最近新建、涨得快的项目。<br>③ GitHub 官方热门榜。<br>监测池最多保留 ${fmt(3000)} 个项目，满了会移走长期不涨的冷门项目。</p></div>
    <div class="panel"><h3>数字怎么算</h3><p>每次更新都记录每个项目的总星数。<br>“24 小时涨星”= 现在的总星数 − 24 小时前的总星数，7 天、30 天同理。<br>这是净变化：有人取消收藏也会算进去，所以可能是负数。<br>新加入的项目要攒够时间才有数字，之前显示“积累中”，不会编造。</p></div>
    <div class="panel"><h3>中文说明从哪里来</h3><p>30 个常见项目有人工写的中文释义；其他项目按关键词自动分类，给出大致用途。<br>想看完整说明，点“中文阅读”，会用谷歌翻译打开项目页面。</p></div>
    <div class="panel"><h3>手机上怎么用</h3><p>用手机浏览器打开网址即可，不用登录。<br>在浏览器菜单里选“添加到主屏幕”，以后像 App 一样一点就开。<br>收藏只保存在当前这台设备上。</p></div>
    <div class="panel"><h3>最近的自动更新记录</h3>
      <table><tr><th>时间</th><th>刷新</th><th>新发现</th><th>问题</th></tr>${runs.slice(0, 10).map(r => `<tr><td>${time(r.at)}</td><td>${fmt(r.sampled)}</td><td>${fmt(r.discovered)}</td><td class="${r.errors ? 'error' : ''}">${r.errors ? r.errors + ' 条' : '无'}</td></tr>`).join('')}</table>
      ${runs[0]?.errors ? `<p class="error">最近一次的问题：<br>${runs[0].notes.filter(n => /失败|出错|额度|HTTP|解析|异常/.test(n)).map(esc).join('<br>')}</p>` : ''}
      <p>GitHub 查询额度剩余：${fmt(meta.quota?.remaining)}</p></div>
  </div>`;
}

async function detail(name) {
  const r = repos.find(x => x.name === name) || saved.find(x => x.name === name);
  if (!r) return;
  $('#detail-body').innerHTML = '<div class="empty">正在读取…</div>';
  $('#detail').showModal();
  const x = explain(r);
  let chart = '<p class="note">至少要两次更新后才会画出走势图。</p>';
  try {
    const shard = ((r.id % SHARDS) + SHARDS) % SHARDS;
    if (!historyCache.has(shard)) historyCache.set(shard, await getJSON('data/history/' + shard + '.json'));
    const h = historyCache.get(shard)[r.id] || [];
    if (h.length > 1) {
      const lo = Math.min(...h.map(p => p[1])), hi = Math.max(...h.map(p => p[1])), start = h[0][0], end = h.at(-1)[0];
      const pts = h.map(p => `${(10 + (p[0] - start) / (end - start || 1) * 530).toFixed(1)},${(125 - (p[1] - lo) / (hi - lo || 1) * 110).toFixed(1)}`).join(' ');
      chart = `<svg class="chart" viewBox="0 0 550 150" role="img" aria-label="星数走势图"><path d="M10 130H540" stroke="#eee"/><polyline points="${pts}" fill="none" stroke="#7561d6" stroke-width="2.5" stroke-linejoin="round"/></svg>
        <p class="note">星数走势：${time(start)} → ${time(end)}，从 ${fmt(lo)} 到 ${fmt(hi)}</p>`;
    }
  } catch (e) { chart = '<p class="note error">走势数据读取失败：' + esc(e.message) + '</p>'; }
  $('#detail-body').innerHTML = `<h2 class="detail-name">${esc(r.name)}</h2>
    <span class="tag">${esc(r.category)}</span>
    <p class="hint">${esc(x.text)}</p><p class="note">${x.label}</p>
    ${r.description ? `<p class="original full">原文简介：${esc(r.description)}</p>` : ''}
    <div class="detail-stats">
      <span>总星数<b>${fmt(r.stars)}</b></span>
      <span>24 小时<b class="${color(r.d1)}">${signed(r.d1)}</b></span>
      <span>7 天<b class="${color(r.d7)}">${signed(r.d7)}</b></span>
      <span>30 天<b class="${color(r.d30)}">${signed(r.d30)}</b></span>
    </div>
    ${chart}
    <p class="note">编程语言：${esc(r.language)} · 分叉数：${fmt(r.forks)}<br>开源许可：${esc(license(r.license))}（商用前请看清条款）<br>项目创建：${date(r.created)} · 最近提交代码：${date(r.pushed)}<br>来源：${esc(r.source)} · 加入监测：${time(r.discovered)} · 数据更新：${time(r.updated)}</p>
    <div class="links"><a href="${translate(r.name)}" target="_blank" rel="noopener">中文阅读全文 ↗</a><a href="https://github.com/${esc(r.name)}" target="_blank" rel="noopener">打开原项目 ↗</a></div>`;
}

const TITLES = {
  explore: ['好项目，不应该被埋没。', '每 3 小时自动查一遍，看看哪些开源项目正在变热。'],
  trending: ['GitHub 官方热门榜', '今日、本周、本月最热门的项目。'],
  changes: ['涨星变化', '每次更新时星数有变化的项目，涨的掉的都看得到。'],
  saved: ['我的收藏', '你收藏的项目，数字会跟着自动更新。'],
  about: ['使用说明', '数据怎么来的、多久更新、数字怎么算。'],
};
async function render(keepScroll) {
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  [$('#title').textContent, $('#subtitle').textContent] = TITLES[view];
  const y = window.scrollY;
  try {
    if (!meta) { $('#content').innerHTML = '<div class="empty">正在读取数据…</div>'; await loadData(); }
    stats();
    $('#stats').style.display = ['explore', 'about'].includes(view) ? '' : 'none';
    if (view === 'explore') explore();
    if (view === 'trending') await trendingView();
    if (view === 'changes') await changesView();
    if (view === 'saved') savedView();
    if (view === 'about') aboutView();
    if (keepScroll) window.scrollTo({ top: y });
  } catch (e) {
    $('#content').innerHTML = `<div class="panel error">读取失败：${esc(e.message)}<br>请稍后点“重新读取”。</div>`;
    $('#scope').textContent = '暂时读不到数据。';
  }
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; shown = 24; render(); window.scrollTo({ top: 0 }); });
$('#refresh').onclick = () => { meta = null; historyCache.clear(); render(); };
$('.close').onclick = () => $('#detail').close();
$('#detail').addEventListener('click', e => { if (e.target.id === 'detail') $('#detail').close(); });
render();
