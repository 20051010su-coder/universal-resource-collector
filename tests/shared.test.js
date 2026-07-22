const test = require('node:test'); const assert = require('node:assert/strict');
const { cleanTitle, normalizeXunleiUrl, extractTotalPages, extractListArticles, extractArticle, targetCategory, normalizeCategoryConfig, applyCategoryConfig } = require('../src/shared');

test('清理标准资源名', () => {
  assert.equal(cleanTitle('2026年科幻惊悚《揭秘日》最新电影下载'), '揭秘日');
  assert.equal(cleanTitle('2026年美剧《龙之家族 第三季》最新电视剧下载'), '龙之家族 第三季');
});

test('迅雷链接归一化', () => {
  assert.equal(normalizeXunleiUrl('https://pan.xunlei.com/s/ABC_12?pwd=3f96#'), 'https://pan.xunlei.com/s/ABC_12?pwd=3f96');
  assert.equal(normalizeXunleiUrl('https://example.com/s/ABC'), '');
});

test('解析分页和文章列表', () => {
  assert.equal(extractTotalPages('<cite>共408条/9页</cite>'), 9);
  const rows = extractListArticles('<a href="http://www.uvwhd.com/news/show.php?itemid=10575" title="2026年《揭秘日》">详情</a>', '44');
  assert.equal(rows.length, 1); assert.equal(rows[0].id, '10575'); assert.equal(rows[0].categoryId, '44');
});

test('解析文章并过滤推广链接', () => {
  const html = `<h1 id="title">2026年科幻惊悚《揭秘日》最新电影下载</h1><div>迅雷下载：
  <a href="https://pan.xunlei.com/s/MAIN123?pwd=3f96">揭秘日.1080p</a>
  <a href="https://pan.xunlei.com/s/AD123?pwd=abcd">起点珍藏</a></div>`;
  const parsed = extractArticle(html, { id: '10575', categoryId: '44', articleUrl: 'x' });
  assert.equal(parsed.standardTitle, '揭秘日'); assert.equal(parsed.links.length, 1); assert.match(parsed.links[0].originalUrl, /MAIN123/);
});

test('动画内容单独归类', () => assert.equal(targetCategory('喜剧片', '2026年动画电影《测试》'), '动漫动画合集'));

test('自定义分类可任意映射并重新归类', () => {
  const config = normalizeCategoryConfig({ targets: ['影视总类', '动画专区'], mappings: { '44': '影视总类' }, animationTarget: '动画专区' });
  const articles = [{ categoryId: '44', sourceCategory: '科幻片', sourceTitle: '科幻电影《测试》' }, { categoryId: '44', sourceCategory: '科幻片', sourceTitle: '动画电影《测试》' }];
  applyCategoryConfig(articles, config);
  assert.deepEqual(articles.map(item => item.category), ['影视总类', '动画专区']);
});
