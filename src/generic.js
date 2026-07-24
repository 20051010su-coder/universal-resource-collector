const crypto = require('node:crypto');
const { stripTags, cleanTitle, targetCategory } = require('./shared');

const DRIVE_HOSTS = {
  'pan.xunlei.com': '迅雷', 'pan.quark.cn': '夸克', 'pan.baidu.com': '百度',
  'www.aliyundrive.com': '阿里云盘', 'www.alipan.com': '阿里云盘',
  'drive.uc.cn': 'UC', '115.com': '115', 'cloud.189.cn': '天翼云盘'
};

const SPEED_PROFILES = {
  fast: { concurrency: 12, listDelayMs: 0, articleDelayMs: 0, timeoutMs: 18000, retries: 1 },
  stable: { concurrency: 3, listDelayMs: 300, articleDelayMs: 600, timeoutMs: 25000, retries: 3 },
  custom: { concurrency: 5, listDelayMs: 100, articleDelayMs: 250, timeoutMs: 25000, retries: 2 }
};

const PRESET_RULES = {
  'dyyjv.com': {
    name: '电影云集',
    listItemClass: 'post-item',
    categoryFeeds: [
      ['电影', 'https://dyyjv.com/category/dianying'],
      ['剧集', 'https://dyyjv.com/category/%E5%89%A7%E9%9B%86'],
      ['短剧', 'https://dyyjv.com/category/%E7%9F%AD%E5%89%A7'],
      ['动漫', 'https://dyyjv.com/category/dongman'],
      ['综艺', 'https://dyyjv.com/category/zongyi'],
      ['读物', 'https://dyyjv.com/category/%E8%AF%BB%E7%89%A9'],
      ['音频', 'https://dyyjv.com/category/%E9%9F%B3%E9%A2%91'],
      ['学习', 'https://dyyjv.com/category/xuexi'],
      ['游戏', 'https://dyyjv.com/category/%E6%B8%B8%E6%88%8F']
    ].map(([source, url]) => ({ source, url, pagePattern: '{base}/page/{page}' }))
  },
  'www.uvwhd.com': { name: '高清电影网', legacy: 'uvwhd' },
  'uvwhd.com': { name: '高清电影网', legacy: 'uvwhd' }
};

function normalizeStartUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('请输入网站或栏目网址');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^https?:\/\//i.test(value)) throw new Error('只支持公开的 HTTP/HTTPS 网页');
  const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只支持公开的 HTTP/HTTPS 网页');
  url.hash = '';
  return url.toString();
}

function driveType(raw) {
  try { return DRIVE_HOSTS[new URL(raw).hostname.toLowerCase()] || ''; } catch { return ''; }
}

