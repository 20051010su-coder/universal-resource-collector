const { CATEGORY_MAP, extractTotalPages, extractListArticles, extractArticle } = require('./shared');
const { SPEED_PROFILES, normalizeStartUrl, extractGenericList, extractNextPage, extractGenericArticle } = require('./generic');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36';

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(1000, seconds * 1000);
    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(1000, retryAt - Date.now());
  }
  return Math.min(30000, 3000 * (2 ** (attempt - 1)));
}

async function fetchText(url, attempts = 3, timeoutMs = 25000) {
  let lastError;
  let maxAttempts = Math.max(1, attempts);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' }, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.response = response;
        throw error;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      return bytes.toString('utf8');
    } catch (error) {
      lastError = error;
      if (error.response?.status === 429) maxAttempts = Math.max(maxAttempts, 4);
      if (attempt < maxAttempts) {
        const limited = error.response?.status === 429;
        await sleep(limited ? retryDelayMs(error.response, attempt) : attempt * 1200);
      }
    }
  }
  throw new Error(lastError?.message || '网页请求失败');
}

class Collector {
  constructor({ state, save, emit }) {
    this.state = state; this.save = save; this.emit = emit; this.stopRequested = false;
  }

  async waitWhilePaused() {
    while (this.state.status === 'paused' && !this.stopRequested) await sleep(300);
  }

  async discover() {
    if (this.state.task?.mode === 'generic') return this.discoverGeneric();
    const articleMap = new Map((this.state.articles || []).map(item => [item.id, item]));
    for (const [categoryId, category] of Object.entries(CATEGORY_MAP)) {
      await this.waitWhilePaused(); if (this.stopRequested) return;
      const firstUrl = `http://www.uvwhd.com/news/list.php?catid=${categoryId}`;
      const firstHtml = await fetchText(firstUrl);
      const totalPages = extractTotalPages(firstHtml);
      this.state.categories[categoryId] = { ...category, totalPages, scannedPages: 0 };
      for (let page = 1; page <= totalPages; page += 1) {
        await this.waitWhilePaused(); if (this.stopRequested) return;
        const html = page === 1 ? firstHtml : await fetchText(`${firstUrl}&page=${page}`);
        for (const article of extractListArticles(html, categoryId)) {
          if (!articleMap.has(article.id)) articleMap.set(article.id, { ...article, status: 'waiting', error: '', attempts: 0 });
        }
        this.state.categories[categoryId].scannedPages = page;
        this.state.articles = [...articleMap.values()];
        this.state.stats.discovered = this.state.articles.length;
        this.save(); this.emit();
        await sleep(this.state.settings.listDelayMs);
      }
    }
    this.state.discoveryComplete = true; this.save(); this.emit();
  }

  async discoverGeneric() {
    const task = this.state.task || {};
    let pageUrl = normalizeStartUrl(task.startUrl); let page = 0;
    const visited = new Set(); const articleMap = new Map((this.state.articles || []).map(item => [item.articleUrl, item]));
    const profile = { ...SPEED_PROFILES[task.speedMode || 'stable'], ...(task.speedMode === 'custom' ? this.state.settings : {}) };
    while (pageUrl && !visited.has(pageUrl) && page < (Number(task.maxPages) || 10000)) {
      await this.waitWhilePaused(); if (this.stopRequested) return;
      visited.add(pageUrl); page += 1;
      const html = await fetchText(pageUrl, profile.retries, profile.timeoutMs);
      const hostRule = this.state.siteRules?.[new URL(pageUrl).hostname];
      for (const article of extractGenericList(html, pageUrl, hostRule)) if (!articleMap.has(article.articleUrl)) articleMap.set(article.articleUrl, { ...article, status: 'waiting', error: '', attempts: 0, sourceCategory: task.sourceCategory || new URL(task.startUrl).hostname });
      this.state.articles = [...articleMap.values()]; this.state.stats.discovered = this.state.articles.length;
      this.state.categories.generic = { source: task.sourceCategory || new URL(task.startUrl).hostname, totalPages: '?', scannedPages: page };
      this.save(); this.emit(); pageUrl = extractNextPage(html, pageUrl);
      // 大型站点不能等几千个列表页全部扫描完再处理详情。
      // 每发现一页就立即消化一批等待文章，界面会很快出现链接并保留断点。
      const pendingBatch = this.state.articles.filter(item => !['success', 'no_links'].includes(item.status)).slice(0, Math.max(40, (profile.concurrency || 1) * 10));
      if (pendingBatch.length) await this.collectArticles(pendingBatch);
      if (profile.listDelayMs) await sleep(profile.listDelayMs);
    }
    this.state.discoveryComplete = true; this.save(); this.emit();
  }

