const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchText, retryDelayMs } = require('../src/collector');

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
