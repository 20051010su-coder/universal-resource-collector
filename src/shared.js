const SITE_ORIGIN = 'http://www.uvwhd.com';
const CATEGORY_MAP = {
  '44': { source: '科幻片', target: '电影资源' },
  '38': { source: '动作片', target: '电影资源' },
  '45': { source: '奇幻片', target: '电影资源' },
  '43': { source: '剧情片', target: '电影资源' },
  '40': { source: '爱情片', target: '电影资源' },
  '39': { source: '喜剧片', target: '电影资源' },
  '42': { source: '战争片', target: '电影资源' },
  '41': { source: '恐怖片', target: '电影资源' },
  '37': { source: '纪录片', target: '纪录片' },
  '26': { source: '电视剧', target: '电视剧大全' },
  '20': { source: '经典电影', target: '电影资源' },
  '46': { source: '热门短剧', target: '电视剧大全' }
};
const DEFAULT_CATEGORY_CONFIG = {
  targets: ['电影', '电视剧', '纪录片', '动漫&动画'],
  mappings: Object.fromEntries(Object.entries(CATEGORY_MAP).map(([id, item]) => [
    id,
    item.source === '纪录片' ? '纪录片' : ['电视剧', '热门短剧'].includes(item.source) ? '电视剧' : '电影'
  ])),
  siteMappings: {},
  animationTarget: '动漫&动画',
  pendingCategory: '待分类'
};

