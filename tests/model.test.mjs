import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, addSample, starsAt, windowChange, signal, isSurging, parseTrending, risingQueries, splitRange, rangeQuery, mergeRanges, packHistory, unpackHistory, series, HOUR, DAY, KEEP_DAYS } from '../collector/model.mjs';

test('中文分类：AI、工业控制、兜底', () => {
  assert.equal(classify({ name: 'x/y', description: 'An LLM agent framework' }), 'AI / 大模型');
  assert.equal(classify({ name: 'x/modbus-tool', description: 'Modbus TCP client for PLC' }), '工业 / 控制');
  assert.equal(classify({ name: 'x/y', description: 'rapid capital' }), '其他项目');
});

test('历史：最近逐次点 + 每日点，跨天自动补齐，最多保留 200 天', () => {
  let h;
  const t0 = 1000 * DAY;
  h = addSample(h, t0 + HOUR, 10);
  h = addSample(h, t0 + 5 * HOUR, 12);
  h = addSample(h, t0 + 3 * DAY, 30); // 中间两天没有采样
  assert.deepEqual(h.days, [12, 12, 12, 30]);
  assert.equal(starsAt(h, t0 + 2 * HOUR), 12, '两天前的逐次点已裁掉，按当天最后的星数算');
  assert.equal(h.recent.length, 2, '超过 50 小时的逐次点被裁掉，但至少留两个');
  for (let d = 4; d < 300; d++) h = addSample(h, t0 + d * DAY, 30 + d);
  assert.equal(h.days.length, KEEP_DAYS);
  assert.deepEqual(unpackHistory(JSON.parse(JSON.stringify(packHistory(h)))), h, '压缩存盘再读回来完全一致');
  assert.ok(series(h).length >= KEEP_DAYS);
});

test('区间涨星：历史够就相减；区间内新建的项目直接算总星数；否则“积累中”', () => {
  const now = Date.UTC(2026, 10, 12, 12);
  let h;
  for (let t = now - 10 * DAY; t <= now; t += 3 * HOUR) h = addSample(h, t, Math.floor((t - (now - 10 * DAY)) / HOUR));
  const stars = 240;
  assert.equal(windowChange(h, stars, '2010-01-01T00:00:00Z', now, DAY), 24);
  assert.ok(Math.abs(windowChange(h, stars, '2010-01-01T00:00:00Z', now, 7 * DAY) - 168) <= 24, '7 天按每日点计算，误差不超过一天');
  assert.equal(windowChange(h, stars, '2010-01-01T00:00:00Z', now, 30 * DAY), null);
  assert.equal(windowChange(h, stars, new Date(now - 100 * DAY).toISOString(), now, 180 * DAY), 240, '100 天前新建的项目，近半年涨星 = 总星数');
});

test('变化类型和“急剧上涨”判断', () => {
  assert.equal(signal(null, 5, 0).kind, '初次采样');
  assert.equal(signal(5, 3, HOUR).kind, '掉星');
  assert.equal(signal(100, 500, 3 * HOUR).kind, '突然上涨');
  assert.ok(isSurging({ stars: 300, d1: 120 }));
  assert.ok(!isSurging({ stars: 50000, d1: 120 }), '大项目涨 120 不算急剧');
});

test('扫描分区：切分、查询语句、合并小分区', () => {
  assert.deepEqual(splitRange([1000, Infinity]), [[1000, 3999], [4000, Infinity]]);
  const [a, b] = splitRange([1000, 1999]);
  assert.equal(a[0], 1000); assert.equal(b[1], 1999); assert.equal(a[1] + 1, b[0]);
  assert.deepEqual(splitRange([1000, 1001]), [[1000, 1000], [1001, 1001]]);
  assert.equal(rangeQuery([5, Infinity]), 'stars:>=5');
  assert.equal(rangeQuery([7, 7]), 'stars:7');
  assert.deepEqual(mergeRanges([[1, 5], [6, 9], [10, 20]], [300, 300, 900]), [[1, 9], [10, 20]]);
});

test('官方热门榜解析、新星搜索条件', () => {
  const html = '<article class="Box-row"><h2 class="h3"><a href="/foo/bar">foo / bar</a></h2><span>1,234 stars today</span></article>';
  assert.deepEqual(parseTrending(html), [{ name: 'foo/bar', rank: 1, gain: 1234 }]);
  const qs = risingQueries(Date.UTC(2026, 10, 12), 0);
  assert.equal(qs.length, 4);
  assert.match(qs[0].q, /^created:>2026-11-10/);
  assert.notDeepEqual(risingQueries(0, 1)[3], risingQueries(0, 2)[3]);
});
