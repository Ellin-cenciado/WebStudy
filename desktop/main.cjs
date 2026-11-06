'use strict';

/**
 * Electron shell for WebStudy.
 *
 * The renderer is the existing React app, served by the existing FastAPI
 * backend. The backend is a separate process: in development it comes from the
 * repository's Python virtualenv, and in packaged builds it is the PyInstaller
 * bundle in `resources/backend`.
 */

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  nativeTheme,
  screen,
  session,
  shell,
} = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const APP_NAME = 'WebStudy';
// A stable port keeps the renderer origin (and therefore localStorage, such as
// the theme choice) consistent between launches. If the port is busy we fall
// back to the next free port.
const DEFAULT_PORT = 47821;
const STARTUP_TIMEOUT_MS = 45_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;

const projectRoot = path.resolve(__dirname, '..');
const isDev = !app.isPackaged;
const debug = isDev || process.env.WEBSTUDY_DEBUG === '1';
const smokeTest = process.argv.includes('--smoke-test');

app.setName(APP_NAME);
if (process.platform === 'linux') {
  try {
    app.setDesktopName('webstudy.desktop');
  } catch {
    // Older Electron versions do not expose this on every platform.
  }
}
if (process.platform === 'win32') {
  app.setAppUserModelId('com.webstudy.WebStudy');
}

let mainWindow = null;
let backendProcess = null;
let backendExit = null;
let backendSpawnError = null;
let backendOutput = '';
let backendLogPath = '';
let backendLogStream = null;
let appUrl = '';
let appOrigin = '';
let startupComplete = false;
let quitting = false;
let failureReported = false;

