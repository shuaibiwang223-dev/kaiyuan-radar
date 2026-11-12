// 采集器 v2
// 每小时运行一次：
//   · 每 3 小时一次“全量扫描”：用搜索分区扫遍全站 1000 星以上的所有项目（约 6.6 万个）
//   · 每小时都做“新星刷新”：搜索最近新建、涨得快的项目，并用 GraphQL 批量刷新新星池和正在暴涨的项目
// 用法：node collector/collect.mjs <数据目录> [--full]   （需要环境变量 GITHUB_TOKEN）
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import {
  HOUR, DAY, CORE_MIN_STARS, RISING_LIMIT, WINDOWS, fromRest, fromGraphQL, addSample, windowChange, signal, isSurging,
  parseTrending, risingQueries, splitRange, rangeQuery, mergeRanges, packHistory, unpackHistory,
} from './model.mjs';

const UA = 'kaiyuan-radar (GitHub Actions)';
const BATCH = 50;
const FIELDS = 'databaseId nameWithOwner description primaryLanguage{name} stargazerCount forkCount isArchived licenseInfo{spdxId} pushedAt createdAt repositoryTopics(first:8){nodes{topic{name}}}';
const FULL_EVERY = 3 * HOUR;
class RateLimited extends Error {}

export async function loadState(dir) {
  try {
    const raw = JSON.parse(gunzipSync(await readFile(join(dir, 'state.json.gz'))).toString('utf8'));
    const hist = {};
    for (const [id, h] of Object.entries(raw.hist || {})) hist[id] = unpackHistory(h);
    return { ...raw, hist };
  } catch (e) {
    if (e.code === 'ENOENT') return { meta: { runs: [], pending: [], failures: {} }, repos: {}, hist: {}, changes: [], trending: { at: null, lists: {} } };
    throw Error('数据文件损坏，停止运行以免覆盖旧数据：' + e.message);
  }
}
export async function saveState(dir, s) {
  const hist = {};
  for (const [id, h] of Object.entries(s.hist)) hist[id] = packHistory(h);
  const file = join(dir, 'state.json.gz');
  await writeFile(file + '.tmp', gzipSync(JSON.stringify({ ...s, hist }), { level: 9 }));
  await rename(file + '.tmp', file);
}

