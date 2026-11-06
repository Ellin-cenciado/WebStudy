# WebStudy

A web front end for the SimpleStudy study tracker, available in the browser, as
a standalone Electron desktop app, and as a native Android app. The original
Python domain engine is reused as the authority for all timing, carry-over,
checklist, and history rules; React only renders state and sends commands.

![WebStudy](frontend/public/favicon.svg)

## What it does

- Carries unmet required hours into the next day.
- Supports three weekday policies: **carried**, **optional**, and **free**.
- Runs pomodoro study/break phases; breaks count toward the daily goal.
- Tracks checklist subjects and items with per-item timers, surplus carry, debt,
  and a five-minute rest after a subject is completed.
- Shows live state over Server-Sent Events, history/compliance stats, debt, and
  optional weekend goals.
- Keeps the original SimpleStudy XDG data paths, so existing config, state,
  checklist, and history files are reused.
- Ships as a standalone Electron app with the Python backend bundled in; no
  separate server or terminal is needed.
- Ships as a native Android app with the Python engine embedded via Chaquopy;
  it works fully offline and does not start a local server.

## Layout

```text
WebStudy/
├── backend/
│   ├── webstudy/
│   │   ├── core/          # Pure domain logic (copied from SimpleStudy)
│   │   ├── storage/       # Atomic JSON, SQLite history, XDG paths
│   │   ├── service.py     # Timer/checklist authority
│   │   ├── events.py      # Transport-neutral events
│   │   └── api/           # FastAPI, SSE, schemas, lock
│   ├── tests/             # Domain, service, and API tests
│   └── pyproject.toml
├── frontend/              # React 19 + Vite + Tailwind CSS
├── desktop/               # Electron shell + PyInstaller build
├── mobile/                # React Native + Chaquopy Android app
├── packaging/             # systemd user unit
├── scripts/               # Backup/dev helpers
└── README.md
```

## Requirements

- Python 3.11+
- Node.js 22.12+ and npm (Vite 8 also supports Node 20.19 LTS)
- Linux for the `flock`-based single-instance lock and for the current Electron
  packaging targets
- PyInstaller only when building the standalone desktop app
- JDK 21, Android SDK 36, NDK 27.1, and CMake 3.22.1 only when building the
  Android app

## Setup

```bash
cd /home/lin/Projects/WebStudy

python3 -m venv .venv
.venv/bin/pip install -e './backend[dev]'

cd frontend
npm install
npm run build
cd ..
```

The frontend build is served by the backend when `frontend/dist` exists. During
development you can instead run Vite and let it proxy `/api` to the backend.

## Run

```bash
.venv/bin/webstudy                 # http://127.0.0.1:8000
# or
.venv/bin/uvicorn webstudy.main:app --host 127.0.0.1 --port 8000
```

The backend binds to localhost by default. There is intentionally no
authentication; do not expose it to an untrusted network.

Useful options:

```bash
.venv/bin/webstudy --host 127.0.0.1 --port 8000
.venv/bin/webstudy --config /path/to/config.toml
.venv/bin/webstudy --state-dir /path/to/state
.venv/bin/webstudy --frontend-dist /path/to/frontend/dist
```

Environment overrides for side-by-side development and tests:

```bash
export WEBSTUDY_CONFIG_DIR=/tmp/webstudy/config
export WEBSTUDY_STATE_DIR=/tmp/webstudy/state
export WEBSTUDY_FRONTEND_DIST=/path/to/frontend/dist
.venv/bin/webstudy
```

When these are unset, WebStudy uses the same paths as SimpleStudy:

```text
~/.config/simplestudy/config.toml
~/.local/state/simplestudy/state.json
~/.local/state/simplestudy/checklist.json
~/.local/state/simplestudy/history.db
```

**Stop the old GTK daemon before using the same data directory.** Both processes
would write the same files. WebStudy takes an advisory lock
(`webstudy.lock`) and will refuse to start if another WebStudy backend owns it,
but the old daemon does not use that lock.

## Desktop app (Electron)

The desktop shell reuses the same frontend and backend. It starts the Python
engine on a loopback port, serves `frontend/dist` from it, and loads the result
in an Electron window.

Development:

```bash
cd desktop
npm install
npm start
```

`npm start` rebuilds the frontend first. `npm run dev` skips that rebuild.

Packaging (AppImage):