function normalizeDriveUrl(raw = '') {
  const cleaned = String(raw).replace(/&amp;/g, '&').trim().replace(/[。；，,;]+$/g, '');
  try {
    const url = new URL(cleaned);
    if (!driveType(url.toString())) return '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

function extractDriveLinks(html = '', mode = { type: 'all', drives: [] }) {
  const found = new Map();
  const regex = /https?:\/\/(?:pan\.xunlei\.com|pan\.quark\.cn|pan\.baidu\.com|www\.aliyundrive\.com|www\.alipan\.com|drive\.uc\.cn|115\.com|cloud\.189\.cn)\/[^\s"'<>]+/gi;
  for (const match of String(html).matchAll(regex)) {
    const url = normalizeDriveUrl(match[0]);
    const type = driveType(url);
    if (!url || !type) continue;
    const key = url.replace(/[?&](?:pwd|password)=[^&#]*/i, '');
    if (!found.has(key) || url.length > found.get(key).originalUrl.length) found.set(key, { originalUrl: url, driveType: type, originalAccessCode: new URL(url).searchParams.get('pwd') || '', variant: type });
  }
  let links = [...found.values()];
  if (mode?.type === 'selected') links = links.filter(link => (mode.drives || []).includes(link.driveType));
  if (mode?.type === 'xunlei_first' && links.some(link => link.driveType === '迅雷')) links = links.filter(link => link.driveType === '迅雷');
  return links;
}

function absolutize(href, base) { try { const u = new URL(href, base); u.hash = ''; return u.toString(); } catch { return ''; } }

function extractGenericList(html = '', baseUrl = '', rule = null) {
  const origin = new URL(baseUrl).origin;
  const seen = new Set(); const items = [];
  let fragments = [String(html)];
  if (rule?.listItemClass) {
    const escaped = String(rule.listItemClass).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const itemPattern = new RegExp(`<article\\b[^>]*class=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>[\\s\\S]*?<\\/article>`, 'gi');
    const matched = [...String(html).matchAll(itemPattern)].map(match => match[0]);
    if (matched.length) fragments = matched;
  }
  const anchors = fragments.flatMap(fragment => [...fragment.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]);
  for (const match of anchors) {
    const url = absolutize(match[1], baseUrl); const title = stripTags(match[2]);
    if (!url || !url.startsWith(origin) || title.length < 2 || /登录|注册|首页|下一页|上一页|更多|分类|标签/.test(title)) continue;
    const genericMatch = /(?:\/\d+\.html|\/archives?\/|\/post\/|\/detail\/|[?&](?:itemid|p|id)=\d+)/i.test(url);
    let customMatch = false; try { customMatch = rule?.detailUrlPattern ? new RegExp(rule.detailUrlPattern).test(new URL(url).pathname) : false; } catch {}
    if (!genericMatch && !customMatch) continue;
    if (seen.has(url)) continue; seen.add(url);
    items.push({ id: crypto.createHash('sha1').update(url).digest('hex').slice(0, 16), articleUrl: url, listTitle: title.slice(0, 160) });
  }
  return items;
}

function extractNextPage(html = '', baseUrl = '') {
  const candidates = [...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const next = candidates.find(match => /下一页|下页|next|›|»/i.test(stripTags(match[2])) || /rel=["']next["']/i.test(match[0]));
  return next ? absolutize(next[1], baseUrl) : '';
}

function detectResourceCategory(html = '', title = '', fallback = '未分类') {
  const sample = `${title} ${stripTags(String(html).slice(0, 30000))}`;
  const rules = [
    ['短剧', /短剧|AI短剧|\d+集.*(?:逆袭|虐渣|甜宠)/i],
    ['纪录片', /纪录片|纪录电影|documentary/i],
    ['动漫动画', /动漫|动画|国漫|日漫|番剧/i],
    ['电视剧', /电视剧|剧集|国剧|美剧|英剧|韩剧|日剧|全\d+集/i],
    ['综艺', /综艺|真人秀|脱口秀/i],
    ['读物', /读物|电子书|小说|漫画|PDF|EPUB/i],
    ['音频', /音频|有声书|广播剧|音乐|无损专辑/i],
    ['学习', /学习|课程|教程|网课|训练营/i],
    ['游戏', /游戏|PC版|安卓版|Steam/i],
    ['电影', /电影|影片|片长|上映日期|IMDb/i]
  ];
  return rules.find(([, pattern]) => pattern.test(sample))?.[0] || fallback;
}

function extractWebsiteCategory(html = '') {
  const candidates = [
    ...String(html).matchAll(/<(?:span|div)\b[^>]*class=["'][^"']*meta-cat[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/(?:span|div)>/gi),
    ...String(html).matchAll(/<a\b[^>]*(?:rel=["']category tag["']|class=["'][^"']*(?:category|cat-link)[^"']*["'])[^>]*>([\s\S]*?)<\/a>/gi),
    ...String(html).matchAll(/<(?:span|div)\b[^>]*class=["'][^"']*(?:breadcrumb|category|cat-name)[^"']*["'][^>]*>([\s\S]*?)<\/(?:span|div)>/gi)
  ].map(match => stripTags(match[1])).filter(text => text && text.length <= 30 && !/首页|当前位置|分类/.test(text));
  return candidates[0] || '';
}

function extractGenericArticle(html = '', meta = {}, category = '未分类', linkMode, categoryConfig) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || meta.listTitle || '';
  const sourceTitle = stripTags(heading).replace(/\s*[-–_|].*$/, '').trim();
  const sourceCategory = extractWebsiteCategory(html) || detectResourceCategory(html, sourceTitle, category);
  let sourceSite = '';
  try { sourceSite = new URL(meta.articleUrl || '').hostname.toLowerCase(); } catch {}
  return {
    articleId: String(meta.id || ''), articleUrl: meta.articleUrl || '', sourceTitle, standardTitle: cleanTitle(sourceTitle),
    sourceSite, sourceCategory,
    category: targetCategory(sourceCategory, sourceTitle, categoryConfig, '', sourceSite),
    links: extractDriveLinks(html, linkMode)
  };
}

module.exports = { DRIVE_HOSTS, SPEED_PROFILES, PRESET_RULES, normalizeStartUrl, driveType, normalizeDriveUrl, extractDriveLinks, extractGenericList, extractNextPage, detectResourceCategory, extractWebsiteCategory, extractGenericArticle };
