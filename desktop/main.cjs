const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { createInterface } = require('node:readline');
const { join, resolve } = require('node:path');
const { mkdtempSync, rmSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { clientState } = require('./client-state.cjs');
const { isSignInURL, isExternalURL } = require('./security.cjs');

app.setName('Morrow Mail');
const smoke = process.argv.includes('--smoke-test');
const smokeDir = smoke ? mkdtempSync(join(tmpdir(), 'morrow-desktop-check-')) : null;
if (smokeDir) app.setPath('userData', smokeDir);
const dataDirectory = app.getPath('userData');
const boundsFile = join(dataDirectory, 'window.json');
let window, child, origin, stopping = false, failed = false;
const writes = new Set();
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.setAppUserModelId('org.morrowmail.desktop');

async function external(url) {
  if (!isExternalURL(url)) return;
  const { response } = await dialog.showMessageBox(window, { type: 'question', message: 'Open this link in your browser?', detail: new URL(url).hostname, buttons: ['Cancel', 'Open Browser'], defaultId: 0, cancelId: 0 });
  if (response === 1) await shell.openExternal(url);
}
async function startService() {
  const backend = app.isPackaged ? join(__dirname, 'backend') : resolve(__dirname, '..');
  const node = app.isPackaged ? join(__dirname, 'runtime', 'node.exe') : process.env.MORROW_NODE_BINARY;
  if (!node) throw new Error('Set MORROW_NODE_BINARY to a standalone Node executable for desktop development.');
  const token = randomBytes(32).toString('hex');
  const env = { ...process.env };
  delete env.NODE_OPTIONS; delete env.NODE_PATH; delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(node, [join(backend, 'server/native.js')], { cwd: backend, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  // Never echo provider errors, request bodies, or credentials to the renderer.
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  child.on('exit', () => { if (!stopping) fatal(); });
  await new Promise((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Service startup timed out.')), 20_000);
    const lines = createInterface({ input: child.stdout });
    const rejectExit = () => { clearTimeout(timer); reject(new Error('Service did not start.')); };
    child.once('error', rejectExit); child.once('exit', rejectExit);
    lines.once('line', line => {
      clearTimeout(timer); child.removeListener('exit', rejectExit);
      try { const { port } = JSON.parse(line); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(); origin = `http://127.0.0.1:${port}`; accept(); } catch { reject(new Error('Invalid service response.')); }
    });
    child.stdin.write(JSON.stringify({ token, dataDirectory }) + '\n');
  });
  return token;
}
function fatal() {
  if (failed || stopping) return;
  failed = true;
  if (!smoke) dialog.showErrorBox('Morrow Mail could not continue', 'The private mail service stopped. Your saved workspace remains on this device. Close and reopen Morrow Mail.');
  stop(1);
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  const finish = () => {
    if (smokeDir) { try { rmSync(smokeDir, { recursive: true, force: true, maxRetries: 5 }); } catch {} }
    app.exit(code);
  };
  if (!child || child.exitCode !== null) return finish();
  child.once('exit', finish);
  child.stdin.end();
  setTimeout(() => { child.kill(); finish(); }, 70_000).unref();
}
app.on('window-all-closed', () => stop());
app.on('before-quit', event => { if (!stopping && window && !window.isDestroyed()) { event.preventDefault(); window.close(); } });

app.whenReady().then(async () => {
  const token = await startService();
  const isolated = session.fromPartition('persist:morrow');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.on('will-download', event => event.preventDefault());
  let size = {};
  try { const saved = JSON.parse(readFileSync(boundsFile)); if (Number.isFinite(saved.width) && Number.isFinite(saved.height)) size = { width: Math.max(1040, Math.min(saved.width, 2400)), height: Math.max(700, Math.min(saved.height, 1600)) }; } catch {}
  window = new BrowserWindow({ width: 1280, height: 840, ...size, minWidth: 1040, minHeight: 700, show: !smoke, icon: join(__dirname, 'icon.ico'), backgroundColor: '#f5f4ec', title: 'Morrow Mail', webPreferences: { session: isolated, preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, devTools: !app.isPackaged } });
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.webContentsId === window.webContents.id && new URL(details.url).origin === origin) {
      for (const key of Object.keys(details.requestHeaders)) if (key.toLowerCase() === 'authorization') delete details.requestHeaders[key];
      details.requestHeaders.Authorization = `Bearer ${token}`;
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(details.method)) writes.add(details.id);
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  isolated.webRequest.onCompleted(details => writes.delete(details.id));
  isolated.webRequest.onErrorOccurred(details => writes.delete(details.id));
  window.webContents.on('will-navigate', (event, url) => { event.preventDefault(); external(url).catch(() => {}); });
  window.webContents.on('will-redirect', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => { external(url).catch(() => {}); return { action: 'deny' }; });
  window.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(window, { type: 'question', message: 'Discard unsaved changes and close?', buttons: ['Keep Editing', 'Discard'], defaultId: 0, cancelId: 0 });
    if (choice === 1) event.preventDefault();
  });
  window.on('close', event => {
    if (writes.size) { event.preventDefault(); dialog.showMessageBoxSync(window, { message: 'Wait for the current operation to finish.', detail: 'Morrow is saving or communicating with a provider.', buttons: ['OK'] }); return; }
    if (!window.isMaximized() && !window.isFullScreen()) { try { const { width, height } = window.getBounds(); writeFileSync(boundsFile, JSON.stringify({ width, height })); } catch {} }
  });
  ipcMain.on('morrow:state', (event, operation, key, value) => {
    try {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin) throw new Error();
      event.returnValue = { value: clientState(join(dataDirectory, 'client-state.json'), operation, key, value) };
    } catch { event.returnValue = { error: 'Unable to access saved desktop state. Your pending request has not been discarded.' }; }
  });
  ipcMain.handle('morrow:sign-in', async (event, url) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin || !isSignInURL(url, origin)) throw new Error('Invalid sign-in request.');
    await shell.openExternal(url);
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [{ label: 'Close', accelerator: 'Alt+F4', click: () => window.close() }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
  await window.loadURL(origin);
  if (smoke) {
    // A fresh temporary workspace only: never open or mutate the owner's mailbox.
    const result = await window.webContents.executeJavaScript(`(async () => {
      await new Promise((accept, reject) => {
        const ready = () => document.querySelector('.message-row') && accept();
        if (ready()) return;
        const observer = new MutationObserver(() => { if (document.querySelector('.message-row')) { observer.disconnect(); accept(); } });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => { observer.disconnect(); document.querySelector('.message-row') ? accept() : reject(new Error('Inbox did not render.')); }, 10000);
      });
      window.morrowDesktop.writeState('morrow.account.collapsed.demo', 'true');
      if (window.morrowDesktop.readState('morrow.account.collapsed.demo') !== 'true') throw new Error('Desktop state was not saved.');
      const response = await fetch('/api/state'); const state = await response.json();
      return { ok: response.ok, mode: state.account?.mode, count: state.messages?.length, node: typeof window.require, bridge: typeof window.morrowDesktop?.openSignIn, csp: !!document.querySelector('script[src]') };
    })()`);
    if (!result.ok || result.mode !== 'demo' || !result.count || result.node !== 'undefined' || result.bridge !== 'function' || !result.csp) throw new Error('Desktop smoke test failed.');
    if ((await fetch(`${origin}/api/state`)).status !== 401) throw new Error('Private API was exposed.');
    const health = await fetch(`${origin}/api/health`, { headers: { Authorization: `Bearer ${token}` } });
    if (!health.ok) throw new Error('Private service health check failed.');
    console.log(`Desktop smoke passed: ${app.isPackaged ? 'bundled' : 'development'} service, authenticated renderer, demo inbox, sandbox, private API.`);
    stop();
  }
}).catch(error => { if (smoke) console.error(error.message); fatal(); });
if (smoke) setTimeout(() => { if (!stopping) fatal(); }, 45_000).unref();