```bash
.venv/bin/pip install -e './backend[desktop]'
cd desktop
npm install
npm run dist:linux
```

Artifacts are written to `desktop/release/`. The packaged backend is a
PyInstaller bundle, so the installed app does not require Python or Node. See
[`desktop/README.md`](desktop/README.md) for environment overrides, logs, and
the desktop build layout.

Data continues to live in the SimpleStudy XDG paths, so the web and desktop
front ends can be used against the same data directory, but not at the same
time.

## Android app

The Android app is a native React Native UI backed by the same Python engine,
embedded with Chaquopy. It does not use a WebView, FastAPI, or a localhost
server; React Native calls `StudyService` directly through a JSON bridge. It
works fully offline and keeps its data in app-private storage, separate from
the desktop data directory.

Requirements are JDK 21, Android SDK 36, NDK 27.1, CMake 3.22.1, and Python
3.14. See [`mobile/README.md`](mobile/README.md) for the full setup, data paths,
and architecture.

Standalone release build:

```bash
cd /home/lin/Projects/WebStudy
.venv/bin/pip install -e './backend[dev]'
cd mobile
npm install
cd android
./gradlew :app:assembleRelease
```

The APK is written to
`mobile/android/app/build/outputs/apk/release/app-release.apk` and contains the
JavaScript bundle plus the Python engine. It is currently signed with the
React Native debug keystore, so it installs locally but is not store-ready.
Debug builds (`npm run android`) still need Metro.

## Development

Run the backend and frontend in two terminals:

```bash
# terminal 1
cd /home/lin/Projects/WebStudy
.venv/bin/uvicorn webstudy.main:app --reload --host 127.0.0.1 --port 8000

# terminal 2
cd /home/lin/Projects/WebStudy/frontend
npm run dev
```

Vite serves `http://127.0.0.1:5173` and proxies `/api` (including the SSE
stream) to port 8000. Set `WEBSTUDY_API` to change the proxy target.

Keyboard shortcuts on the timer page: `Space` starts/pauses, `S` skips a phase.

## Tests

```bash
cd /home/lin/Projects/WebStudy
PYTHONPATH=backend .venv/bin/python -m unittest discover -s backend/tests -t backend

cd frontend
npm test
npm run build
npm run lint

cd ../mobile
npx tsc --noEmit
npm test
npm run lint
```

The API tests use temporary directories, a fake clock, and disable the tick
loop and instance lock. They never read or write the real user data directory.

## Data safety and backups

Before first running against real SimpleStudy data, make a backup. Stop the
original daemon first so the files are not changing while they are archived:

```bash
./scripts/backup-simplestudy.sh
```

The script copies the XDG config and state directories into a timestamped
tarball under `~/webstudy-backups` by default; it does not modify the originals.
To experiment safely, use the `WEBSTUDY_CONFIG_DIR` and `WEBSTUDY_STATE_DIR`
overrides with an empty directory instead.

The original GTK application in `/home/lin/Projects/SimpleStudy` is left intact
and can be used as a rollback path until web parity is fully verified.

## systemd user service

Copy or symlink the unit and adjust `WorkingDirectory`/`ExecStart` if your
checkout lives elsewhere:

```bash
mkdir -p ~/.config/systemd/user
cp packaging/webstudy.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now webstudy.service
```

Then open <http://127.0.0.1:8000>.

## API overview

- `GET /api/health`
- `GET /api/state` — snapshot plus checklist summary
- `GET /api/checklist` — full checklist and revision
- `GET /api/config`, `PUT /api/config`
- `GET /api/stats?days=30`
- `POST /api/session/start`, `/pause`, `/skip-phase`
- Subject/item CRUD plus `/select`, `/reset`, `/uncheck-last`
- `POST /api/items/{id}/check`
- `GET /api/stream` — SSE (`state`, `checklist`, `event`)
- OpenAPI docs: `/api/docs`

## Notes and limitations

- Notifications are in-app toasts; desktop notifications are opt-in in
  Settings. Android has no background notification service.
- The Android release APK is debug-signed and is intended for local
  installation; create a private keystore before distributing it.
- The desktop app's `[transparency]` config is preserved on save but is not
  exposed in the web settings UI.
- The backend is a single-worker application. Do not run multiple workers
  against one state directory.
- The web app reuses the existing engine import paths under `webstudy.core` and
  `webstudy.storage`; the GTK/D-Bus layer is not part of this project.
