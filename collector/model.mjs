// 数据模型：分类、星数历史、涨星计算、榜单解析
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const CORE_MIN_STARS = 1000;   // 核心池：全站 1000 星以上，全部监测
export const RISING_LIMIT = 15000;    // 新星池上限（1000 星以下、涨得快的项目）
export const KEEP_DAYS = 200;         // 每日历史保留天数（够算“近半年”）
export const RECENT_HOURS = 50;       // 最近两天保留逐次采样点
export const WINDOWS = { d1: DAY, d7: 7 * DAY, d30: 30 * DAY, d180: 180 * DAY };

export const CATEGORIES = [
  ['AI / 大模型', /\b(llm|llms|ai|gpt|chatgpt|openai|claude|gemini|deepseek|qwen|machine[- ]learning|deep[- ]learning|agents?|diffusion|chatbot|ollama|rag|transformers?|neural|mcp)\b/, '人工智能相关：大模型、智能助手、AI 代理或机器学习工具。'],
  ['工业 / 控制', /\b(plc|modbus|opc[- ]?ua|scada|industrial|robot|robotics|ros2?|cnc|iot|embedded|arduino|esp32|mqtt|motor|sensor|pneumatic|hmi|firmware)\b/, '工业控制、机器人、物联网或嵌入式相关项目。'],
  ['视频 / 图像', /video|image|photo|animation|ffmpeg|render|blender|camera|ocr|stable[- ]diffusion|comfyui|\b3d\b/, '视频、图片、三维或视觉内容处理相关项目。'],
  ['办公 / 自动化', /automat|workflow|productivity|office|spreadsheet|excel|pdf|document|rpa|scraper|crawler|n8n|notion/, '自动化流程、办公文档处理或提高效率的工具。'],
  ['设计 / 前端', /design|react|vue|frontend|css|tailwind|component|next\.js|svelte|figma|\bui\b/, '界面设计、网页开发或前端组件。'],
  ['数据 / 存储', /database|\bsql\b|data[- ]engineer|redis|analytics|storage|postgres|mysql|vector|search[- ]engine/, '数据存储、检索或数据分析相关项目。'],
  ['移动 / 桌面', /android|\bios\b|desktop|electron|flutter|mobile|tauri|windows|macos/, '手机应用、桌面软件或相关开发工具。'],
  ['学习 / 教程', /tutorial|course|learn|interview|awesome|roadmap|example|book|guide|cheatsheet/, '教程、学习资料、资源合集或示例代码。'],
  ['安全 / 网络', /security|pentest|vulnerab|firewall|vpn|proxy|privacy|encrypt|network/, '网络、安全防护或隐私相关工具。'],
  ['开发工具', /compiler|framework|library|sdk|\bcli\b|editor|package|terminal|debug|server|\bapi\b|devops|docker|kubernetes/, '写代码、构建、调试、部署或服务器相关工具。'],
];
export const CATEGORY_NAMES = [...CATEGORIES.map(c => c[0]), '其他项目'];

export function classify(r) {
  const text = [r.name, r.description, ...(r.topics || [])].join(' ').toLowerCase();
  return CATEGORIES.find(c => c[1].test(text))?.[0] || '其他项目';
}

// 统一 REST / GraphQL 两种返回格式
export function fromRest(r, source, now) {
  if (!Number.isInteger(r?.id) || !Number.isSafeInteger(r?.stargazers_count) || !r.full_name) throw Error('仓库数据格式异常');
  return base({ id: r.id, name: r.full_name, description: r.description, language: r.language, topics: r.topics, stars: r.stargazers_count, forks: r.forks_count, archived: r.archived, license: r.license?.spdx_id, pushed: r.pushed_at, created: r.created_at }, source, now);
}
export function fromGraphQL(r, source, now) {
  if (!Number.isInteger(r?.databaseId) || !Number.isSafeInteger(r?.stargazerCount) || !r.nameWithOwner) throw Error('仓库数据格式异常');
  return base({ id: r.databaseId, name: r.nameWithOwner, description: r.description, language: r.primaryLanguage?.name, topics: (r.repositoryTopics?.nodes || []).map(n => n.topic?.name).filter(Boolean), stars: r.stargazerCount, forks: r.forkCount, archived: r.isArchived, license: r.licenseInfo?.spdxId, pushed: r.pushedAt, created: r.createdAt }, source, now);
}
function base(v, source, now) {
  const r = { id: v.id, name: v.name, description: (v.description || '').slice(0, 300), language: v.language || '未标注', topics: (v.topics || []).slice(0, 8), stars: v.stars, forks: v.forks || 0, archived: !!v.archived, license: v.license || '未注明', pushed: v.pushed || null, created: v.created || null, source, updated: now };
  r.category = classify(r);
  return r;
}

