# 技能雷达：把 collect.sh 抓到的 raw.jsonl 整理成网页用的 data.json
# 用法：python3 build.py   （在放 raw.jsonl 的目录里运行；同目录的 skills-hist.json.gz 用来算实际涨星）
import json,re,datetime,gzip,os,sys
now=datetime.datetime.now(datetime.timezone.utc)
seen={}
for line in open('raw.jsonl',encoding='utf-8'):
    line=line.strip()
    if not line.startswith('['): continue
    try: arr=json.loads(line)
    except Exception: continue
    for r in arr: seen[r['fullName'].lower()]=r
CATS=[('电商',r'e-?commerce|电商|shopify|amazon|亚马逊|taobao|淘宝|天猫|1688|拼多多|tiktok shop|etsy|ebay|选品|listing|跨境|dropship|seller'),
('社媒运营',r'xiaohongshu|小红书|rednote|douyin|抖音|tiktok|twitter|wechat|公众号|微信|social media|youtube|bilibili|instagram|linkedin|自媒体|reddit|telegram|discord'),
('营销销售',r'\bseo\b|marketing|营销|广告|\bads?\b|growth|copywrit|文案|sales|销售|\bgeo\b|\bcrm\b|lead gen|customer support|客服|brand'),
('金融投资',r'financ|金融|stock|股票|trading|trader|quant|invest|投资|crypto|defi|加密|accounting|会计|\btax|财务|基金|bank'),
('法律合规',r'legal|\blaws?\b|lawyer|法律|合同|contract|compliance|合规|patent|专利'),
('医疗健康',r'medical|medicine|health|医疗|医学|健康|clinical|\bbio|drug|fitness|健身|nutrition|心理|therapy'),
('教育学习',r'educat|教育|learn|学习|teach|教学|tutor|course|课程|\bexams?\b|考试|student|flashcard|language learning|英语'),
('科研学术',r'research|研究|调研|scien|科研|论文|paper|academic|学术|arxiv|literature|citation|thesis'),
('视频音频',r'video|视频|remotion|剪辑|audio|podcast|语音|\btts\b|music|音乐|动画|animation|shorts|字幕|subtitle'),
('设计视觉',r'design|设计|\bui\b|\bux\b|figma|image|生图|图片|封面|ppt|slides|海报|poster|logo|illustrat|\b3d\b|blender|svg|diagram|画图'),
('写作翻译',r'writing|writer|写作|小说|novel|blog|博客|translat|翻译|humaniz|去ai味|newsletter|\bstor(y|ies)\b|editor'),
('办公文档',r'docx|xlsx|excel|pdf|office|\bword\b|文档|notion|obsidian|笔记|\bnote|spreadsheet|email|邮件|calendar|meeting|会议|feishu|飞书|钉钉|lark'),
('数据分析',r'\bdata\b|数据|analy|分析|\bsql\b|dashboard|可视化|visualiz|scrap|爬虫|crawl'),
('产品职场',r'product manag|\bpm\b|产品经理|startup|创业|career|求职|resume|简历|interview|面试|\bhr\b|recruit|招聘|business|商业|consult|管理'),
('安全',r'security|安全|pentest|渗透|vuln|漏洞|\bctf\b|audit|hack|malware|threat'),
('自动化效率',r'automat|自动化|workflow|工作流|browser|浏览器|productiv|效率|\bn8n\b|zapier|rpa|schedule|memory|记忆'),
('游戏娱乐',r'game|游戏|unity|godot|unreal|roblox|minecraft|娱乐|anime|动漫'),
('生活',r'travel|旅行|旅游|cook|recipe|美食|菜谱|\bhome\b|家居|shopping|购物|parent|育儿|\bpets?\b|宠物|astrolog|占卜|tarot|算命|八字'),
('合集导航',r'awesome|collection|curated|合集|大全|marketplace|directory|registry|library|精选|\blist\b|\bhub\b|catalog'),
('开发编程',r'code|coding|dev|编程|开发|react|python|rust|typescript|javascript|golang|java\b|swift|kotlin|flutter|test|debug|git|\bapi\b|mcp|engineer|devops|docker|kubernetes|cloud|database|frontend|backend|\bcli\b|terminal|linux|web')]

# 历史星标：{ "YYYY-MM-DDTHH": {仓库: 星标数} }，最多留 9 天
HIST='skills-hist.json.gz'
hist={}
if os.path.exists(HIST):
    try: hist=json.load(gzip.open(HIST,'rt',encoding='utf-8'))
    except Exception: hist={}
def snap_before(hours):
    """找离“hours 小时前”最近的一份快照（允许前后一半的误差），返回 (快照, 实际相隔小时数)"""
    best=None
    for k,v in hist.items():
        t=datetime.datetime.strptime(k,'%Y-%m-%dT%H').replace(tzinfo=datetime.timezone.utc)
        gap=(now-t).total_seconds()/3600
        if gap<hours*0.5 or gap>hours*1.5: continue
        if best is None or abs(gap-hours)<abs(best[1]-hours): best=(v,gap)
    return best
s1=snap_before(24); s7=snap_before(168)
out=[]
for r in seen.values():
    d=(r.get('description') or '').strip()
    txt=(r['fullName']+' '+d).lower()
    if not re.search(r'skill|技能',txt): continue
    s=r['stargazersCount']
    if s<10: continue
    c=datetime.datetime.fromisoformat(r['createdAt'].replace('Z','+00:00'))
    age=max((now-c).days,1)
    cat='其他'
    for name,pat in CATS:
        if re.search(pat,txt): cat=name;break
    it={'n':r['fullName'],'s':s,'d':d[:140],'c':r['createdAt'][:10],'p':r['pushedAt'][:10],'l':r.get('language') or '','k':cat,'v':round(s/age,1)}
    if s1 and r['fullName'] in s1[0]: it['g1']=s-s1[0][r['fullName']]
    if s7 and r['fullName'] in s7[0]: it['g7']=s-s7[0][r['fullName']]
    out.append(it)
if len(out)<1500:
    print('只采到 %d 个仓库，少于 1500，判定为采集失败，保留旧数据'%len(out)); sys.exit(1)
out.sort(key=lambda x:-x['s'])
hist[now.strftime('%Y-%m-%dT%H')]={x['n']:x['s'] for x in out}
cut=(now-datetime.timedelta(days=9)).strftime('%Y-%m-%dT%H')
hist={k:v for k,v in hist.items() if k>=cut}
json.dump(hist,gzip.open(HIST,'wt',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
json.dump({'at':now.strftime('%Y-%m-%dT%H:%MZ'),'has1':bool(s1),'has7':bool(s7),'cats':[c[0] for c in CATS]+['其他'],'items':out},open('skills-data.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('采集到 %d 个 Skill 仓库'%len(out))
