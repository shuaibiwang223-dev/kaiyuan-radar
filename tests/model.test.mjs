import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, addSample, prune, starsAt, windowChange, signal, parseTrending, discoveryQueries, fromRest, fromGraphQL, HOUR, DAY, KEEP_DAYS } from '../collector/model.mjs';

test('中文分类：AI、工业控制、兜底', () => {
  assert.equal(classify({ name: 'x/y', description: 'An LLM agent framework' }).category, 'AI / 大模型');
  assert.equal(classify({ name: 'x/modbus-tool', description: 'Modbus TCP client for PLC' }).category, '工业 / 控制');
  assert.equal(classify({ name: 'x/y', description: 'rapid capital' }).category, '其他项目'); // 不把 rapid 里的 api 当成关键词
  assert.match(classify({ name: 'a/b', description: '' }).hint, /[一-鿿]/);
});

test('历史压缩：星数不变时不重复存点，但时间往后延', () => {
  const h = [];
  addSample(h, 1, 10); addSample(h, 2, 10); addSample(h, 3, 10); addSample(h, 4, 12);
  assert.deepEqual(h, [[1, 10], [3, 10], [4, 12]]);
  addSample(h, 4, 99); // 同一时间不重复记录
  assert.equal(h.length, 3);
});

test('区间涨星：历史不够时返回 null，够了按阶梯取值', () => {
  const now = 10 * DAY;
  const h = [[now - 2 * DAY, 100], [now - DAY - HOUR, 110], [now, 150]];
  assert.equal(windowChange(h, now, DAY), 40);
  assert.equal(windowChange(h, now, 7 * DAY), null);
  assert.equal(starsAt(h, now - 3 * DAY), null);
  assert.equal(windowChange([], now, DAY), null);
});

test('历史只保留 95 天，并留一个基准点', () => {
  const now = 200 * DAY;
  const h = [[now - 100 * DAY, 1], [now - 96 * DAY, 2], [now - 10 * DAY, 3]];
  assert.deepEqual(prune(h, now), [[now - 96 * DAY, 2], [now - 10 * DAY, 3]]);
  assert.equal(KEEP_DAYS, 95);
});

test('变化类型：首次、持平、掉星、突然上涨', () => {
  assert.equal(signal(null, 5, 0).kind, '初次采样');
  assert.equal(signal(5, 5, 3 * HOUR).kind, '持平');
  assert.equal(signal(5, 3, 3 * HOUR).kind, '掉星');
  assert.equal(signal(100, 500, 3 * HOUR).kind, '突然上涨');
  assert.equal(signal(100, 140, 3 * HOUR, 1).kind, '增长加速');
});

test('官方热门榜解析', () => {
  const html = '<article class="Box-row"><h2 class="h3"><a href="/foo/bar">foo / bar</a></h2><span>1,234 stars today</span></article><article><h2><a href="/sponsors/x?y">s</a></h2></article>';
  assert.deepEqual(parseTrending(html), [{ name: 'foo/bar', rank: 1, gain: 1234 }]);
});

test('搜索条件轮换且包含最近新建项目', () => {
  const qs = discoveryQueries(0, Date.UTC(2026, 10, 12));
  assert.equal(qs.length, 8);
  assert.match(qs[0].q, /^created:>2026-11-05/);
  assert.notDeepEqual(discoveryQueries(5, 0).slice(3), discoveryQueries(0, 0).slice(3));
});

test('拒绝格式异常的数据', () => {
  assert.throws(() => fromRest({ id: 'x' }, 's', 0));
  assert.throws(() => fromGraphQL({ databaseId: 1 }, 's', 0));
  assert.equal(fromGraphQL({ databaseId: 1, nameWithOwner: 'a/b', stargazerCount: 3, primaryLanguage: null }, 's', 0).language, '未标注');
});
