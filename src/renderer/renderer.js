const $ = id => document.getElementById(id);
let current;
let categoryDraft;
const labels = { idle: '尚未开始', running: '正在采集', paused: '已暂停', completed: '采集完成', error: '采集中断' };
const statusName = { waiting: '等待', running: '处理中', success: '成功', no_links: '无主链', failed: '失败' };
const sourceCategories = { '44': '科幻片', '38': '动作片', '45': '奇幻片', '43': '剧情片', '40': '爱情片', '39': '喜剧片', '42': '战争片', '41': '恐怖片', '37': '纪录片', '26': '电视剧', '20': '经典电影', '46': '热门短剧' };

function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 4500); }
function categoryOptions(targets, selected) { return targets.map(name => `<option ${name === selected ? 'selected' : ''}>${esc(name)}</option>`).join(''); }

function renderCategoryConfig(state, force = false) {
  if (!categoryDraft || force) categoryDraft = JSON.parse(JSON.stringify(state.categoryConfig));
  const targets = categoryDraft.targets;
  $('targetCategories').innerHTML = targets.map((name, index) => `<div class="target-row"><input class="target-name" data-index="${index}" value="${esc(name)}" maxlength="30"><button class="danger remove-target" data-index="${index}" ${targets.length === 1 ? 'disabled' : ''}>删除</button></div>`).join('');
  $('categoryMappings').innerHTML = Object.entries(sourceCategories).map(([id, name]) => `<label>${esc(name)}<select class="source-mapping" data-id="${id}">${categoryOptions(targets, categoryDraft.mappings[id])}</select></label>`).join('');
  $('animationTarget').innerHTML = categoryOptions(targets, categoryDraft.animationTarget);
  document.querySelectorAll('.target-name').forEach(input => { input.oninput = event => { categoryDraft.targets[Number(event.target.dataset.index)] = event.target.value; }; });
  document.querySelectorAll('.remove-target').forEach(button => { button.onclick = () => { const removed = categoryDraft.targets.splice(Number(button.dataset.index), 1)[0]; const fallback = categoryDraft.targets[0]; Object.keys(categoryDraft.mappings).forEach(id => { if (categoryDraft.mappings[id] === removed) categoryDraft.mappings[id] = fallback; }); if (categoryDraft.animationTarget === removed) categoryDraft.animationTarget = fallback; renderCategoryConfig({ categoryConfig: categoryDraft }); }; });
  document.querySelectorAll('.source-mapping').forEach(select => { select.onchange = event => { categoryDraft.mappings[event.target.dataset.id] = event.target.value; }; });
  $('animationTarget').onchange = event => { categoryDraft.animationTarget = event.target.value; };
}

