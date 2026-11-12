// 把网页文件和采集数据合成可以直接发布的网站目录
// 数据拆成小文件：排行榜（打开就读）、搜索索引（搜索时才读）、详情和走势图（点开项目才读），手机也能很快打开
// 用法：node scripts/build-site.mjs <数据目录> <输出目录>
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadState } from '../collector/collect.mjs';
import { CATEGORY_NAMES, DAY, HOUR } from '../collector/model.mjs';

export const DETAIL_SHARDS = 256, HIST_SHARDS = 512;
const TOP_ALL = 600, TOP_CAT = 240;

// 走势图数据压缩：每日星数存差值；最近逐次点存 [小时差, 星数差] 交替排列
export function compactHistory(h) {
  if (!h) return null;
  const days = h.days.map((v, i) => i ? v - h.days[i - 1] : v);
  const r = [];
  h.recent.forEach(([t, s], i) => { const th = Math.round(t / HOUR); if (!i) r.push(th, s); else { const [pt, ps] = h.recent[i - 1]; r.push(th - Math.round(pt / HOUR), s - ps); } });
  return { d0: h.d0, d: days, r };
}

export function card(r) {
  return { id: r.id, n: r.name, de: (r.description || '').slice(0, 160), c: r.category, l: r.language, s: r.stars, d1: r.d1, d7: r.d7, d30: r.d30, d180: r.d180, k: r.kind, cr: r.created, p: r.pool, su: r.surging ? 1 : 0, u: r.updated };
}
// 排行规则
export const RANKS = {
  d1: { key: r => r.d1 },
  d7: { key: r => r.d7 },
  d30: { key: r => r.d30 },
  d180: { key: r => r.d180 },
  stars: { key: r => r.stars },
  // 急剧上涨：只看还没大火的项目（5000 星以下或 90 天内新建），按 24 小时涨星排
  surge: { key: r => r.d1, filter: (r, now) => r.d1 > 0 && (r.stars < 5000 || (r.created && now - Date.parse(r.created) < 90 * DAY)) },
};

export async function buildSite(stateDir, out, webDir = 'web') {
  const st = await loadState(stateDir);
  const all = Object.values(st.repos);
  const now = st.meta.updated || Date.now();
  await rm(out, { recursive: true, force: true });
  for (const d of ['rank', 'detail', 'hist']) await mkdir(join(out, 'data', d), { recursive: true });
  await cp(webDir, out, { recursive: true });
  const put = (f, data) => writeFile(join(out, 'data', f), JSON.stringify(data));

  // 排行榜
  for (const [name, rule] of Object.entries(RANKS)) {
    const list = all.filter(r => rule.key(r) != null && (!rule.filter || rule.filter(r, now))).sort((a, b) => rule.key(b) - rule.key(a) || b.stars - a.stars);
    const cards = {}, pick = arr => arr.map(r => (cards[r.id] = card(r), r.id));
    const cats = {};
    for (const c of CATEGORY_NAMES) cats[c] = pick(list.filter(r => r.category === c).slice(0, TOP_CAT));
    await put(`rank/${name}.json`, { total: list.length, all: pick(list.slice(0, TOP_ALL)), cats, cards });
  }

  // 搜索索引：[id, 项目名, 分类序号, 总星数, 24小时, 7天]
  const catIdx = Object.fromEntries(CATEGORY_NAMES.map((c, i) => [c, i]));
  await put('search.json', { cats: CATEGORY_NAMES, rows: all.sort((a, b) => b.stars - a.stars).map(r => [r.id, r.name, catIdx[r.category] ?? CATEGORY_NAMES.length - 1, r.stars, r.d1, r.d7]) });

  // 详情和走势：按项目编号分片
  const details = Array.from({ length: DETAIL_SHARDS }, () => ({}));
  const hists = Array.from({ length: HIST_SHARDS }, () => ({}));
  for (const r of all) {
    details[r.id % DETAIL_SHARDS][r.id] = { ...card(r), de: r.description, f: r.forks, lic: r.license, pu: r.pushed, src: r.source, di: r.discovered, tp: r.topics, err: r.error, ar: r.archived ? 1 : 0 };
    hists[r.id % HIST_SHARDS][r.id] = compactHistory(st.hist[r.id]);
  }
  await Promise.all([...details.map((d, i) => put(`detail/${i}.json`, d)), ...hists.map((h, i) => put(`hist/${i}.json`, h))]);

  // 官方热门榜（带上我们已知的项目信息）
  const byName = new Map(all.map(r => [r.name.toLowerCase(), r]));
  const lists = {};
  for (const [k, rows] of Object.entries(st.trending.lists || {})) lists[k] = rows.map(x => { const r = byName.get(x.name.toLowerCase()); return { ...x, card: r ? card(r) : null }; });
  await put('trending.json', { at: st.trending.at, lists });
  await put('changes.json', st.changes.slice(0, 300));

  const m = st.meta;
  await put('meta.json', { updated: m.updated, lastFull: m.lastFull, pool: m.pool, core: m.core, rising: m.rising, quota: m.quota, runs: (m.runs || []).slice(0, 24), surging: all.filter(r => r.surging).length, rising24: all.filter(r => r.d1 > 0).length });
  return { repos: all.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [stateDir = 'state', out = '_site'] = process.argv.slice(2);
  buildSite(stateDir, out).then(r => console.log(`网站已生成：${out}（${r.repos} 个项目）`), e => { console.error(e.message); process.exit(1); });
}
