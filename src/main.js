const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs'); const path = require('node:path');
const { Collector } = require('./collector');
const { exportMaster, exportTransferTxt, mergeAndExport } = require('./exporter');
const { DEFAULT_CATEGORY_CONFIG, normalizeCategoryConfig, applyCategoryConfig } = require('./shared');

const dataRoot = process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'UVWHD资源采助手-data') : path.join(app.getPath('appData'), 'UVWHD资源采助手-data');
app.setPath('userData', dataRoot);
const stateFile = path.join(dataRoot, 'collector-state.json');
const rulesFile = path.join(dataRoot, 'site-rules.json');
let mainWindow; let collector;
let state = { version: 3, status: 'idle', discoveryComplete: false, categories: {}, articles: [], stats: { discovered: 0, completed: 0, withLinks: 0, noLinks: 0, failed: 0, links: 0 }, settings: { listDelayMs: 250, articleDelayMs: 650, concurrency: 5, timeoutMs: 25000, retries: 2 }, task: { mode: 'legacy', startUrl: 'http://www.uvwhd.com/', speedMode: 'stable', linkMode: { type: 'all', drives: [] } }, categoryConfig: structuredClone(DEFAULT_CATEGORY_CONFIG), lastError: '' };
function readRules() { try { return JSON.parse(fs.readFileSync(rulesFile, 'utf8')); } catch { return {}; } }
function writeRules(rules) { fs.mkdirSync(dataRoot, { recursive: true }); fs.writeFileSync(rulesFile, JSON.stringify(rules, null, 2), 'utf8'); }

