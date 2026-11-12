// 数据模型：分类、星数历史、涨星计算、榜单解析
export const HOUR = 3600000;
export const DAY = 24 * HOUR;
export const KEEP_DAYS = 95;          // 历史保留天数
export const POOL_LIMIT = 3000;       // 监测池上限
export const SHARDS = 64;             // 历史数据分片数

export const CATEGORIES = [
  ['AI / 大模型', /\b(llm|llms|ai|gpt|chatgpt|openai|claude|gemini|deepseek|qwen|machine[- ]learning|deep[- ]learning|agents?|diffusion|chatbot|ollama|rag|transformers?|neural|mcp)\b/, '人工智能相关：大模型、智能助手、AI 代理或机器学习工具。'],
  ['工业 / 控制', /\b(plc|modbus|opc[- ]?ua|scada|industrial|robot|robotics|ros2?|cnc|iot|embedded|arduino|esp32|mqtt|automation[- ]control|motor|sensor|pneumatic|hmi)\b/, '工业控制、机器人、物联网或嵌入式相关项目。'],
  ['视频 / 图像', /video|image|photo|animation|ffmpeg|render|blender|camera|ocr|stable[- ]diffusion|comfyui|3d/, '视频、图片、三维或视觉内容处理相关项目。'],
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
  const hit = CATEGORIES.find(c => c[1].test(text));
  return { category: hit?.[0] || '其他项目', hint: hit?.[2] || '暂未归类，可点开原项目查看用途。' };
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
  const r = { id: v.id, name: v.name, description: (v.description || '').slice(0, 300), language: v.language || '未标注', topics: (v.topics || []).slice(0, 10), stars: v.stars, forks: v.forks || 0, archived: !!v.archived, license: v.license || '未注明', pushed: v.pushed || null, created: v.created || null, source, updated: now };
  return { ...r, ...classify(r) };
}

// 星数历史：[[时间, 星数], ...]，连续不变时只更新最后一个点的时间（压缩存储）
export function addSample(history, t, stars) {
  const h = history || [];
  const last = h.at(-1);
  if (last && t <= last[0]) return h;
  const prev = h.at(-2);
  if (last && prev && last[1] === stars && prev[1] === stars) last[0] = t;
  else h.push([t, stars]);
  return h;
}
export function prune(history, now) {
  const cut = now - KEEP_DAYS * DAY;
  let i = 0;
  while (i < history.length - 1 && history[i + 1][0] <= cut) i++;
  return history.slice(i);
}
// 某个时间点的星数（阶梯取值）；早于第一个采样时返回 null
export function starsAt(history, t) {
  let v = null;
  for (const [ts, s] of history) { if (ts <= t) v = s; else break; }
  return v;
}
// 区间净变化：历史长度不够时返回 null（显示“积累中”）
export function windowChange(history, now, ms, tolerance = 4 * HOUR) {
  if (!history?.length) return null;
  if (history[0][0] > now - ms + tolerance) return null;
  const before = starsAt(history, now - ms) ?? history[0][1];
  return history.at(-1)[1] - before;
}

// 最近一次采集的变化类型
export function signal(before, after, elapsed, previousRate = 0) {
  if (before == null || !elapsed) return { kind: '初次采样', change: null, rate: null };
  const change = after - before, rate = change / (elapsed / HOUR);
  let kind = change < 0 ? '掉星' : change === 0 ? '持平' : '正常增长';
  if (change >= 20 && rate > Math.max(10, Math.abs(previousRate) * 3)) kind = '增长加速';
  if (change >= 100 && rate >= 30) kind = '突然上涨';
  return { kind, change, rate };
}

export function shardOf(id) { return ((id % SHARDS) + SHARDS) % SHARDS; }

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

// 发现新项目用的搜索条件：按你关心的领域轮换，再加上“最近新建”的项目
export const TOPIC_QUERIES = [
  'topic:llm', 'topic:ai-agent', 'topic:chatgpt', 'topic:machine-learning', 'topic:deepseek', 'topic:mcp',
  'topic:automation', 'topic:workflow', 'topic:rpa', 'topic:productivity', 'topic:excel', 'topic:pdf',
  'topic:video', 'topic:image-processing', 'topic:stable-diffusion', 'topic:comfyui', 'topic:3d',
  'topic:plc', 'topic:modbus', 'topic:iot', 'topic:robotics', 'topic:ros', 'topic:industrial-automation', 'topic:cad',
  'topic:design', 'topic:ui', 'topic:android', 'topic:desktop-app', 'topic:self-hosted', 'topic:chinese',
];
export function discoveryQueries(cursor, now, perRun = 5) {
  const day = d => new Date(now - d * DAY).toISOString().slice(0, 10);
  const fresh = [
    { q: `created:>${day(7)} stars:>=20`, sort: 'stars' },
    { q: `created:>${day(30)} stars:>=200`, sort: 'stars' },
    { q: `pushed:>${day(2)} stars:>=1000`, sort: 'updated' },
  ];
  const topics = [];
  for (let i = 0; i < perRun; i++) {
    const n = cursor + i, q = TOPIC_QUERIES[n % TOPIC_QUERIES.length];
    topics.push({ q: q + (Math.floor(n / TOPIC_QUERIES.length) % 2 ? ' stars:>=50' : ''), sort: Math.floor(n / TOPIC_QUERIES.length) % 2 ? 'updated' : 'stars' });
  }
  return [...fresh, ...topics];
}
