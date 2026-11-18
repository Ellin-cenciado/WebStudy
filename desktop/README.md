# WebStudy desktop app

An Electron shell around the existing WebStudy React frontend and FastAPI
backend. The renderer is still the web app; Electron owns the window and runs
the Python engine as a child process.

## Fast path

From the repository root:

```bash
./scripts/setup.sh --with-desktop
cd desktop
npm start
```

`setup.sh --with-desktop` installs the backend's `desktop` extra, installs the
desktop npm dependencies, and builds `frontend/dist`. `npm start` rebuilds the
frontend and launches Electron. For a distributable AppImage:

```bash
cd desktop
npm run dist:linux
```

## How it works

- Electron picks a loopback port (`47821` by default, the next free port if it
  is busy) and starts the backend on `127.0.0.1`.
- The backend serves `frontend/dist` and remains the authority for timing,
  carry-over, checklist, and history state. No state moves into Electron.
- In development the backend runs from the repository virtualenv with
  `python -m webstudy`.
- In packaged builds the backend is a PyInstaller bundle in
  `resources/backend` and the frontend is in `resources/frontend`.
- Closing the app closes the SSE connection, asks the backend to shut down, and
  waits for it to save state. A small parent watchdog in the backend also stops
  it if Electron crashes, so the state-directory lock is not left behind.

Study data still uses the SimpleStudy XDG paths:

```text
~/.config/simplestudy/config.toml
~/.local/state/simplestudy/state.json
~/.local/state/simplestudy/checklist.json
~/.local/state/simplestudy/history.db
```

Electron's own window state and backend log live in its app data directory
(`~/.config/WebStudy` on Linux).

Do not run the web backend and the desktop app against the same data directory
at the same time; both write the same files and the desktop window would contend
for the state-directory lock.

## AI configuration

Study Prep uses the same server-side AI configuration as the web app. Configure
it once from the repository root:

```bash
./scripts/setup-ai.sh
```

The desktop backend loads `~/.config/simplestudy/webstudy.env` at startup
(override with `WEBSTUDY_ENV_FILE`), in both development and packaged builds.
No AI settings or API keys are stored in the Electron app. Use
`./scripts/doctor.sh` to verify the backend and provider, then see
[AI setup (Study Prep)](../README.md#ai-setup-study-prep) for providers, model
limits, and privacy notes.

## Development

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -e './backend[dev,desktop]'
cd frontend && npm install && cd ..
cd desktop && npm install
npm start
```

`npm start` rebuilds `frontend/dist` and launches Electron. Once the frontend
build exists, `npm run dev` skips the rebuild.

Useful overrides:

```bash
WEBSTUDY_CONFIG_DIR=/tmp/webstudy/config \
WEBSTUDY_STATE_DIR=/tmp/webstudy/state \
npm run dev

WEBSTUDY_PYTHON=/path/to/python npm run dev
WEBSTUDY_DESKTOP_PORT=48000 npm run dev
WEBSTUDY_DEBUG=1 npm run dev
```

- `WEBSTUDY_BACKEND` points development mode at a prebuilt backend executable.
- `WEBSTUDY_FRONTEND_DIST` points either mode at a different frontend build.
- `WEBSTUDY_ENV_FILE` points the backend at a different AI env file.
- `--smoke-test` makes the app quit shortly after the renderer loads; useful for
  CI and headless checks.
- Help → Open log folder opens the backend log. In development its output is
  also copied to the terminal.

## Packaging

PyInstaller is required. It is included in the `desktop` optional dependency:

```bash
.venv/bin/pip install -e './backend[desktop]'
```

Then:

```bash
cd desktop
npm run pack        # unpacked app in desktop/release/linux-unpacked/
npm run dist:linux  # AppImage in desktop/release/
```

`npm run build` performs only the frontend and backend builds; `pack` and
`dist:linux` add electron-builder on top. The current packaging target is Linux
because the backend's single-instance lock uses `fcntl`.

To build a Debian package as well, set a project `homepage` in
`desktop/package.json` (electron-builder requires one for deb metadata) and run
`npx electron-builder --linux deb`.

## Layout

```text
desktop/
├── main.cjs                 # Electron main process
├── backend_entry.py         # PyInstaller entry point
├── assets/icon.png          # app/window icon
├── scripts/build-backend.sh # PyInstaller build
├── package.json             # scripts + electron-builder config
└── README.md
```
