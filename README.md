# WebStudy

A web front end for the SimpleStudy study tracker, available in the browser, as
a standalone Electron desktop app, and as a native Android app. The original
Python domain engine is reused as the authority for all timing, carry-over,
checklist, and history rules; React only renders state and sends commands.

![WebStudy](frontend/public/favicon.svg)

## What it does

- Carries unmet required hours into the next day.
- Supports three weekday policies: **carried**, **optional**, and **free**.
- Supports **vacation mode** date ranges: no quota and no new debt while away,
  with existing debt preserved.
- Bounds accumulated debt with a configurable **debt ceiling** and provides a
  cooldown-limited **forgive carried debt** recovery action.
- Runs pomodoro study/break phases; breaks count toward the daily goal.
- Tracks checklist subjects and items with per-item timers, surplus carry, debt,
  and a five-minute rest after a subject is completed.
- Generates polished study notes and a deterministic checklist plan from rough
  notes plus PDF, PPTX, and Markdown sources (preview; requires an LLM).
- Shows live state over Server-Sent Events, history/compliance stats, debt, and
  optional weekend goals.
- Keeps the original SimpleStudy XDG data paths, so existing config, state,
  checklist, and history files are reused.
- Ships as a standalone Electron app with the Python backend bundled in; no
  separate server or terminal is needed.
- Ships as a native Android app with the Python engine embedded via Chaquopy;
  it works fully offline and does not start a local server.
- Offers an English/Spanish interface on Android with a language selector that
  can follow the system locale; the choice also localizes background-timer
  notifications and lock-screen actions.

## Layout

```text
WebStudy/
├── backend/
│   ├── webstudy/
│   │   ├── core/          # Pure domain logic (copied from SimpleStudy)
│   │   ├── storage/       # Atomic JSON, SQLite history, XDG paths
│   │   ├── study_prep/    # Source extraction, LLM pipeline, run store
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

## Study Prep (preview)

The **Study Prep** page turns rough class notes and text-based sources into
polished Markdown notes and an editable checklist plan. The browser uploads
files to the local backend, a background worker generates the notes, and you
review and edit the plan before importing it into the checklist. The Android
app's **Prep** tab uses the same backend over the LAN: generation and source
storage happen on the server, and the generated plan is imported into the
phone's local checklist.

### Configure a model

The preview is configured with environment variables only. No model settings
are written to `config.toml`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBSTUDY_LLM_MODEL` | *(required for Ollama/OpenAI-compatible)* | Model name, e.g. `llama3.1` or `gpt-4.1-mini` |
| `WEBSTUDY_LLM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible endpoint |
| `WEBSTUDY_LLM_API_KEY` | empty | Bearer token for a remote provider |
| `WEBSTUDY_LLM_PROVIDER` | inferred | `ollama`, `openai-compatible`, or `opencode` |
| `WEBSTUDY_LLM_CONTEXT_TOKENS` | `16384` | Prompt budget for the adapter |
| `WEBSTUDY_LLM_MAX_OUTPUT_TOKENS` | `2500` | Maximum generation per request |
| `WEBSTUDY_LLM_REASONING_EFFORT` | empty | `none` disables thinking on supported models |
| `WEBSTUDY_LLM_TIMEOUT_SECONDS` | `300` | Per-request timeout |
| `WEBSTUDY_OPENCODE_BASE_URL` | auto-discover | OpenCode V2 service URL |
| `WEBSTUDY_OPENCODE_PASSWORD` | `service.json` | OpenCode Basic-auth password |
| `WEBSTUDY_OPENCODE_AGENT` | `study-prep` | Agent used for JSON generation |
| `WEBSTUDY_OPENCODE_MODEL` | agent default | Optional `provider/model#variant` |
| `WEBSTUDY_OPENCODE_LOCATION` | per-run | Optional fixed agent workspace |
| `WEBSTUDY_OPENCODE_TIMEOUT_SECONDS` | `900` | Session wait timeout |

Thinking models such as Qwen3.5 can spend the whole output budget on hidden
reasoning, which produces an empty answer. On LM Studio, set
`WEBSTUDY_LLM_REASONING_EFFORT=none` to disable thinking for these JSON tasks.
The adapter retries once with reasoning disabled when a reply contains
reasoning but no content; if the provider rejects the parameter, it retries
without it and reports a clear error instead.

Set `WEBSTUDY_LLM_CONTEXT_TOKENS` to the model's real context window. Ollama
defaults to 4096 tokens unless the server is started with a larger
`OLLAMA_CONTEXT_LENGTH`; on a 4096-token window, use
`WEBSTUDY_LLM_MAX_OUTPUT_TOKENS=1500` so the outline prompt and response both
fit. Otherwise the reply can be cut off mid-JSON.

Local Ollama example:

```bash
export WEBSTUDY_LLM_MODEL=llama3.1
export WEBSTUDY_LLM_BASE_URL=http://127.0.0.1:11434/v1
.venv/bin/webstudy
```

Remote OpenAI-compatible example:

```bash
export WEBSTUDY_LLM_MODEL=gpt-4.1-mini
export WEBSTUDY_LLM_BASE_URL=https://api.openai.com/v1
export WEBSTUDY_LLM_API_KEY=sk-...
export WEBSTUDY_LLM_PROVIDER=openai-compatible
.venv/bin/webstudy
```