function render(state) {
  current = state; const stats = state.stats || {};
  $('statusTitle').textContent = labels[state.status] || state.status;
  $('statusDetail').textContent = state.status === 'running' ? (state.discoveryComplete ? '栏目扫描完成，正在逐篇获取主迅雷链接。' : '正在遍历栏目和全部分页。') : state.status === 'completed' ? `已整理 ${stats.links || 0} 条唯一迅雷链接，可以导出。` : '支持暂停和关闭后继续，已完成记录不会重复请求。';
  ['discovered', 'completed', 'withLinks', 'links', 'noLinks', 'failed'].forEach(key => { $(key).textContent = stats[key] || 0; });
  $('start').disabled = state.status === 'running'; $('pause').disabled = state.status !== 'running'; $('stop').disabled = !['running', 'paused'].includes(state.status); $('retry').disabled = !(stats.failed > 0);
  $('articleDelay').value = state.settings.articleDelayMs; $('listDelay').value = state.settings.listDelayMs; $('lastError').textContent = state.lastError ? `最近错误：${state.lastError}` : '';
  const categories = Object.entries(state.categories || {}); $('categories').innerHTML = categories.length ? categories.map(([id, category]) => `<div class="category"><span>${esc(category.source)} <small>#${id}</small></span><b>${category.scannedPages || 0} / ${category.totalPages || '?'} 页</b></div>`).join('') : '<div class="empty">开始后显示栏目进度</div>';
  const rows = (state.articles || []).slice(0, 100); $('rows').innerHTML = rows.length ? rows.map(article => `<tr><td class="status-${esc(article.status)}">${esc(statusName[article.status] || article.status)}</td><td title="${esc(article.sourceTitle || article.listTitle)}">${esc(article.standardTitle || article.listTitle || '-')}</td><td>${esc(article.sourceCategory || '-')}</td><td>${esc(article.category || '-')}</td><td>${(article.links || []).length}</td><td>${esc(article.id)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">暂无记录</td></tr>';
  if (!categoryDraft) renderCategoryConfig(state, true);
}

async function call(fn, success) { try { const result = await fn(); if (result && success) toast(typeof success === 'function' ? success(result) : success); return result; } catch (error) { toast(`操作失败：${error.message}`); return null; } }
$('start').onclick = () => call(() => current?.status === 'paused' ? window.collector.resume() : window.collector.start());
$('pause').onclick = () => call(window.collector.pause); $('stop').onclick = () => call(window.collector.stop); $('retry').onclick = () => call(window.collector.retry, '已将失败记录放回等待队列');
$('saveSettings').onclick = () => call(() => window.collector.updateSettings({ articleDelayMs: Number($('articleDelay').value), listDelayMs: Number($('listDelay').value) }), '速度设置已保存');
$('addCategory').onclick = () => { categoryDraft.targets.push(`新分类${categoryDraft.targets.length + 1}`); renderCategoryConfig({ categoryConfig: categoryDraft }); };
$('saveCategories').onclick = async () => { const inputs = [...document.querySelectorAll('.target-name')].map(input => input.value.trim()); if (inputs.some(name => !name)) return toast('分类名称不能为空'); if (new Set(inputs).size !== inputs.length) return toast('分类名称不能重复'); const renamed = new Map(categoryDraft.targets.map((old, index) => [old, inputs[index]])); categoryDraft.targets = inputs; Object.keys(categoryDraft.mappings).forEach(id => { categoryDraft.mappings[id] = renamed.get(categoryDraft.mappings[id]) || inputs[0]; }); categoryDraft.animationTarget = renamed.get(categoryDraft.animationTarget) || inputs[0]; const saved = await call(() => window.collector.updateCategories(categoryDraft), '分类配置已保存，已采集记录已重新归类'); if (saved) renderCategoryConfig({ categoryConfig: saved }, true); };
$('openData').onclick = () => call(window.collector.openData); $('exportMaster').onclick = () => call(window.collector.exportMaster, result => `已导出 ${result.count} 条：${result.filePath}`); $('exportLinks').onclick = () => call(window.collector.exportLinks, result => `已生成 ${result.reduce((sum, item) => sum + item.count, 0)} 条分类转存链接`); $('mergeResults').onclick = () => call(window.collector.mergeResults, result => `已生成 ${result.length} 个藏知库分类导入文件`);
$('reset').onclick = async () => { if (confirm('确定清空采集进度和所有结果吗？分类配置会保留。')) await call(window.collector.reset, '采集记录已清空'); };
window.collector.onState(render); window.collector.getState().then(render);

function selectedDrives() { return [...document.querySelectorAll('#driveChoices input:checked')].map(input => input.value); }
$('linkMode').onchange = () => { $('driveChoices').classList.toggle('visible', $('linkMode').value === 'selected'); };
$('applyTask').onclick = async () => {
  const startUrl = $('startUrl').value.trim(); if (!startUrl) return toast('请输入采集网址');
  const linkMode = { type: $('linkMode').value, drives: selectedDrives() };
  if (linkMode.type === 'selected' && !linkMode.drives.length) return toast('请至少选择一种网盘');
  if (!confirm('应用新网址会清空当前采集进度，已导出的文件不受影响。确定继续吗？')) return;
  await call(() => window.collector.configureTask({ startUrl, speedMode: $('speedMode').value, linkMode }), '新采集任务已创建，可以点击“开始”');
};
$('openDesigner').onclick = () => { const url = $('startUrl').value.trim(); if (!url) return toast('请先输入网址'); call(() => window.collector.openRuleDesigner(url), '点选器已打开：选择标记类型后点击网页元素'); };
window.collector.onRuleSaved(rule => { $('ruleStatus').textContent = `${rule.name} 的点选规则已自动保存`; toast('网页规则已保存'); });

// 通用模式下修正旧版 UVWHD 专用文案。
document.title = '通用资源采集助手';
const mainHeading = document.querySelector('.topbar h1'); if (mainHeading) mainHeading.textContent = '通用资源采集助手';
const mainSubheading = document.querySelector('.topbar p'); if (mainSubheading) mainSubheading.textContent = '多网站采集 · 自动分类 · 多网盘链接整理';
const statLabels = { discovered: '已发现文章', completed: '已处理', withLinks: '含资源链接文章', links: '唯一资源链接', noLinks: '无资源链接', failed: '失败' };
Object.entries(statLabels).forEach(([id, label]) => { const span = $(id)?.parentElement?.querySelector('span'); if (span) span.textContent = label; });
