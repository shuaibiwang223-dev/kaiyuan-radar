import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collect, loadState } from '../collector/collect.mjs';
import { buildSite } from '../scripts/build-site.mjs';
import { HOUR, DAY } from '../collector/model.mjs';

const START = Date.UTC(2026, 10, 1);

// 模拟的 GitHub：3000 个 1000 星以上的核心项目 + 300 个刚建、涨得快的新项目
function fakeGitHub({ searchDown = false, graphqlDown = false } = {}) {
  const repos = [];
  for (let i = 0; i < 3000; i++) repos.push({ id: 10000 + i, name: `core${i}/repo${i}`, base: 1000 + Math.floor((i * 7919) % 60000), speed: (i % 5) / 10, created: '2020-01-01T00:00:00Z', desc: i % 3 ? 'An LLM agent' : 'PLC modbus gateway' });
  for (let i = 0; i < 300; i++) repos.push({ id: 90000 + i, name: `new${i}/rocket${i}`, base: 10, speed: 2 + (i % 4), created: new Date(START - (i % 20) * DAY).toISOString(), desc: 'video tool' });
  const deleted = new Set(['core7/repo7']);
  const calls = { search: 0, graphql: 0, trending: 0 };
  let clock = START;
  const starsOf = r => Math.floor(r.base + Math.max(0, (clock - START) / HOUR) * r.speed);
  const rest = r => ({ id: r.id, full_name: r.name, description: r.desc, language: 'Python', stargazers_count: starsOf(r), forks_count: 1, topics: [], created_at: r.created, pushed_at: r.created });
  const match = (r, q) => q.split(' ').every(part => {
    const s = starsOf(r);
    let m;
    if ((m = part.match(/^stars:>=(\d+)$/))) return s >= +m[1];
    if ((m = part.match(/^stars:(\d+)\.\.(\d+)$/))) return s >= +m[1] && s <= +m[2];
    if ((m = part.match(/^stars:(\d+)$/))) return s === +m[1];
    if ((m = part.match(/^created:>(.+)$/))) return Date.parse(r.created) > Date.parse(m[1]);
    if ((m = part.match(/^pushed:>(.+)$/))) return true;
    throw Error('未模拟的搜索条件 ' + part);
  });
  const fetch = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname === '/search/repositories') {
      calls.search++;
      if (searchDown) return new Response('{}', { status: 403, headers: { 'retry-after': '600' } });
      const hits = repos.filter(r => !deleted.has(r.name) && match(r, u.searchParams.get('q'))).sort((a, b) => starsOf(b) - starsOf(a));
      const page = +u.searchParams.get('page'), per = +u.searchParams.get('per_page');
      if (page * per > 1000) return new Response('{}', { status: 422 });
      return Response.json({ total_count: hits.length, incomplete_results: false, items: hits.slice((page - 1) * per, page * per).map(rest) });
    }
    if (u.hostname === 'github.com') {
      calls.trending++;
      return new Response('<article><h2><a href="/core5/repo5">x</a></h2>12 stars today</article><article><h2><a href="/fresh/hot">x</a></h2>99 stars today</article>');
    }
    if (u.pathname === '/graphql') {
      calls.graphql++;
      if (graphqlDown) return new Response('down', { status: 502 });
      const data = { rateLimit: { remaining: 4990, resetAt: 'x' } };
      for (const m of JSON.parse(opt.body).query.matchAll(/(r\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)/g)) {
        const name = m[2] + '/' + m[3];
        let r = repos.find(x => x.name === name);
        if (name === 'fresh/hot') r = { id: 99999, name, base: 50, speed: 30, created: new Date(START - DAY).toISOString(), desc: 'ai' };
        data[m[1]] = !r || deleted.has(name) ? null : { databaseId: r.id, nameWithOwner: r.name, description: r.desc, primaryLanguage: { name: 'Go' }, stargazerCount: starsOf(r), forkCount: 1, isArchived: false, licenseInfo: { spdxId: 'MIT' }, pushedAt: r.created, createdAt: r.created, repositoryTopics: { nodes: [] } };
      }
      return Response.json({ data });
    }
    throw Error('未模拟的地址 ' + url);
  };
  return { fetch, calls, repos, starsOf, setClock: t => { clock = t; } };
}
const opts = (gh, now, extra = {}) => { gh.setClock(now); let wall = 0; return { fetch: gh.fetch, now, token: 't', sleep: async ms => { wall += ms; }, clock: () => wall, log: () => {}, ...extra }; };

