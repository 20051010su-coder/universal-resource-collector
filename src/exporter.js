const ExcelJS = require('exceljs');
const { normalizeCategoryConfig, normalizeXunleiUrl } = require('./shared');
const { normalizeDriveUrl, driveType } = require('./generic');

function linkKey(value) { return (normalizeDriveUrl(value) || normalizeXunleiUrl(value)).replace(/[?&](?:pwd|password)=[^&#]*/i, ''); }

function flatRows(state) {
  const rows = [];
  for (const article of state.articles || []) {
    for (const link of article.links || []) rows.push({
      article_id: article.id,
      standard_title: article.standardTitle,
      source_title: article.sourceTitle,
      source_category: article.sourceCategory,
      category: article.category,
      variant: link.variant,
      drive_type: link.driveType || driveType(link.originalUrl) || '迅雷',
      original_url: link.originalUrl,
      original_access_code: link.originalAccessCode,
      source_article_url: article.articleUrl,
      collected_at: article.collectedAt || ''
    });
  }
  const seen = new Set();
  return rows.filter(row => {
    const key = linkKey(row.original_url);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function styleSheet(sheet) {
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B3A' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `${sheet.getColumn(sheet.columnCount).letter}1` };
}

async function exportMaster(state, filePath) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('采集总表');
  sheet.columns = [
    ['drive_type', '网盘类型', 14],
    ['article_id', '文章编号', 12], ['standard_title', '标准资源名', 30], ['source_title', '来源文章标题', 45],
    ['source_category', '来源栏目', 14], ['category', '藏知库分类', 18], ['variant', '版本/清晰度', 26],
    ['original_url', '原始网盘链接', 54], ['original_access_code', '原提取码', 12], ['source_article_url', '来源文章', 48], ['collected_at', '采集时间', 22]
  ].map(([key, header, width]) => ({ key, header, width }));
  flatRows(state).forEach(row => sheet.addRow(row)); styleSheet(sheet);
  const review = book.addWorksheet('人工复核');
  review.columns = [{ header: '文章编号', key: 'id', width: 12 }, { header: '标题', key: 'title', width: 50 }, { header: '状态', key: 'status', width: 14 }, { header: '原因', key: 'error', width: 40 }, { header: '文章地址', key: 'url', width: 50 }];
  (state.articles || []).filter(item => item.status !== 'success' || !item.standardTitle).forEach(item => review.addRow({ id: item.id, title: item.sourceTitle || item.listTitle, status: item.status, error: item.error || (item.status === 'no_links' ? '未找到资源链接' : ''), url: item.articleUrl }));
  styleSheet(review); await book.xlsx.writeFile(filePath); return flatRows(state).length;
}

async function exportTransferTxt(state, directory) {
  const fs = require('node:fs'); const path = require('node:path'); fs.mkdirSync(directory, { recursive: true });
  const rows = flatRows(state); const files = [];
  for (const category of normalizeCategoryConfig(state.categoryConfig).targets) {
    const links = rows.filter(row => row.category === category && row.drive_type === '迅雷').map(row => row.original_url);
    if (!links.length) continue;
    const filePath = path.join(directory, `UVWHD转存链接-${category}.txt`);
    fs.writeFileSync(filePath, `\uFEFF${links.join('\r\n')}`, 'utf8'); files.push({ category, count: links.length, filePath });
  }
  return files;
}

function readCell(row, aliases) {
  for (const alias of aliases) if (Object.prototype.hasOwnProperty.call(row, alias)) return String(row[alias] ?? '').trim();
  return '';
}

async function readTransferWorkbook(filePath) {
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile(filePath);
  const sheet = book.getWorksheet('发布结果') || book.worksheets[0];
  if (!sheet) throw new Error('Excel 中没有工作表');
  const headers = {}; sheet.getRow(1).eachCell((cell, column) => { headers[column] = String(cell.value || '').trim(); });
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const item = {}; row.eachCell({ includeEmpty: true }, (cell, column) => { item[headers[column]] = cell.text || ''; });
    rows.push({
      originalUrl: readCell(item, ['original_url', '原始分享链接']),
      shareUrl: readCell(item, ['share_url', '新分享链接']), accessCode: readCell(item, ['access_code', '新提取码']),
      platform: readCell(item, ['platform', '网盘类型']) || '迅雷',
      transferStatus: readCell(item, ['transfer_status', '转存状态']), shareStatus: readCell(item, ['share_status', '分享状态']),
      failureReason: readCell(item, ['failure_reason', '失败原因'])
    });
  });
  return rows;
}

async function mergeAndExport(state, transferFile, outputDirectory) {
  const fs = require('node:fs'); const path = require('node:path'); fs.mkdirSync(outputDirectory, { recursive: true });
  const manifest = flatRows(state); const transfer = await readTransferWorkbook(transferFile);
  const index = new Map(transfer.map(row => [linkKey(row.originalUrl), row]));
  const merged = manifest.filter(row => row.drive_type === '迅雷').map(source => ({ ...source, transfer: index.get(linkKey(source.original_url)) }));
  const files = [];
  for (const category of normalizeCategoryConfig(state.categoryConfig).targets) {
    const categoryRows = merged.filter(row => row.category === category);
    if (!categoryRows.length) continue;
    const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('发布结果');
    sheet.columns = [
      ['title', 'title', 30], ['share_url', 'share_url', 52], ['access_code', 'access_code', 12], ['platform', 'platform', 12],
      ['category', 'category', 18], ['original_url', 'original_url', 52], ['source_article_url', 'source_article_url', 48], ['variant', 'variant', 24],
      ['transfer_status', 'transfer_status', 16], ['share_status', 'share_status', 16], ['failure_reason', 'failure_reason', 34]
    ].map(([key, header, width]) => ({ key, header, width }));
    categoryRows.forEach(row => sheet.addRow({
      title: row.standard_title, share_url: row.transfer?.shareUrl || '', access_code: row.transfer?.accessCode || '', platform: '迅雷', category,
      original_url: row.original_url, source_article_url: row.source_article_url, variant: row.variant,
      transfer_status: row.transfer?.transferStatus || '未匹配', share_status: row.transfer?.shareStatus || '', failure_reason: row.transfer?.failureReason || (!row.transfer ? '转存结果中未找到该原链接' : '')
    }));
    styleSheet(sheet); const filePath = path.join(outputDirectory, `藏知库导入-${category}.xlsx`); await book.xlsx.writeFile(filePath);
    files.push({ category, count: categoryRows.length, matched: categoryRows.filter(row => row.transfer?.shareUrl).length, filePath });
  }
  return files;
}

module.exports = { flatRows, exportMaster, exportTransferTxt, readTransferWorkbook, mergeAndExport };
