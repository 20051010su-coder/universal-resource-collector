const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStartUrl, extractDriveLinks, extractGenericList, extractNextPage, detectResourceCategory, extractGenericArticle } = require('../src/generic');

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