test('连续 8 天每小时运行：核心项目全覆盖、新星每小时刷新、涨星和网站数据正确', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const gh = fakeGitHub();
  const runs = [];
  for (let i = 0; i <= 24 * 8; i++) runs.push(await collect(dir, opts(gh, START + i * HOUR)));
  assert.equal(runs[0].mode, '全量');
  assert.equal(runs[1].mode, '新星');
  assert.equal(runs[3].mode, '全量', '每 3 小时一次全量扫描');
  const st = await loadState(dir);
  const repos = Object.values(st.repos);
  const core = gh.repos.filter(r => r.id < 90000 && r.name !== 'core7/repo7');
  assert.equal(repos.filter(r => r.pool === 'A' && r.id < 90000).length, core.length, '1000 星以上的项目一个不漏');
  assert.ok(!st.repos[10007], '查不到的项目被移除');
  for (const [lo, hi] of st.meta.ranges) {
    const n = core.filter(r => { const s = gh.starsOf(r); return s >= lo && (hi == null || s <= hi); }).length;
    assert.ok(n <= 1000, `分段 ${lo}..${hi} 有 ${n} 个，超过 1000`);
  }
  const c42 = st.repos[10042];
  assert.ok(Math.abs(c42.d1 - 24 * 0.2) <= 1, '核心项目 24 小时涨星 ≈ 每小时 0.2 × 24，实际 ' + c42.d1);
  assert.ok(Math.abs(c42.d7 - 7 * 24 * 0.2) <= 6, '核心项目 7 天涨星，实际 ' + c42.d7);
  const rocket = st.repos[90001];
  assert.equal(rocket.pool, 'B');
  assert.equal(st.hist[90001].recent.length > 40, true, '新星项目每小时都有采样点');
  assert.equal(rocket.d180, rocket.stars, '半年内新建的项目，近半年涨星 = 总星数');
  assert.ok(st.repos[99999], '官方热门榜里的新项目被加入');
  assert.ok(runs.every(r => r.errors === 0), JSON.stringify(runs.find(r => r.errors)?.notes));

  const out = join(dir, '_site');
  await buildSite(dir, out);
  const rank = JSON.parse(await readFile(join(out, 'data/rank/surge.json'), 'utf8'));
  assert.ok(rank.all.length > 0 && rank.all.every(id => rank.cards[id].s < 5000 || rank.cards[id].cr > '2026-08'), '急剧上涨榜只有还没大火的项目');
  const d180 = JSON.parse(await readFile(join(out, 'data/rank/d180.json'), 'utf8'));
  assert.ok(d180.all.length > 0);
  const search = JSON.parse(await readFile(join(out, 'data/search.json'), 'utf8'));
  assert.equal(search.rows.length, repos.length);
  assert.equal((await readdir(join(out, 'data/hist'))).length, 512);
  const meta = JSON.parse(await readFile(join(out, 'data/meta.json'), 'utf8'));
  assert.equal(meta.core, repos.filter(r => r.pool === 'A').length);
  for (const f of ['index.html', 'app.js', 'style.css', 'zh.js']) await stat(join(out, f));
  await rm(dir, { recursive: true });
});

test('GitHub 限流或出错时：记录问题、保留旧数据、不编造', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  await collect(dir, opts(fakeGitHub(), START));
  const before = await loadState(dir);
  const gh = fakeGitHub({ searchDown: true, graphqlDown: true });
  const run = await collect(dir, opts(gh, START + 3 * HOUR));
  assert.ok(gh.calls.search <= 3, '限流后不再狂刷');
  assert.equal(run.sampled, 0);
  assert.ok(run.errors >= 2);
  const after = await loadState(dir);
  assert.deepEqual(Object.values(after.repos).map(r => r.stars), Object.values(before.repos).map(r => r.stars));
  assert.equal(after.meta.lastFull, START, '没扫完不算完成，下次继续全量');
  await rm(dir, { recursive: true });
});

test('全量扫描超时会停下，下次接着扫', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const run = await collect(dir, opts(fakeGitHub(), START, { budgetMs: 20000 }));
  assert.match(run.notes.join(), /超时/);
  const st = await loadState(dir);
  assert.equal(st.meta.lastFull, undefined);
  assert.ok(st.meta.sweepQueue.length > 0, '记下了没扫完的分段');
  const run2 = await collect(dir, opts(fakeGitHub(), START + HOUR));
  assert.match(run2.notes.join(), /接着上次/);
  const st2 = await loadState(dir);
  assert.equal(st2.meta.sweepQueue.length, 0, '第二次把剩下的扫完');
  assert.equal(st2.meta.lastFull, START + HOUR);
  assert.equal(Object.values(st2.repos).filter(r => r.pool === 'A' && r.id < 90000).length, 2999, '两次合起来一个不漏');
  await rm(dir, { recursive: true });
});

test('没有 GITHUB_TOKEN 时给出中文提示', async () => {
  await assert.rejects(collect('/tmp/none', { token: '' }), /GITHUB_TOKEN/);
});