function decodeEntities(value = '') {
  return String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(value = '') {
  return decodeEntities(String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function normalizeXunleiUrl(raw = '') {
  const cleaned = decodeEntities(raw).trim().replace(/[\s。，；]+$/g, '').replace(/#.*$/, '');
  try {
    const parsed = new URL(cleaned);
    if (parsed.hostname !== 'pan.xunlei.com' || !/^\/s\/[A-Za-z0-9_-]+/.test(parsed.pathname)) return '';
    const pwd = parsed.searchParams.get('pwd');
    return `${parsed.origin}${parsed.pathname}${pwd ? `?pwd=${pwd}` : ''}`;
  } catch { return ''; }
}

function shareId(url = '') {
  return normalizeXunleiUrl(url).match(/\/s\/([A-Za-z0-9_-]+)/)?.[1] || '';
}

function cleanTitle(raw = '') {
  const text = stripTags(raw);
  const bracket = text.match(/《([^》]+)》/);
  let title = bracket?.[1] || text;
  title = title
    .replace(/^(?:19|20)\d{2}年?/g, '')
    .replace(/^(?:中国|国产|大陆|香港|台湾|美国|英国|法国|韩国|日本|泰国|印度)+/g, '')
    .replace(/(?:最新|免费|高清|完整版)*(?:电影|电视剧|短剧|纪录片)?下载.*$/g, '')
    .trim();
  return (title || text).slice(0, 80);
}

function normalizeCategoryConfig(config) {
  const oldDefaultTargets = ['电影电视剧', '动漫动画合集', '纪录片'];
  const shouldMigrateOldDefault = oldDefaultTargets.every(name => config?.targets?.includes(name))
    && config?.targets?.length === oldDefaultTargets.length;
  const effectiveConfig = shouldMigrateOldDefault ? {
    ...config,
    targets: DEFAULT_CATEGORY_CONFIG.targets,
    mappings: DEFAULT_CATEGORY_CONFIG.mappings,
    animationTarget: DEFAULT_CATEGORY_CONFIG.animationTarget
  } : config;
  const targets = [...new Set((effectiveConfig?.targets || DEFAULT_CATEGORY_CONFIG.targets).map(value => String(value).trim()).filter(Boolean))];
  if (!targets.length) return structuredClone(DEFAULT_CATEGORY_CONFIG);
  const fallback = targets[0];
  const mappings = Object.fromEntries(Object.keys(CATEGORY_MAP).map(id => [id, targets.includes(effectiveConfig?.mappings?.[id]) ? effectiveConfig.mappings[id] : DEFAULT_CATEGORY_CONFIG.mappings[id] || fallback]));
  const siteMappings = {};
  for (const [site, sourceMap] of Object.entries(effectiveConfig?.siteMappings || {})) {
    const normalizedSite = String(site || '').trim().toLowerCase();
    if (!normalizedSite || !sourceMap || typeof sourceMap !== 'object') continue;
    siteMappings[normalizedSite] = {};
    for (const [source, target] of Object.entries(sourceMap)) {
      const normalizedSource = String(source || '').trim();
      if (normalizedSource && targets.includes(target)) siteMappings[normalizedSite][normalizedSource] = target;
    }
  }
  return {
    targets,
    mappings,
    siteMappings,
    animationTarget: targets.includes(effectiveConfig?.animationTarget) ? effectiveConfig.animationTarget : DEFAULT_CATEGORY_CONFIG.animationTarget,
    pendingCategory: '待分类'
  };
}

function articleSite(article = {}) {
  try { return new URL(article.articleUrl || '').hostname.toLowerCase(); } catch { return String(article.sourceSite || '').toLowerCase(); }
}

function targetCategory(sourceCategory, title = '', config = DEFAULT_CATEGORY_CONFIG, categoryId = '', sourceSite = '') {
  const normalized = normalizeCategoryConfig(config);
  const site = String(sourceSite || '').toLowerCase();
  const siteTarget = normalized.siteMappings?.[site]?.[sourceCategory];
  if (siteTarget) return siteTarget;
  if (!site && /动漫|动画|国漫|剧场版/i.test(title)) return normalized.animationTarget;
  const id = categoryId || Object.entries(CATEGORY_MAP).find(([, item]) => item.source === sourceCategory)?.[0];
  if (id && normalized.mappings[id]) return normalized.mappings[id];
  return normalized.pendingCategory;
}

function applyCategoryConfig(articles, config) {
  const normalized = normalizeCategoryConfig(config);
  for (const article of articles || []) {
    article.sourceSite = article.sourceSite || articleSite(article);
    article.category = targetCategory(article.sourceCategory, article.sourceTitle || article.listTitle, normalized, article.categoryId, article.sourceSite);
  }
  return normalized;
}

function extractTotalPages(html = '') {
  const stated = html.match(/共\s*\d+\s*条\s*\/\s*(\d+)\s*页/);
  if (stated) return Math.max(1, Number(stated[1]));
  const pages = [...html.matchAll(/[?&]page=(\d+)/g)].map(match => Number(match[1]));
  return Math.max(1, ...pages.filter(Number.isFinite));
}

function extractListArticles(html = '', categoryId = '') {
  const seen = new Set();
  const items = [];
  const regex = /<a\b[^>]*href=["'](?:https?:\/\/www\.uvwhd\.com)?\/news\/show\.php\?itemid=(\d+)["'][^>]*?(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const id = match[1];
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, categoryId, articleUrl: `${SITE_ORIGIN}/news/show.php?itemid=${id}`, listTitle: stripTags(match[2] || match[3]) });
  }
  return items;
}

function extractArticle(html = '', meta = {}, categoryConfig = DEFAULT_CATEGORY_CONFIG) {
  const heading = html.match(/<h1\b[^>]*id=["']title["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || meta.listTitle || '';
  const sourceTitle = stripTags(heading);
  const contentStart = html.search(/(?:迅雷下载|迅雷网盘)/i);
  const relevant = contentStart >= 0 ? html.slice(Math.max(0, contentStart - 1500), Math.min(html.length, contentStart + 12000)) : html;
  const allAnchors = [...relevant.matchAll(/<a\b[^>]*href=["']([^"']*pan\.xunlei\.com\/s\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map(match => ({ url: normalizeXunleiUrl(match[1]), label: stripTags(match[2]) })).filter(item => item.url);
  const promotionalIds = new Set(allAnchors.filter(item => /起点珍藏|更多惊喜|合集|专题/i.test(item.label)).map(item => shareId(item.url)));
  const anchors = allAnchors.filter(item => !promotionalIds.has(shareId(item.url)));
  const textUrls = [...relevant.matchAll(/https?:\/\/pan\.xunlei\.com\/s\/[A-Za-z0-9_-]+(?:\?pwd=[A-Za-z0-9_-]+)?/gi)]
    .map(match => ({ url: normalizeXunleiUrl(match[0]), label: '' })).filter(item => item.url && !promotionalIds.has(shareId(item.url)));
  const byId = new Map();
  for (const item of [...anchors, ...textUrls]) {
    const id = shareId(item.url);
    if (!id) continue;
    const relatedId = [...byId.keys()].find(existingId => existingId.startsWith(id) || id.startsWith(existingId));
    if (relatedId && relatedId !== id) {
      if (id.length > relatedId.length) { byId.delete(relatedId); byId.set(id, item); }
      continue;
    }
    const existing = byId.get(id);
    if (!existing || (!existing.url.includes('?pwd=') && item.url.includes('?pwd='))) byId.set(id, item);
  }
  const standardTitle = cleanTitle(sourceTitle);
  const sourceCategory = CATEGORY_MAP[meta.categoryId]?.source || meta.sourceCategory || '未分类';
  const category = targetCategory(sourceCategory, sourceTitle, categoryConfig, meta.categoryId);
  return {
    articleId: String(meta.id || ''), articleUrl: meta.articleUrl || '', sourceTitle, standardTitle,
    sourceCategory, category,
    links: [...byId.values()].map((item, index) => ({
      originalUrl: item.url, originalAccessCode: new URL(item.url).searchParams.get('pwd') || '',
      variant: item.label || (byId.size > 1 ? `版本${index + 1}` : '')
    }))
  };
}

module.exports = {
  SITE_ORIGIN, CATEGORY_MAP, DEFAULT_CATEGORY_CONFIG, decodeEntities, stripTags, normalizeXunleiUrl,
  shareId, cleanTitle, normalizeCategoryConfig, targetCategory, applyCategoryConfig, articleSite, extractTotalPages, extractListArticles, extractArticle
};