function loadState() { try { state = { ...state, ...JSON.parse(fs.readFileSync(stateFile, 'utf8')), status: 'idle' }; } catch { /* first run */ } state.categoryConfig = normalizeCategoryConfig(state.categoryConfig); applyCategoryConfig(state.articles, state.categoryConfig); }
function saveState() { fs.mkdirSync(dataRoot, { recursive: true }); const tmp = `${stateFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8'); fs.renameSync(tmp, stateFile); }
function publicState() { return { ...state, articles: state.articles.slice(-250).reverse() }; }
function emit() { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('state:changed', publicState()); }

function registerIPC() {
  ipcMain.handle('state:get', () => publicState());
  ipcMain.handle('collector:start', () => { collector.start(); return true; });
  ipcMain.handle('collector:pause', () => { collector.pause(); return true; });
  ipcMain.handle('collector:resume', () => { collector.resume(); return true; });
  ipcMain.handle('collector:stop', () => { collector.stop(); return true; });
  ipcMain.handle('collector:retry', () => { collector.retryFailed(); return true; });
  ipcMain.handle('collector:reset', () => { collector.stop(); state = { version: 3, status: 'idle', discoveryComplete: false, categories: {}, articles: [], stats: { discovered: 0, completed: 0, withLinks: 0, noLinks: 0, failed: 0, links: 0 }, settings: state.settings, task: state.task, siteRules: readRules(), categoryConfig: state.categoryConfig, lastError: '' }; collector = new Collector({ state, save: saveState, emit }); saveState(); emit(); return true; });
  ipcMain.handle('settings:update', (_event, settings) => { state.settings = { ...state.settings, ...settings }; saveState(); emit(); return true; });
  ipcMain.handle('task:configure', (_event, task) => { if (state.status === 'running') throw new Error('请先停止当前采集'); state.task = { ...state.task, ...task, mode: 'generic' }; state.siteRules = readRules(); state.discoveryComplete = false; state.categories = {}; state.articles = []; state.stats = { discovered: 0, completed: 0, withLinks: 0, noLinks: 0, failed: 0, links: 0 }; collector = new Collector({ state, save: saveState, emit }); saveState(); emit(); return state.task; });
  ipcMain.handle('rules:get', () => readRules());
  ipcMain.handle('rules:open-designer', (_event, rawUrl) => {
    const target = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    const designer = new BrowserWindow({ width: 1180, height: 820, parent: mainWindow, title: '网页点选规则设计器', webPreferences: { contextIsolation: true, nodeIntegration: false } });
    const picks = {};
    const inject = () => designer.webContents.executeJavaScript(`(() => {
      if (window.__collectorPicker) return; window.__collectorPicker = true;
      const box=document.createElement('div'); box.style='position:fixed;z-index:2147483647;top:12px;right:12px;width:310px;padding:14px;background:#10251b;color:#fff;font:14px sans-serif;box-shadow:0 4px 24px #0008;border-radius:8px';
      box.innerHTML='<b>通用采集规则点选器</b><p style="line-height:1.5">先选标记类型，再点击页面元素。文章链接可在列表页选；标题和正文可进入详情页后选。</p><div id="__pickBtns"></div><p id="__pickStatus">尚未选择</p>';
      const types=[['detail','文章详情链接'],['title','详情页标题'],['content','详情页正文'],['next','下一页按钮']]; let active='detail';
      const selector=e=>{if(e.id)return '#'+CSS.escape(e.id);let s=e.tagName.toLowerCase();const c=[...e.classList].filter(x=>!x.startsWith('__')).slice(0,2);if(c.length)s+='.'+c.map(CSS.escape).join('.');return s};
      types.forEach(([k,n])=>{const b=document.createElement('button');b.textContent=n;b.style='margin:5px;padding:7px';b.onclick=e=>{e.stopPropagation();active=k;document.querySelector('#__pickStatus').textContent='请点击：'+n};box.querySelector('#__pickBtns').appendChild(b)});
      document.documentElement.appendChild(box);
      document.addEventListener('mouseover',e=>{if(box.contains(e.target))return;e.target.style.outline='3px solid #00d58b'},true);
      document.addEventListener('mouseout',e=>{if(box.contains(e.target))return;e.target.style.outline=''},true);
      document.addEventListener('click',e=>{if(box.contains(e.target))return;e.preventDefault();e.stopPropagation();const a=e.target.closest('a');const data={type:active,selector:selector(e.target),href:a?.href||'',sample:(e.target.innerText||'').trim().slice(0,100),page:location.href};console.log('__RESOURCE_RULE__'+JSON.stringify(data));box.querySelector('#__pickStatus').textContent='已记录：'+data.type+' → '+data.selector},true);
    })()` ).catch(() => {});
    designer.webContents.on('did-finish-load', inject);
    designer.webContents.on('console-message', (...args) => { const message = typeof args[2] === 'string' ? args[2] : args[1]?.message; if (!message?.startsWith('__RESOURCE_RULE__')) return; try { const item = JSON.parse(message.slice(17)); picks[item.type] = item; const rules = readRules(); rules[target.hostname] = { name: target.hostname, updatedAt: new Date().toISOString(), picks, detailUrlPattern: picks.detail?.href ? new URL(picks.detail.href).pathname.replace(/\d+/g, '\\d+') : '' }; writeRules(rules); state.siteRules = rules; mainWindow.webContents.send('rule:saved', rules[target.hostname]); } catch {} });
    designer.loadURL(target.toString()); return true;
  });
  ipcMain.handle('categories:update', (_event, config) => { state.categoryConfig = normalizeCategoryConfig(config); applyCategoryConfig(state.articles, state.categoryConfig); saveState(); emit(); return state.categoryConfig; });
  ipcMain.handle('export:master', async () => { const chosen = await dialog.showSaveDialog(mainWindow, { defaultPath: 'UVWHD-采集总表.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] }); if (chosen.canceled) return null; const count = await exportMaster(state, chosen.filePath); return { filePath: chosen.filePath, count }; });
  ipcMain.handle('export:links', async () => { const chosen = await dialog.showOpenDialog(mainWindow, { title: '选择转存链接导出文件夹', properties: ['openDirectory', 'createDirectory'] }); if (chosen.canceled) return null; return exportTransferTxt(state, chosen.filePaths[0]); });
  ipcMain.handle('merge:results', async () => { const input = await dialog.showOpenDialog(mainWindow, { title: '选择云链批量管家导出的 Excel', properties: ['openFile'], filters: [{ name: 'Excel', extensions: ['xlsx'] }] }); if (input.canceled) return null; const output = await dialog.showOpenDialog(mainWindow, { title: '选择藏知库导入文件的保存文件夹', properties: ['openDirectory', 'createDirectory'] }); if (output.canceled) return null; return mergeAndExport(state, input.filePaths[0], output.filePaths[0]); });
  ipcMain.handle('folder:open-data', () => { fs.mkdirSync(dataRoot, { recursive: true }); shell.openPath(dataRoot); return dataRoot; });
}

app.whenReady().then(async () => {
  app.setAppUserModelId('cn.cangzhiku.uvwhdcollector');
  loadState(); state.siteRules = readRules(); collector = new Collector({ state, save: saveState, emit }); registerIPC();
  mainWindow = new BrowserWindow({ width: 1320, height: 860, minWidth: 1040, minHeight: 700, title: 'UVWHD资源采集助手', icon: path.join(__dirname, '..', 'assets', 'app-icon.png'), webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  mainWindow.setMenu(null); await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html')); emit();
});
app.on('window-all-closed', () => { collector?.stop(); app.quit(); });