### Use an OpenCode agent

Study Prep can use an OpenCode V2 agent as its generation backend. The backend
host must be running the OpenCode background service; the phone and browser
never contact OpenCode directly.

```bash
opencode service start
export WEBSTUDY_LLM_PROVIDER=opencode
export WEBSTUDY_OPENCODE_AGENT=study-prep
export WEBSTUDY_OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash
.venv/bin/webstudy --host 0.0.0.0
```

The backend discovers the service URL with `opencode service status` and reads
the Basic-auth password from `~/.config/opencode/service.json` unless
`WEBSTUDY_OPENCODE_BASE_URL` and `WEBSTUDY_OPENCODE_PASSWORD` are set. Each run
gets its own `.opencode/agents/study-prep.md` under the run directory. The agent
is generated with read-only access to that directory and is denied shell, edit,
web, and external-directory access. Reads are workspace-relative (`**`), so
absolute paths outside the run directory remain blocked by `external_directory`.

When `WEBSTUDY_OPENCODE_LOCATION` points at a fixed workspace, an existing
agent file is preserved; make sure that agent is read-only before using it.

Each model call creates a fresh OpenCode session, waits for it to finish, reads
the final assistant text, validates the JSON, and deletes the session. This
keeps sections independent and avoids leaving sessions behind.

Without a model name (or an OpenCode agent when `WEBSTUDY_LLM_PROVIDER=opencode`),
the page shows a configuration warning and run creation fails with
`provider_not_configured`; retry works after the backend is restarted with a
provider configured.

### Inputs and limits

- Supported sources are text-based **PDF**, **PPTX**, and **Markdown**.
- DOCX, images, and scanned PDFs are rejected; OCR is not implemented.
- Up to 10 files, 50 MB per file, 200 MB total per run.
- Rough notes can be supplied alone; at least one source or non-empty rough
  notes is required.
- Output language is auto-detected, Spanish, or English. Depth is quick,
  balanced, or deep. A target number of minutes is optional.
- Study times are deterministic: source words, page/slide/section counts, note
  length, depth, exam scope, and the model's difficulty rating set the
  durations. The model never invents the total study time.
- Each detected chapter becomes one checklist subject. Import is additive,
  validates the whole plan first, bumps the checklist revision once, and
  broadcasts once. A run can be imported only once.

### Storage and privacy

Each run lives under `state_dir()/study-prep/<run_id>/` and keeps the raw
uploads, extracted text, rough notes, result JSON, and `run.json` progress. The
default location is `~/.local/state/simplestudy/study-prep/`.

The backend sends only the extracted excerpts needed for a prompt to the
configured model. A remote provider therefore receives that excerpt text; no
files are uploaded to a third party by WebStudy itself. Runs are processed one
at a time so a local Ollama instance is not overloaded. Deleting a run removes
its whole directory.

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

While a session is running, an Android foreground service keeps the timer and
event alerts alive through backgrounding and screen lock. It shows an ongoing
notification with pause/skip actions, requests notification permission on
Android 13+, and uses Android's elapsed-realtime clock so deep-sleep time is
counted.

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
- `POST /api/checklist/import` — atomic bulk subject/item import
- `GET /api/config`, `PUT /api/config`
- `GET /api/stats?days=30`
- `GET /api/recovery`, `POST /api/recovery/reset`
- `POST /api/session/start`, `/pause`, `/skip-phase`
- Subject/item CRUD plus `/select`, `/reset`, `/uncheck-last`
- `POST /api/items/{id}/check`
- `GET /api/study-prep/config`
- `POST /api/study-prep/runs` — multipart rough notes plus PDF/PPTX/Markdown
- `GET /api/study-prep/runs`, `/runs/{id}`, `/runs/{id}/result`
- `POST /api/study-prep/runs/{id}/cancel`, `/retry`, `/import`
- `DELETE /api/study-prep/runs/{id}`
- `GET /api/stream` — SSE (`state`, `checklist`, `event`)
- OpenAPI docs: `/api/docs`

## Notes and limitations

- Desktop notifications are opt-in in Settings. Android uses a foreground
  service and local notifications while a session is running; Android 13+
  requires notification permission for the notification and lock-screen
  controls.
- Vacation mode applies to logical days. It prevents new debt but does not
  rewrite already-settled days or forgive existing debt; use the recovery reset
  for that. The debt ceiling is 12 hours by default and can be disabled by
  setting it to 0. The reset cooldown defaults to 30 days and is enforced by
  the backend.
- Study Prep requires a reachable Ollama or OpenAI-compatible provider. The
  Android Prep tab also requires the WebStudy backend to be running and
  reachable over the LAN; generation is not performed on the phone.
- Study Prep has no OCR: scanned PDFs and image-only slides must be converted to
  text or uploaded as slides/Markdown with selectable text.
- The Android release APK is debug-signed and is intended for local
  installation; create a private keystore before distributing it.
- The desktop app's `[transparency]` config is preserved on save but is not
  exposed in the web settings UI.
- The backend is a single-worker application. Do not run multiple workers
  against one state directory.
- The web app reuses the existing engine import paths under `webstudy.core` and
  `webstudy.storage`; the GTK/D-Bus layer is not part of this project.
