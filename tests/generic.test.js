const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESET_RULES, normalizeStartUrl, extractDriveLinks, extractGenericList, extractNextPage, detectResourceCategory, extractWebsiteCategory, extractGenericArticle } = require('../src/generic');

test('通用网址规范化', () => {
  assert.equal(normalizeStartUrl('dyyjv.com'), 'https://dyyjv.com/');
  assert.throws(() => normalizeStartUrl('file:///tmp/a'));
});

test('识别多种网盘并支持筛选模式', () => {
  const html = '<a href="https://pan.quark.cn/s/abc">夸克</a><a href="https://pan.xunlei.com/s/xyz?pwd=1234#">迅雷</a><a href="https://pan.baidu.com/s/bbb?pwd=abcd">百度</a>';
  assert.deepEqual(extractDriveLinks(html).map(x => x.driveType).sort(), ['夸克', '百度', '迅雷']);
  assert.deepEqual(extractDriveLinks(html, { type: 'xunlei_first' }).map(x => x.driveType), ['迅雷']);
  assert.deepEqual(extractDriveLinks(html, { type: 'selected', drives: ['夸克'] }).map(x => x.driveType), ['夸克']);
});

test('发现通用文章、下一页和详情字段', () => {
  const html = '<h2><a href="/174514.html">揭秘日 (2026)</a></h2><a rel="next" href="/page/2">下一页</a>';
  assert.equal(extractGenericList(html, 'https://dyyjv.com/').length, 1);
  assert.equal(extractNextPage(html, 'https://dyyjv.com/'), 'https://dyyjv.com/page/2');
  const article = extractGenericArticle('<h1>揭秘日 (2026)</h1><p>迅雷 https://pan.xunlei.com/s/xyz?pwd=1234</p>', { id: '1', articleUrl: 'x' }, '电影');
  assert.equal(article.sourceTitle, '揭秘日 (2026)'); assert.equal(article.links.length, 1);
  assert.equal(detectResourceCategory('<p>2026年美国电影，片长146分钟</p>', '揭秘日'), '电影');
  assert.equal(detectResourceCategory('<p>AI短剧，共80集</p>', '测试'), '短剧');
});

test('优先读取网站栏目并按站点独立映射', () => {
  const html = '<a rel="category tag" href="/category/tv">电视剧</a><h1>测试剧集</h1><p>https://pan.xunlei.com/s/xyz</p>';
  assert.equal(extractWebsiteCategory(html), '电视剧');
  const config = { targets: ['电影', '电视剧'], mappings: {}, siteMappings: { 'dyyjv.com': { '电视剧': '电视剧' } }, animationTarget: '电影' };
  const article = extractGenericArticle(html, { id: '2', articleUrl: 'https://dyyjv.com/2.html' }, '未分类', { type: 'all' }, config);
  assert.equal(article.sourceCategory, '电视剧');
  assert.equal(article.category, '电视剧');
});

test('dyyjv 预置九个大分类并只读取栏目文章卡片', () => {
  assert.deepEqual(PRESET_RULES['dyyjv.com'].categoryFeeds.map(item => item.source), ['电影', '剧集', '短剧', '动漫', '综艺', '读物', '音频', '学习', '游戏']);
  const html = `
    <article class="post-item item-grid"><h2><a href="/100.html">栏目文章</a></h2></article>
    <article class="ranking-item"><h3><a href="/200.html">排行榜文章</a></h3></article>`;
  const rows = extractGenericList(html, 'https://dyyjv.com/category/dianying', PRESET_RULES['dyyjv.com']);
  assert.deepEqual(rows.map(item => item.articleUrl), ['https://dyyjv.com/100.html']);
});

test('识别 dyyjv 详情页 meta-cat 栏目', () => {
  const html = '<span class="meta-cat-dot"><i></i><a href="/category/%e7%9f%ad%e5%89%a7">短剧</a></span>';
  assert.equal(extractWebsiteCategory(html), '短剧');
});