  async collectArticles(articleSource = this.state.articles) {
    const generic = this.state.task?.mode === 'generic';
    const profile = generic ? { ...SPEED_PROFILES[this.state.task.speedMode || 'stable'], ...(this.state.task.speedMode === 'custom' ? this.state.settings : {}) } : { concurrency: 1, articleDelayMs: this.state.settings.articleDelayMs, retries: 3, timeoutMs: 25000 };
    const queue = articleSource.filter(article => !['success', 'no_links'].includes(article.status));
    let cursor = 0;
    const worker = async () => { while (cursor < queue.length && !this.stopRequested) {
      const article = queue[cursor++]; await this.waitWhilePaused(); if (this.stopRequested) return;
      article.status = 'running'; article.attempts = (article.attempts || 0) + 1; this.emit();
      try { const html = await fetchText(article.articleUrl, profile.retries, profile.timeoutMs); const parsed = generic ? extractGenericArticle(html, article, article.sourceCategory, this.state.task.linkMode, this.state.categoryConfig) : extractArticle(html, article, this.state.categoryConfig); Object.assign(article, parsed, { status: parsed.links.length ? 'success' : 'no_links', error: '', collectedAt: new Date().toISOString() }); }
      catch (error) { article.status = 'failed'; article.error = error.message; }
      this.recalculate(); this.save(); this.emit(); if (profile.articleDelayMs) await sleep(profile.articleDelayMs);
    }};
    await Promise.all(Array.from({ length: Math.max(1, Math.min(20, profile.concurrency || 1)) }, worker));
  }

  recalculate() {
    const articles = this.state.articles;
    const allLinks = articles.flatMap(article => (article.links || []).map(link => ({ ...link, articleId: article.id })));
    this.state.stats = {
      ...this.state.stats,
      discovered: articles.length,
      completed: articles.filter(item => ['success', 'no_links'].includes(item.status)).length,
      withLinks: articles.filter(item => item.status === 'success').length,
      noLinks: articles.filter(item => item.status === 'no_links').length,
      failed: articles.filter(item => item.status === 'failed').length,
      links: new Set(allLinks.map(item => item.originalUrl.replace(/\?pwd=.*/, ''))).size
    };
  }

  async start() {
    if (this.state.status === 'running') return;
    this.stopRequested = false; this.state.status = 'running'; this.state.lastError = ''; this.save(); this.emit();
    try {
      if (!this.state.discoveryComplete) await this.discover();
      if (!this.stopRequested) await this.collectArticles();
      if (!this.stopRequested) this.state.status = 'completed';
    } catch (error) {
      this.state.status = 'error'; this.state.lastError = error.message;
    }
    this.recalculate(); this.save(); this.emit();
  }

  pause() { if (this.state.status === 'running') this.state.status = 'paused'; this.save(); this.emit(); }
  resume() { if (this.state.status === 'paused') { this.state.status = 'running'; this.save(); this.emit(); } }
  stop() { this.stopRequested = true; this.state.status = 'idle'; this.save(); this.emit(); }
  retryFailed() { this.state.articles.filter(item => item.status === 'failed').forEach(item => { item.status = 'waiting'; item.error = ''; }); this.recalculate(); this.save(); this.emit(); }
}

module.exports = { Collector, fetchText, retryDelayMs };
