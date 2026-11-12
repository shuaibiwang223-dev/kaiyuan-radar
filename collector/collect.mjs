// 采集器：每次运行 = 发现新项目 + 抓原生榜单 + 批量刷新监测池星数
// 用法：node collector/collect.mjs <数据目录>   （需要环境变量 GITHUB_TOKEN）
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOUR, DAY, POOL_LIMIT, SHARDS, fromRest, fromGraphQL, addSample, prune, windowChange, signal, shardOf, parseTrending, discoveryQueries, TOPIC_QUERIES } from './model.mjs';

const UA = 'kaiyuan-radar (GitHub Actions)';
const BATCH = 50;
const FIELDS = 'databaseId nameWithOwner description primaryLanguage{name} stargazerCount forkCount isArchived licenseInfo{spdxId} pushedAt createdAt repositoryTopics(first:10){nodes{topic{name}}}';

async function readJSON(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw Error('数据文件损坏：' + file + '（' + e.message + '）'); }
}
async function writeJSON(file, data) {
  const tmp = file + '.tmp';
  await writeFile(tmp, JSON.stringify(data));
  await rename(tmp, file);
}

export async function collect(dir, { fetch = globalThis.fetch, now = Date.now(), token = process.env.GITHUB_TOKEN, sleep = ms => new Promise(r => setTimeout(r, ms)), log = console.log } = {}) {
  if (!token) throw Error('缺少 GITHUB_TOKEN：GitHub 的批量查询接口必须登录才能用。');
  await mkdir(join(dir, 'history'), { recursive: true });
  const meta = await readJSON(join(dir, 'meta.json'), { runs: [], cursor: 0, pending: [], failures: {} });
  const list = await readJSON(join(dir, 'repos.json'), []);
  const changes = await readJSON(join(dir, 'changes.json'), []);
  let trending = await readJSON(join(dir, 'trending.json'), { at: null, lists: {} });
  const shards = await Promise.all(Array.from({ length: SHARDS }, (_, i) => readJSON(join(dir, 'history', i + '.json'), {})));
  const byId = new Map(list.map(r => [r.id, r]));
  const notes = [], errors = [];
  let sampled = 0, discovered = 0, quota = meta.quota || null;
  const headers = { 'User-Agent': UA, Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token };

  const record = (fresh) => {
    const old = byId.get(fresh.id);
    if (old && old.updated >= now) return;
    const h = shards[shardOf(fresh.id)][fresh.id] ||= [];
    const sg = old ? signal(old.stars, fresh.stars, now - old.updated, old.rate || 0) : signal(null, fresh.stars, 0);
    addSample(h, now, fresh.stars);
    const r = { ...fresh, discovered: old?.discovered ?? now, source: old?.source ?? fresh.source, change: sg.change, rate: sg.rate, kind: sg.kind, previousAt: old?.updated ?? null, error: null };
    if (!old) discovered++;
    byId.set(r.id, r);
    if (sg.change) changes.push({ id: r.id, name: r.name, t: now, from: old.updated, delta: sg.change, kind: sg.kind });
    sampled++;
  };

  // 1. 按关注领域搜索新项目
  const queries = discoveryQueries(meta.cursor || 0, now);
  for (const [i, q] of queries.entries()) {
    try {
      if (i) await sleep(2500); // 搜索接口每分钟限 30 次，放慢一点
      const res = await fetch('https://api.github.com/search/repositories?' + new URLSearchParams({ q: q.q, sort: q.sort, order: 'desc', per_page: '100' }), { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) { errors.push('搜索「' + q.q + '」失败：HTTP ' + res.status); if ([403, 429].includes(res.status)) break; continue; }
      const data = await res.json();
      let n = 0;
      for (const item of data.items || []) { try { record(fromRest(item, '领域搜索', now)); n++; } catch {} }
      notes.push('搜索「' + q.q + '」' + n + ' 个');
    } catch (e) { errors.push('搜索「' + q.q + '」出错：' + e.message); }
  }
  meta.cursor = ((meta.cursor || 0) + queries.length - 3) % (TOPIC_QUERIES.length * 2);

  // 2. GitHub 原生热门榜（每 6 小时抓一次）
  if (!trending.at || now - trending.at >= 6 * HOUR - 10 * 60000) {
    try {
      const lists = {};
      for (const range of ['daily', 'weekly', 'monthly']) {
        const res = await fetch('https://github.com/trending?since=' + range, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw Error('HTTP ' + res.status);
        const rows = parseTrending(await res.text());
        if (!rows.length) throw Error('页面解析不到项目，保留上次的榜单');
        lists[range] = rows;
      }
      trending = { at: now, lists };
      const known = new Set([...byId.values()].map(r => r.name.toLowerCase()));
      for (const rows of Object.values(lists)) for (const r of rows) if (!known.has(r.name.toLowerCase())) meta.pending.push(r.name);
      notes.push('原生热门榜已更新');
    } catch (e) { errors.push('原生热门榜：' + e.message); }
  }
  meta.pending = [...new Set(meta.pending)].slice(-300);

  // 3. 批量刷新监测池里所有项目的星数（GraphQL 一次查 50 个）
  const targets = [...meta.pending.map(name => ({ name, pending: true })), ...[...byId.values()].filter(r => r.updated < now).sort((a, b) => a.updated - b.updated)];
  const resolved = new Set();
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const body = 'query{' + batch.map((t, k) => { const [owner, name] = t.name.split('/'); return `r${k}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){${FIELDS}}`; }).join(' ') + ' rateLimit{remaining resetAt}}';
    let data;
    try {
      const res = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: body }), signal: AbortSignal.timeout(30000) });
      if (!res.ok) { errors.push('批量刷新：HTTP ' + res.status + '，本轮剩余项目下次再刷'); break; }
      data = await res.json();
    } catch (e) { errors.push('批量刷新出错：' + e.message); break; }
    if (data.errors?.some(e => e.type === 'RATE_LIMITED')) { errors.push('GitHub 查询额度用完，本轮剩余项目下次再刷'); break; }
    if (data.data?.rateLimit) quota = { remaining: data.data.rateLimit.remaining, resetAt: data.data.rateLimit.resetAt, at: now };
    batch.forEach((t, k) => {
      const node = data.data?.['r' + k];
      if (t.pending) resolved.add(t.name);
      if (!node) {
        if (t.pending) return;
        const f = meta.failures[t.id] = (meta.failures[t.id] || 0) + 1;
        const r = byId.get(t.id); if (r) r.error = '查不到这个项目（可能已删除或改为私有）';
        if (f >= 3) { byId.delete(t.id); delete shards[shardOf(t.id)][t.id]; delete meta.failures[t.id]; notes.push('移除失效项目 ' + t.name); }
        return;
      }
      delete meta.failures[t.id];
      try { record(fromGraphQL(node, t.pending ? '原生热门榜' : '定时刷新', now)); } catch (e) { errors.push(t.name + '：' + e.message); }
    });
  }
  meta.pending = meta.pending.filter(n => !resolved.has(n));

  // 4. 计算 24 小时 / 7 天 / 30 天净涨星
  for (const r of byId.values()) {
    const h = shards[shardOf(r.id)][r.id] = prune(shards[shardOf(r.id)][r.id] || [], now);
    r.d1 = windowChange(h, now, DAY);
    r.d7 = windowChange(h, now, 7 * DAY);
    r.d30 = windowChange(h, now, 30 * DAY);
  }

  // 5. 监测池超过上限时，移走最冷门的项目（30 天内新发现的不动）
  if (byId.size > POOL_LIMIT) {
    const removable = [...byId.values()].filter(r => now - r.discovered > 30 * DAY).sort((a, b) => ((a.d30 ?? 0) - (b.d30 ?? 0)) || (a.stars - b.stars));
    for (const r of removable.slice(0, byId.size - POOL_LIMIT)) { byId.delete(r.id); delete shards[shardOf(r.id)][r.id]; }
  }

  // 6. 写回数据
  const cutoff = now - 30 * DAY;
  const keptChanges = changes.filter(c => c.t >= cutoff && byId.has(c.id)).sort((a, b) => b.t - a.t).slice(0, 500);
  const run = { at: now, sampled, discovered, errors: errors.length, notes: [...notes, ...errors].slice(0, 40) };
  meta.runs = [run, ...(meta.runs || [])].slice(0, 30);
  Object.assign(meta, { updated: now, pool: byId.size, quota, everyHours: 3 });
  const repos = [...byId.values()].map(({ topics, hint, ...r }) => ({ ...r, topics }));
  await writeJSON(join(dir, 'repos.json'), repos);
  await writeJSON(join(dir, 'changes.json'), keptChanges);
  await writeJSON(join(dir, 'trending.json'), trending);
  await Promise.all(shards.map((s, i) => writeJSON(join(dir, 'history', i + '.json'), s)));
  await writeJSON(join(dir, 'meta.json'), meta);
  log(`完成：监测池 ${byId.size} 个，本轮采样 ${sampled} 个，新发现 ${discovered} 个，问题 ${errors.length} 条`);
  for (const e of errors) log('  · ' + e);
  return run;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('用法：node collector/collect.mjs <数据目录>'); process.exit(2); }
  collect(dir).then(run => { if (!run.sampled) { console.error('本轮一个项目都没采到，判定为失败'); process.exit(1); } }, e => { console.error(e.message); process.exit(1); });
}
