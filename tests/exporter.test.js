const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ExcelJS = require('exceljs');
const { exportMaster } = require('../src/exporter');

test('采集总表使用通用的原始网盘链接列名', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collector-export-'));
  const filePath = path.join(directory, 'master.xlsx');
  try {
    await exportMaster({ articles: [], categoryConfig: {} }, filePath);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(filePath);
    const headers = book.getWorksheet('采集总表').getRow(1).values;
    assert.ok(headers.includes('原始网盘链接'));
    assert.ok(!headers.includes('原迅雷链接'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