// ---------- 星数历史 ----------
// 每个项目：{ d0: 第一天的日序号, days: [每天最后一次的星数], recent: [[时间, 星数], ...最近 50 小时] }
export const dayIndex = t => Math.floor(t / DAY);
export function addSample(h, t, stars) {
  h ||= { f: t, d0: dayIndex(t), days: [], recent: [] };
  const last = h.recent.at(-1);
  if (last && t <= last[0]) return h;
  h.recent.push([t, stars]);
  const cut = t - RECENT_HOURS * HOUR;
  while (h.recent.length > 2 && h.recent[1][0] <= cut) h.recent.shift();
  const di = dayIndex(t);
  if (!h.days.length) h.d0 = di;
  const idx = di - h.d0;
  while (h.days.length < idx) h.days.push(h.days.at(-1) ?? stars); // 中间漏掉的天沿用前一天
  h.days[idx] = stars;
  if (h.days.length > KEEP_DAYS) { const drop = h.days.length - KEEP_DAYS; h.days.splice(0, drop); h.d0 += drop; }
  return h;
}
// 某个时间点的星数；早于记录开始时返回 null
export function starsAt(h, t) {
  if (!h) return null;
  if (h.recent.length && t >= h.recent[0][0]) {
    let v = null;
    for (const [ts, s] of h.recent) { if (ts <= t) v = s; else break; }
    return v;
  }
  const idx = dayIndex(t) - h.d0;
  if (idx < 0 || !h.days.length) return null;
  return h.days[Math.min(idx, h.days.length - 1)];
}
// 最早的采样时间（每日数据被裁掉后，按保留的第一天算）
export function firstSampleTime(h) {
  if (!h) return null;
  return Math.max(h.f ?? 0, h.days.length ? h.d0 * DAY : 0) || h.recent[0]?.[0] || null;
}
// 区间净涨星：历史不够时，如果项目是区间内新建的，涨星 = 现有星数（新项目从 0 开始）；否则返回 null（显示“积累中”）
export function windowChange(h, stars, created, now, ms, tolerance = 2 * HOUR) {
  const start = now - ms;
  if (created && Date.parse(created) >= start) return stars;
  const earliest = firstSampleTime(h);
  if (earliest == null || earliest > start + tolerance) return null;
  const before = starsAt(h, Math.max(start, earliest));
  return before == null ? null : stars - before;
}
// 画走势图用：每日点 + 最近逐次点
export function series(h) {
  if (!h) return [];
  const pts = h.days.map((v, i) => [(h.d0 + i) * DAY + DAY - 1, v]);
  const firstRecent = h.recent[0]?.[0] ?? Infinity;
  return [...pts.filter(p => p[0] < firstRecent), ...h.recent];
}
// 存盘时压缩：每日数据存差值
export const packHistory = h => ({ f: h.f, d0: h.d0, days: h.days.map((v, i) => i ? v - h.days[i - 1] : v), recent: h.recent });
export const unpackHistory = h => { let acc = 0; return { f: h.f, d0: h.d0, days: h.days.map((v, i) => (acc = i ? acc + v : v)), recent: h.recent }; };

// 最近一次采集的变化类型
export function signal(before, after, elapsed, previousRate = 0) {
  if (before == null || !elapsed) return { kind: '初次采样', change: null, rate: null };
  const change = after - before, rate = change / (elapsed / HOUR);
  let kind = change < 0 ? '掉星' : change === 0 ? '持平' : '正常增长';
  if (change >= 20 && rate > Math.max(10, Math.abs(previousRate) * 3)) kind = '增长加速';
  if (change >= 100 && rate >= 30) kind = '突然上涨';
  return { kind, change, rate };
}
// 急剧上涨：一天涨 50 星以上，并且涨幅超过原来的 20%；或者最近一次被判定为“突然上涨”
export function isSurging(r) {
  if (r.kind === '突然上涨') return true;
  return r.d1 != null && r.d1 >= 50 && r.d1 / Math.max(r.stars - r.d1, 50) >= 0.2;
}

export function parseTrending(html) {
  const rows = [];
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/g)) {
    const title = article[1].match(/<h2\b[^>]*>[\s\S]*?href="\/([^"?#]+)"/);
    if (!title || !/^[-\w.]+\/[-\w.]+$/.test(title[1])) continue;
    const gain = article[1].match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
    rows.push({ name: title[1], rank: rows.length + 1, gain: gain ? Number(gain[1].replaceAll(',', '')) : null });
  }
  return rows;
}

// 新星发现：最近新建、涨得快的项目（每小时都搜）
export function risingQueries(now, hourTick) {
  const day = d => new Date(now - d * DAY).toISOString().slice(0, 10);
  const all = [
    { q: `created:>${day(2)} stars:>=10`, pages: 2 },
    { q: `created:>${day(7)} stars:>=30`, pages: 3 },
    { q: `created:>${day(30)} stars:>=100`, pages: 3 },
    { q: `created:>${day(90)} stars:300..999`, pages: 3 },
    { q: `created:>${day(180)} stars:500..999`, pages: 3 },
    { q: `pushed:>${day(1)} stars:200..999`, pages: 2 },
  ];
  // 每小时跑前 3 组，后 3 组轮流跑，节省查询次数
  return [...all.slice(0, 3), all[3 + (hourTick % 3)]];
}

// 核心池扫描分区：把 1000 星以上切成若干段，每段不超过 1000 个（GitHub 搜索单次最多给 1000 条）
export function splitRange([lo, hi]) {
  if (hi === Infinity) return [[lo, lo * 4 - 1], [lo * 4, Infinity]];
  const mid = Math.max(lo, Math.floor(Math.sqrt(lo * (hi + 1))) - 1);
  return mid >= hi ? [[lo, lo], [lo + 1, hi]] : [[lo, mid], [mid + 1, hi]];
}
export const rangeQuery = ([lo, hi]) => hi === Infinity ? `stars:>=${lo}` : lo === hi ? `stars:${lo}` : `stars:${lo}..${hi}`;
// 合并相邻的小分区，减少查询次数
export function mergeRanges(ranges, counts, limit = 700) {
  const out = [];
  for (const [i, r] of ranges.entries()) {
    const last = out.at(-1);
    if (last && last.n + (counts[i] ?? limit) <= limit && last.r[1] + 1 === r[0]) { last.r = [last.r[0], r[1]]; last.n += counts[i]; }
    else out.push({ r: [...r], n: counts[i] ?? limit });
  }
  return out.map(x => x.r);
}
