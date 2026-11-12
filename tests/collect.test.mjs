import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { collect } from '../collector/collect.mjs';
import { HOUR, DAY } from '../collector/model.mjs';

// 模拟的 GitHub：200 个项目，星数随时间增长；第 7 号项目会被删除
function fakeGitHub({ rateLimitSearch = false, graphqlDown = false } = {}) {
  const repos = Array.from({ length: 200 }, (_, i) => ({ id: 1000 + i, name: `owner${i}/repo${i}`, base: 100 * i, speed: i % 10 }));
  const deleted = new Set(['owner7/repo7']);
  const calls = { search: 0, graphql: 0, trending: 0 };
  const starsOf = (r, now) => r.base + Math.floor(now / HOUR) * r.speed;
  let clock = 0;
  const fetch = async (url, opt = {}) => {
    const u = new URL(url);
    if (u.pathname === '/search/repositories') {
      calls.search++;
      if (rateLimitSearch) return new Response('{}', { status: 403 });
      const k = calls.search % 10;
      const items = repos.slice(k * 15, k * 15 + 30).filter(r => !deleted.has(r.name)).map(r => ({ id: r.id, full_name: r.name, description: 'An AI tool', language: 'Python', stargazers_count: starsOf(r, clock), topics: ['ai'] }));
      return Response.json({ items });
    }
    if (u.hostname === 'github.com' && u.pathname === '/trending') {
      calls.trending++;
      return new Response('<article><h2><a href="/owner150/repo150">x</a></h2>12 stars today</article><article><h2><a href="/newbie/hot">x</a></h2>99 stars today</article>');
    }
    if (u.pathname === '/graphql') {
      calls.graphql++;
      if (graphqlDown) return new Response('down', { status: 502 });
      const query = JSON.parse(opt.body).query;
      const data = { rateLimit: { remaining: 4990, resetAt: 'x' } };
      for (const m of query.matchAll(/(r\d+):repository\(owner:"([^"]+)",name:"([^"]+)"\)/g)) {
        const name = m[2] + '/' + m[3];
        let r = repos.find(x => x.name === name);
        if (name === 'newbie/hot') r = { id: 9999, name, base: 50, speed: 30 };
        data[m[1]] = !r || deleted.has(name) ? null : { databaseId: r.id, nameWithOwner: r.name, description: 'A modbus PLC gateway', primaryLanguage: { name: 'Go' }, stargazerCount: starsOf(r, clock), forkCount: 1, isArchived: false, licenseInfo: { spdxId: 'MIT' }, pushedAt: '2026-11-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z', repositoryTopics: { nodes: [] } };
      }
      return Response.json({ data });
    }
    throw Error('未模拟的地址 ' + url);
  };
  return { fetch, calls, setClock: t => { clock = t; } };
}
const opts = (gh, now) => { gh.setClock(now); return { fetch: gh.fetch, now, token: 't', sleep: async () => {}, log: () => {} }; };
const read = async (dir, f) => JSON.parse(await readFile(join(dir, f), 'utf8'));

test('连续 9 天每 3 小时采集：涨星、热门榜、失效项目、数据文件都正确', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const gh = fakeGitHub();
  const start = Date.UTC(2026, 10, 1);
  let first;
  for (let i = 0; i <= 8 * 9; i++) {
    const run = await collect(dir, opts(gh, start + i * 3 * HOUR));
    if (i === 0) first = run;
  }
  assert.ok(first.discovered > 0);
  const repos = await read(dir, 'repos.json');
  const meta = await read(dir, 'meta.json');
  const r42 = repos.find(r => r.name === 'owner42/repo42');
  assert.equal(r42.d1, 2 * 24, '速度 2/小时 → 24 小时涨 48');
  assert.equal(r42.d7, 2 * 24 * 7);
  assert.equal(r42.d30, null, '不满 30 天显示积累中');
  assert.equal(r42.category, 'AI / 大模型');
  assert.ok(repos.some(r => r.name === 'newbie/hot' && r.source === '原生热门榜'), '热门榜里的新项目会被加入监测');
  assert.ok(!repos.some(r => r.name === 'owner7/repo7'), '连续查不到的项目被移除');
  assert.equal(meta.pending.length, 0);
  assert.equal(meta.runs.length, 30);
  assert.equal(meta.runs[0].errors, 0);
  const changes = await read(dir, 'changes.json');
  assert.ok(changes.length > 0 && changes.length <= 500);
  assert.ok(changes.every(c => c.delta !== 0));
  const h = (await read(dir, 'history/' + (1042 % 64) + '.json'))['1042'];
  assert.ok(h.length > 10 && h.at(-1)[1] === r42.stars);
  const flat = (await read(dir, 'history/' + (1040 % 64) + '.json'))['1040'];
  assert.equal(flat.length, 2, '星数一直不变的项目只存两个点');
  assert.ok(gh.calls.trending <= 3 * 37, '热门榜每 6 小时才抓一次');
  await rm(dir, { recursive: true });
});

test('GitHub 限流或出错时：记录问题、保留旧数据、不编造', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  const now = Date.UTC(2026, 10, 1);
  await collect(dir, opts(fakeGitHub(), now));
  const before = await read(dir, 'repos.json');
  const gh = fakeGitHub({ rateLimitSearch: true, graphqlDown: true });
  const run = await collect(dir, opts(gh, now + 3 * HOUR));
  assert.equal(gh.calls.search, 1, '限流后立刻停止搜索');
  assert.equal(run.sampled, 0);
  assert.ok(run.errors >= 2);
  const after = await read(dir, 'repos.json');
  assert.equal(after.length, before.length);
  assert.deepEqual(after.map(r => r.stars), before.map(r => r.stars));
  await rm(dir, { recursive: true });
});

test('没有 GITHUB_TOKEN 时给出中文提示', async () => {
  await assert.rejects(collect('/tmp/none', { token: '' }), /GITHUB_TOKEN/);
});

test('生成网站目录：网页 + 数据', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'radar-'));
  await collect(join(dir, 'state'), opts(fakeGitHub(), Date.UTC(2026, 10, 1)));
  execFileSync('node', ['scripts/build-site.mjs', join(dir, 'state'), join(dir, '_site')]);
  const files = await readdir(join(dir, '_site'));
  for (const f of ['index.html', 'app.js', 'zh.js', 'style.css', 'manifest.json', 'icon.svg', 'data']) assert.ok(files.includes(f), f);
  assert.equal((await readdir(join(dir, '_site', 'data', 'history'))).length, 64);
  await rm(dir, { recursive: true });
});
