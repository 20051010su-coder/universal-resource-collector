const test = require('node:test');
const assert = require('node:assert/strict');
const { Collector, fetchText, retryDelayMs, feedPageUrl } = require('../src/collector');

test('retryDelayMs respects Retry-After seconds for HTTP 429', () => {
  const response = { headers: { get: () => '2' } };
  assert.equal(retryDelayMs(response, 1), 2000);
});

test('fetchText retries an HTTP 429 response even in fast mode', async () => {
  const originalFetch = global.fetch;
  let calls = 0;
  global.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => '0' }
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => Buffer.from('<html>ok</html>')
    };
  };

  try {
    const html = await fetchText('https://example.com/', 1, 1000);
    assert.equal(html, '<html>ok</html>');
    assert.equal(calls, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test('dyyjv 分类分页可从断点生成下一页网址', () => {
  assert.equal(feedPageUrl({ url: 'https://dyyjv.com/category/dianying', pagePattern: '{base}/page/{page}' }, 3), 'https://dyyjv.com/category/dianying/page/3');
});

test('旧版 dyyjv 未识别栏目会自动进入分类刷新队列', () => {
  const state = {
    task: { startUrl: 'https://dyyjv.com/' },
    discoveryComplete: true,
    categories: { generic: { source: 'dyyjv.com' } },
    articles: [{ articleUrl: 'https://dyyjv.com/1.html', sourceCategory: 'dyyjv.com', status: 'success', links: [] }],
    stats: {}
  };
  const collector = new Collector({ state, save() {}, emit() {} });
  collector.prepareCategoryRefresh();
  assert.equal(state.discoveryComplete, false);
  assert.equal(state.articles[0].status, 'waiting');
  assert.equal(state.articles[0].sourceSite, 'dyyjv.com');
  assert.equal(state.categories.generic, undefined);
});