function debugLog(...args) {
  if (debug) {
    console.log('[webstudy]', ...args);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isUsableWindow(window) {
  return window !== null && !window.isDestroyed();
}

function focusMainWindow() {
  if (!isUsableWindow(mainWindow)) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* -------------------------------------------------------------------------- */
/* Window state                                                               */
/* -------------------------------------------------------------------------- */

function windowStateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  const fallback = { width: 1180, height: 820, maximized: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8'));
    if (!Number.isFinite(parsed.width) || !Number.isFinite(parsed.height)) {
      return fallback;
    }
    const state = {
      width: Math.max(720, Math.round(parsed.width)),
      height: Math.max(560, Math.round(parsed.height)),
      maximized: parsed.maximized === true,
    };
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      const bounds = {
        x: Math.round(parsed.x),
        y: Math.round(parsed.y),
        width: state.width,
        height: state.height,
      };
      const visible = screen.getAllDisplays().some((display) => {
        const area = display.workArea;
        return (
          bounds.x < area.x + area.width &&
          bounds.x + bounds.width > area.x &&
          bounds.y < area.y + area.height &&
          bounds.y + bounds.height > area.y
        );
      });
      if (visible) {
        state.x = bounds.x;
        state.y = bounds.y;
      }
    }
    return state;
  } catch {
    return fallback;
  }
}

function saveWindowState() {
  if (!isUsableWindow(mainWindow)) return;
  try {
    const maximized = mainWindow.isMaximized();
    const bounds = maximized
      ? mainWindow.getNormalBounds()
      : mainWindow.getBounds();
    fs.mkdirSync(path.dirname(windowStateFile()), { recursive: true });
    fs.writeFileSync(
      windowStateFile(),
      JSON.stringify({ ...bounds, maximized }),
      'utf8',
    );
  } catch (error) {
    debugLog('could not save window state:', error.message);
  }
}

/* -------------------------------------------------------------------------- */
/* Splash and main window                                                     */
/* -------------------------------------------------------------------------- */

const SPLASH_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>WebStudy</title>
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; margin: 0; }
  body {
    display: grid;
    place-items: center;
    background: #f8fafc;
    color: #0f172a;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 18px; }
  .logo {
    width: 72px;
    height: 72px;
    border-radius: 20px;
    background: #4f46e5;
    display: grid;
    place-items: center;
    box-shadow: 0 18px 40px rgba(79, 70, 229, 0.3);
  }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.02em; }
  .sub { margin: 0; font-size: 13px; color: #64748b; }
  .spinner {
    width: 22px;
    height: 22px;
    border: 3px solid rgba(99, 102, 241, 0.25);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #020617; color: #e2e8f0; }
    .sub { color: #94a3b8; }
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="wrap">
    <div class="logo">
      <svg width="44" height="44" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M18 18.5c0-1.4 1.1-2.5 2.5-2.5H30v31H20.5A2.5 2.5 0 0 1 18 44.5v-26Z" fill="#fff" opacity=".92"/>
        <path d="M46 18.5c0-1.4-1.1-2.5-2.5-2.5H34v31h9.5a2.5 2.5 0 0 0 2.5-2.5v-26Z" fill="#fff" opacity=".72"/>
        <path d="m26 33 4 4 9-9" fill="none" stroke="#4f46e5" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1>WebStudy</h1>
    <p class="sub">Starting the study engine…</p>
    <div class="spinner" role="status" aria-label="Starting"></div>
  </div>
</body>
</html>`;

function splashUrl() {
  return `data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`;
}

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      void shell.openExternal(parsed.toString());
    }
  } catch {
    // Ignore malformed URLs.
  }
}

function hardenWindow(window) {
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (appOrigin === '') return;
    try {
      if (new URL(url).origin !== appOrigin) {
        event.preventDefault();
        openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });
}

function createWindow() {
  const state = readWindowState();
  const options = {
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 560,
    show: false,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#020617' : '#f8fafc',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: true,
    },
  };
  if (state.x !== undefined && state.y !== undefined) {
    options.x = state.x;
    options.y = state.y;
  }

  mainWindow = new BrowserWindow(options);
  if (state.maximized) mainWindow.maximize();

  mainWindow.once('ready-to-show', () => {
    if (isUsableWindow(mainWindow)) mainWindow.show();
  });
  mainWindow.on('close', saveWindowState);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  hardenWindow(mainWindow);
  mainWindow.loadURL(splashUrl()).catch((error) => {
    debugLog('could not load the splash page:', error.message);
  });
}

/* -------------------------------------------------------------------------- */
/* Permissions and menu                                                       */
/* -------------------------------------------------------------------------- */

function configureSession() {
  const allowed = new Set(['notifications']);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowed.has(permission));
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => allowed.has(permission),
  );
}

function stateDirectory() {
  if (process.env.WEBSTUDY_STATE_DIR) {
    return path.resolve(process.env.WEBSTUDY_STATE_DIR);
  }
  const base =
    process.env.XDG_STATE_HOME ||
    path.join(app.getPath('home'), '.local', 'state');
  return path.join(base, 'simplestudy');
}

function openFolder(target) {
  try {
    fs.mkdirSync(target, { recursive: true });
    void shell.openPath(target);
  } catch (error) {
    debugLog('could not open folder:', error.message);
  }
}

function showAbout() {
  const options = {
    type: 'info',
    title: `About ${APP_NAME}`,
    message: `${APP_NAME} ${app.getVersion()}`,
    detail: [
      'A standalone desktop study tracker with carry-over hours, pomodoro timing, and a per-item checklist.',
      '',
      `Study data: ${stateDirectory()}`,
      appUrl ? `Backend: ${appUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    buttons: ['OK'],
    noLink: true,
  };
  if (isUsableWindow(mainWindow)) {
    void dialog.showMessageBox(mainWindow, options);
  } else {
    void dialog.showMessageBox(options);
  }
}

function buildMenu() {
  const viewItems = [
    { role: 'reload' },
    { role: 'forceReload' },
    ...(debug ? [{ role: 'toggleDevTools' }] : []),
    { type: 'separator' },
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    { type: 'separator' },
    { role: 'togglefullscreen' },
  ];

  const template = [
    {
      label: 'File',
      submenu: [{ role: 'quit' }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: viewItems,
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Open data folder',
          click: () => openFolder(stateDirectory()),
        },
        {
          label: 'Open log folder',
          click: () => openFolder(app.getPath('logs')),
        },
        { type: 'separator' },
        {
          label: `About ${APP_NAME}`,
          click: showAbout,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* -------------------------------------------------------------------------- */
/* Backend process                                                            */
/* -------------------------------------------------------------------------- */

function resolveFrontendDist() {
  if (process.env.WEBSTUDY_FRONTEND_DIST) {
    return path.resolve(process.env.WEBSTUDY_FRONTEND_DIST);
  }
  return app.isPackaged
    ? path.join(process.resourcesPath, 'frontend')
    : path.join(projectRoot, 'frontend', 'dist');
}

function resolveBackend(port, frontendDist) {
  const args = [
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--frontend-dist',
    frontendDist,
    '--timeout-graceful-shutdown',
    '2',
  ];

  if (process.env.WEBSTUDY_BACKEND) {
    const command = path.resolve(process.env.WEBSTUDY_BACKEND);
    return { command, args, cwd: path.dirname(command), packaged: true };
  }

  if (app.isPackaged) {
    const executable = process.platform === 'win32' ? 'webstudy.exe' : 'webstudy';
    const command = path.join(process.resourcesPath, 'backend', executable);
    return { command, args, cwd: path.dirname(command), packaged: true };
  }

  const defaultPython =
    process.platform === 'win32'
      ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
      : path.join(projectRoot, '.venv', 'bin', 'python');
  const python = process.env.WEBSTUDY_PYTHON || defaultPython;
  return {
    command: python,
    args: ['-m', 'webstudy', ...args],
    cwd: projectRoot,
    packaged: false,
  };
}

function prepareBackendLog() {
  backendLogPath = path.join(app.getPath('logs'), 'backend.log');
  try {
    fs.mkdirSync(path.dirname(backendLogPath), { recursive: true });
    backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'w' });
    backendLogStream.on('error', (error) => {
      debugLog('backend log stream failed:', error.message);
      backendLogStream = null;
    });
  } catch (error) {
    debugLog('could not create the backend log:', error.message);
    backendLogStream = null;
  }
}

function appendBackendOutput(chunk) {
  const text = chunk.toString();
  backendOutput = (backendOutput + text).slice(-20_000);
  if (backendLogStream) backendLogStream.write(chunk);
  if (debug) process.stdout.write(text);
}

function startBackend(port, frontendDist) {
  prepareBackendLog();

  const spec = resolveBackend(port, frontendDist);
  if (!fs.existsSync(spec.command)) {
    throw new Error(
      `The WebStudy backend was not found at ${spec.command}.\n\n` +
        'In development, create the virtualenv and install the backend:\n' +
        '  python3 -m venv .venv\n' +
        "  .venv/bin/pip install -e './backend[dev]'\n\n" +
        'In a packaged build, rebuild the app with `npm run build` inside desktop/.',
    );
  }

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    WEBSTUDY_PARENT_PID: String(process.pid),
  };

  if (spec.packaged) {
    delete env.PYTHONHOME;
    delete env.PYTHONPATH;
  } else {
    const backendDir = path.join(projectRoot, 'backend');
    env.PYTHONPATH = env.PYTHONPATH
      ? `${backendDir}${path.delimiter}${env.PYTHONPATH}`
      : backendDir;
  }

  debugLog('starting backend:', spec.command, spec.args.join(' '));
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backendProcess = child;
  backendExit = null;
  backendSpawnError = null;
  child.stdout.on('data', appendBackendOutput);
  child.stderr.on('data', appendBackendOutput);

  child.on('error', (error) => {
    backendSpawnError = error;
    appendBackendOutput(`\nFailed to launch the backend: ${error.stack || error.message}\n`);
  });

  child.on('exit', (code, signal) => {
    backendExit = { code, signal };
    if (backendProcess === child) backendProcess = null;
    debugLog(`backend exited (code=${code}, signal=${signal})`);
    if (!quitting && startupComplete) {
      void reportBackendFailure(
        `The study engine stopped unexpectedly (${
          signal ? `signal ${signal}` : `exit code ${code}`
        }).`,
      );
    }
  });

  return child;
}

function checkHealth(url) {
  return new Promise((resolve) => {
    const request = http.get(`${url}/api/health`, { timeout: 1_500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
  });
}

async function waitForBackend(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (quitting) throw new Error('__cancelled__');
    if (backendSpawnError) {
      throw new Error(`Could not launch the backend: ${backendSpawnError.message}`);
    }
    if (backendExit) {
      throw new Error(
        `The backend exited during startup (${
          backendExit.signal
            ? `signal ${backendExit.signal}`
            : `exit code ${backendExit.code}`
        }).`,
      );
    }
    if (await checkHealth(url)) return;
    await delay(200);
  }
  throw new Error(
    `The backend did not become ready within ${Math.round(timeoutMs / 1000)} seconds.`,
  );
}

function stopBackend() {
  const child = backendProcess;
  if (!child || child.exitCode !== null) {
    if (backendLogStream) {
      backendLogStream.end();
      backendLogStream = null;
    }
    backendProcess = null;
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let killTimer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      if (backendLogStream) {
        backendLogStream.end();
        backendLogStream = null;
      }
      backendProcess = null;
      resolve();
    };

    child.once('exit', finish);
    child.once('close', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }

    killTimer = setTimeout(() => {
      if (settled) return;
      debugLog('backend did not stop in time; sending SIGKILL');
      try {
        child.kill('SIGKILL');
      } catch {
        // The process may have exited between the check and the kill.
      }
      setTimeout(finish, 1_000);
    }, SHUTDOWN_TIMEOUT_MS);
  });
}

function recentBackendOutput() {
  const text = backendOutput.trim();
  if (!text) return '';
  return text.slice(-6_000);
}

async function reportBackendFailure(message) {
  if (failureReported || quitting) return;
  failureReported = true;
  startupComplete = false;

  const output = recentBackendOutput();
  const options = {
    type: 'error',
    title: `${APP_NAME} backend stopped`,
    message,
    detail: [
      output ? `Recent backend output:\n\n${output}` : '',
      backendLogPath ? `Full log: ${backendLogPath}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    buttons: ['Quit'],
    defaultId: 0,
    noLink: true,
  };

  try {
    if (isUsableWindow(mainWindow)) {
      await dialog.showMessageBox(mainWindow, options);
    } else {
      await dialog.showMessageBox(options);
    }
  } catch {
    // The window may have closed while the dialog was being shown.
  }
  app.quit();
}

async function handleFatal(error) {
  if (quitting) return;
  quitting = true;

  const output = recentBackendOutput();
  const options = {
    type: 'error',
    title: `${APP_NAME} could not start`,
    message: `${APP_NAME} could not start.`,
    detail: [
      error instanceof Error ? error.message : String(error),
      output ? `Recent backend output:\n\n${output}` : '',
      backendLogPath ? `Full log: ${backendLogPath}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    buttons: ['Quit'],
    defaultId: 0,
    noLink: true,
  };

  try {
    await dialog.showMessageBox(options);
  } catch {
    // There may not be a display available; the process still has to exit.
  }
  await stopBackend();
  app.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Port selection                                                             */
/* -------------------------------------------------------------------------- */

function tryListen(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port }, () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : port;
      server.close(() => resolve(selected));
    });
  });
}