export async function collect(dir, {
  fetch = globalThis.fetch, now = Date.now(), token = process.env.GITHUB_TOKEN, full: forceFull = false,
  sleep = ms => new Promise(r => setTimeout(r, ms)), clock = Date.now, log = console.log,
  searchGap = 2050, budgetMs = 46 * 60000,
} = {}) {
  if (!token) throw Error('缺少 GITHUB_TOKEN：GitHub 的批量查询接口必须登录才能用。');
  await mkdir(dir, { recursive: true });
  const st = await loadState(dir);
  const { meta, repos, hist } = st;
  meta.pending ||= []; meta.failures ||= {}; meta.runs ||= [];
  const isFull = forceFull || !meta.lastFull || now - meta.lastFull >= FULL_EVERY - 15 * 60000;
  const started = clock();
  const notes = [], errors = [];
  let sampled = 0, discovered = 0, lastSearch = 0;
  const seen = new Set();
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token };

  const record = (fresh) => {
    const old = repos[fresh.id];
    seen.add(fresh.id);
    if (old && old.updated >= now) return;
    hist[fresh.id] = addSample(hist[fresh.id], now, fresh.stars);
    const sg = old ? signal(old.stars, fresh.stars, now - old.updated, old.rate || 0) : signal(null, fresh.stars, 0);
    const r = { ...fresh, discovered: old?.discovered ?? now, source: old?.source ?? fresh.source, pool: fresh.stars >= CORE_MIN_STARS ? 'A' : 'B', change: sg.change, rate: sg.rate, kind: sg.kind, previousAt: old?.updated ?? null, error: null };
    if (!old) discovered++;
    repos[r.id] = r;
    if (sg.change && ((Math.abs(sg.change) >= 10 && sg.kind !== '持平') || ['突然上涨', '增长加速'].includes(sg.kind)))
      st.changes.push({ id: r.id, name: r.name, t: now, from: old.updated, delta: sg.change, kind: sg.kind });
    sampled++;
  };

  async function search(q, page) {
    const wait = lastSearch + searchGap - clock();
    if (wait > 0) await sleep(wait);
    for (let attempt = 0; attempt < 2; attempt++) {
      lastSearch = clock();
      const res = await fetch('https://api.github.com/search/repositories?' + new URLSearchParams({ q, sort: 'stars', order: 'desc', per_page: '100', page: String(page) }), { headers, signal: AbortSignal.timeout(30000) });
      if (res.ok) return res.json();
      if ([403, 429].includes(res.status)) {
        const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000, after = Number(res.headers.get('retry-after')) * 1000;
        const ms = after || (reset ? reset - Date.now() + 1000 : 60000);
        if (attempt === 0 && ms <= 120000) { await sleep(Math.max(ms, 1000)); continue; }
        throw new RateLimited('搜索接口限流（HTTP ' + res.status + '）');
      }
      if (res.status === 422) return { total_count: 0, items: [] }; // 超过 1000 条之后的页码
      throw Error('搜索失败 HTTP ' + res.status);
    }
  }

  // 1. 全量扫描：全站 1000 星以上
  let sweepDone = false;
  if (isFull) {
    // 上次没扫完就接着扫剩下的分段，否则从头扫一遍
    const resume = meta.sweepQueue?.length > 0;
    const queue = (resume ? meta.sweepQueue : meta.ranges?.length ? meta.ranges : [[CORE_MIN_STARS, null]]).map(r => [r[0], r[1] ?? Infinity]);
    const done = [], counts = [];
    let requests = 0;
    try {
      while (queue.length) {
        if (clock() - started > budgetMs) { notes.push('全量扫描超时，剩余 ' + queue.length + ' 段下次继续'); break; }
        const r = queue.shift();
        const first = await search(rangeQuery(r), 1); requests++;
        if (first.total_count > 1000 && r[0] !== r[1]) { queue.unshift(...splitRange(r)); continue; }
        for (const item of first.items || []) { try { record(fromRest(item, '全站扫描', now), 'A'); } catch {} }
        const pages = Math.min(10, Math.ceil(first.total_count / 100));
        for (let p = 2; p <= pages; p++) {
          const data = await search(rangeQuery(r), p); requests++;
          for (const item of data.items || []) { try { record(fromRest(item, '全站扫描', now), 'A'); } catch {} }
          if ((data.items || []).length < 100) break;
        }
        if (first.incomplete_results) notes.push('分段 ' + rangeQuery(r) + ' 结果不完整');
        done.push(r); counts.push(first.total_count);
      }
      sweepDone = !queue.length;
    } catch (e) { errors.push('全量扫描中断：' + e.message); }
    const store = r => [r[0], r[1] === Infinity ? null : r[1]];
    if (!resume) {
      const all = [...done.map((r, i) => ({ r, n: counts[i] })), ...queue.map(r => ({ r, n: undefined }))].sort((a, b) => a.r[0] - b.r[0]);
      meta.ranges = mergeRanges(all.map(x => x.r), all.map(x => x.n)).map(store);
    }
    meta.sweepQueue = queue.map(store);
    notes.push(`全量扫描${resume ? '（接着上次）' : ''}：${requests} 次查询，${done.length} 个分段` + (sweepDone ? '' : `，剩 ${queue.length} 段下次接着扫`));
    if (sweepDone) meta.lastFull = now;
  }

  // 2. 新星发现：最近新建、涨得快的项目
  let found = 0;
  try {
    for (const q of risingQueries(now, Math.floor(now / HOUR))) {
      for (let p = 1; p <= q.pages; p++) {
        const data = await search(q.q, p);
        for (const item of data.items || []) { try { record(fromRest(item, '新星发现', now), 'B'); found++; } catch {} }
        if ((data.items || []).length < 100) break;
      }
    }
  } catch (e) { errors.push('新星发现中断：' + e.message); }
  notes.push('新星发现 ' + found + ' 个');

  // 3. GitHub 官方热门榜（每 6 小时）
  if (!st.trending.at || now - st.trending.at >= 6 * HOUR - 15 * 60000) {
    try {
      const lists = {};
      for (const range of ['daily', 'weekly', 'monthly']) {
        const res = await fetch('https://github.com/trending?since=' + range, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        const rows = parseTrending(await res.text());
        if (!rows.length) throw Error('页面解析不到项目，保留上次的榜单');
        lists[range] = rows;
      }
      st.trending = { at: now, lists };
      const known = new Set(Object.values(repos).map(r => r.name.toLowerCase()));
      for (const rows of Object.values(lists)) for (const r of rows) if (!known.has(r.name.toLowerCase())) meta.pending.push(r.name);
      notes.push('官方热门榜已更新');
    } catch (e) { errors.push('官方热门榜：' + e.message); }
  }
  meta.pending = [...new Set(meta.pending)].slice(-300);

  // 4. 重点刷新（GraphQL 一次查 50 个）：新星池 + 正在暴涨的项目 + 热门榜新项目 + 扫描里没出现的核心项目
  const hot = Object.values(repos).filter(r => r.updated < now - 40 * 60000 && (
    r.pool === 'B' || (r.d1 ?? 0) >= 100 || isSurging(r) || ['突然上涨', '增长加速'].includes(r.kind) || (sweepDone && r.pool === 'A' && !seen.has(r.id))
  )).sort((a, b) => (b.d1 ?? 0) - (a.d1 ?? 0)).slice(0, RISING_LIMIT + 2000);
  const targets = [...meta.pending.map(name => ({ name, pending: true })), ...hot];
  const resolved = new Set();
  let gqlCalls = 0, quota = meta.quota || null;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const body = 'query{' + batch.map((t, k) => { const [owner, name] = t.name.split('/'); return `r${k}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){${FIELDS}}`; }).join(' ') + ' rateLimit{remaining resetAt}}';
    let data;
    try {
      const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }), signal: AbortSignal.timeout(30000) });
      gqlCalls++;
      if (!res.ok) { errors.push('重点刷新：HTTP ' + res.status + '，剩余项目下次再刷'); break; }
      data = await res.json();
    } catch (e) { errors.push('重点刷新出错：' + e.message); break; }
    if (data.errors?.some(e => e.type === 'RATE_LIMITED')) { errors.push('GitHub 查询额度用完，剩余项目下次再刷'); break; }
    if (data.data?.rateLimit) quota = { remaining: data.data.rateLimit.remaining, resetAt: data.data.rateLimit.resetAt, at: now };
    batch.forEach((t, k) => {
      const node = data.data?.['r' + k];
      if (t.pending) resolved.add(t.name);
      if (!node) {
        if (t.pending) return;
        const f = meta.failures[t.id] = (meta.failures[t.id] || 0) + 1;
        if (repos[t.id]) repos[t.id].error = '查不到这个项目（可能已删除或改为私有）';
        if (f >= 3) { delete repos[t.id]; delete hist[t.id]; delete meta.failures[t.id]; }
        return;
      }
      delete meta.failures[t.id];
      try { record(fromGraphQL(node, t.pending ? '官方热门榜' : '重点刷新', now), 'B'); } catch (e) { errors.push(t.name + '：' + e.message); }
    });
  }
  meta.pending = meta.pending.filter(n => !resolved.has(n));
  notes.push(`重点刷新 ${hot.length} 个（${gqlCalls} 次查询）`);

  // 5. 计算 24 小时 / 7 天 / 30 天 / 近半年涨星
  for (const r of Object.values(repos)) {
    for (const [k, ms] of Object.entries(WINDOWS)) r[k] = windowChange(hist[r.id], r.stars, r.created, now, ms);
    if (r.stars >= CORE_MIN_STARS) r.pool = 'A';
    else if (r.pool === 'A') r.pool = 'B';
    r.surging = isSurging(r);
  }

  // 6. 新星池清理：加入 14 天后 7 天涨不到 20 星的移走；超过上限时移走最慢的
  const rising = Object.values(repos).filter(r => r.pool === 'B');
  for (const r of rising) if (now - r.discovered > 14 * DAY && (r.d7 ?? 0) < 20 && !r.surging) { delete repos[r.id]; delete hist[r.id]; }
  const left = Object.values(repos).filter(r => r.pool === 'B').sort((a, b) => (a.d7 ?? 0) - (b.d7 ?? 0));
  for (const r of left.slice(0, Math.max(0, left.length - RISING_LIMIT))) { delete repos[r.id]; delete hist[r.id]; }

  // 7. 保存
  st.changes = st.changes.filter(c => c.t >= now - 30 * DAY && repos[c.id]).sort((a, b) => b.t - a.t).slice(0, 1000);
  const total = Object.keys(repos).length, core = Object.values(repos).filter(r => r.pool === 'A').length;
  const run = { at: now, mode: isFull ? '全量' : '新星', sampled, discovered, errors: errors.length, seconds: Math.round((clock() - started) / 1000), notes: [...notes, ...errors].slice(0, 40) };
  meta.runs = [run, ...meta.runs].slice(0, 48);
  Object.assign(meta, { updated: now, pool: total, core, rising: total - core, quota });
  await saveState(dir, st);
  log(`完成（${run.mode}）：共 ${total} 个项目（核心 ${core}，新星 ${total - core}），本轮刷新 ${sampled}，新发现 ${discovered}，问题 ${errors.length} 条，用时 ${run.seconds} 秒`);
  for (const n of run.notes) log('  · ' + n);
  return run;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node collector/collect.mjs <数据目录> [--full]'); process.exit(2); }
  collect(dir, { full: process.argv.includes('--full') }).then(run => { if (!run.sampled) { console.error('本轮一个项目都没采到，判定为失败'); process.exit(1); } }, e => { console.error(e.message); process.exit(1); });
}