async function findAvailablePort() {
  const configured = Number.parseInt(process.env.WEBSTUDY_DESKTOP_PORT || '', 10);
  const preferred =
    Number.isInteger(configured) && configured > 0 && configured <= 65_535
      ? configured
      : DEFAULT_PORT;

  for (let port = preferred; port < Math.min(preferred + 20, 65_536); port += 1) {
    try {
      return await tryListen(port);
    } catch {
      // Try the next port.
    }
  }
  return tryListen(0);
}

/* -------------------------------------------------------------------------- */
/* Startup and app lifecycle                                                  */
/* -------------------------------------------------------------------------- */

async function bootstrap() {
  configureSession();
  buildMenu();

  const frontendDist = resolveFrontendDist();
  if (!fs.existsSync(path.join(frontendDist, 'index.html'))) {
    throw new Error(
      `The frontend build was not found at ${frontendDist}.\n\n` +
        'Build it first:\n' +
        '  cd frontend && npm install && npm run build\n\n' +
        'Or run `npm start` from desktop/, which builds it automatically.',
    );
  }

  const port = await findAvailablePort();
  appUrl = `http://127.0.0.1:${port}`;
  appOrigin = new URL(appUrl).origin;

  createWindow();
  startBackend(port, frontendDist);
  debugLog('waiting for backend at', appUrl);
  await waitForBackend(appUrl, STARTUP_TIMEOUT_MS);

  if (quitting) return;
  startupComplete = true;
  debugLog('backend ready; loading app');

  if (!isUsableWindow(mainWindow)) return;
  await mainWindow.loadURL(appUrl);

  if (smokeTest) {
    debugLog('smoke test: app loaded');
    setTimeout(() => app.quit(), 750);
  }
}

app.on('window-all-closed', () => {
  if (quitting) return;
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (isUsableWindow(mainWindow)) {
    focusMainWindow();
    return;
  }
  if (appUrl !== '') {
    createWindow();
    mainWindow.loadURL(appUrl).catch((error) => {
      debugLog('could not reload the app window:', error.message);
    });
  }
});

app.on('second-instance', () => {
  focusMainWindow();
});

app.on('before-quit', (event) => {
  if (quitting) return;
  if (!backendProcess) {
    quitting = true;
    return;
  }
  event.preventDefault();
  quitting = true;
  saveWindowState();
  // Close the renderer first so its SSE connection goes away; otherwise
  // uvicorn waits for the open stream during its shutdown grace period.
  if (isUsableWindow(mainWindow)) mainWindow.destroy();
  void stopBackend().finally(() => {
    app.quit();
  });
});

app.on('will-quit', () => {
  if (backendProcess) {
    try {
      backendProcess.kill('SIGKILL');
    } catch {
      // Already gone.
    }
    backendProcess = null;
  }
  if (backendLogStream) {
    backendLogStream.end();
    backendLogStream = null;
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!quitting) app.quit();
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      void handleFatal(error);
    });
}
