# WebStudy

A local-first study tracker for the browser, as a standalone Electron desktop
app, and as a native Android app. The original Python domain engine remains the
authority for all timing, carry-over, checklist, and history rules; the React
front ends only render state and send commands. The web and desktop builds keep
SimpleStudy's XDG data paths, so existing config, state, checklist, and history
files are reused.

## Quick start

```bash
git clone https://github.com/Ellin-cenciado/WebStudy.git
cd WebStudy
./scripts/setup.sh
./scripts/start.sh
```

Then open <http://127.0.0.1:8000>.

`./scripts/setup.sh` is safe to re-run. It asks about:

- Python backend dependencies in `.venv`
- frontend dependencies and the production build
- the Study Prep AI provider (Ollama, LM Studio, OpenCode, a remote API, or skip)
- an optional Android release APK

For a phone on the same Wi-Fi:

```bash
./scripts/start.sh --lan              # terminal 1
./scripts/setup-mobile.sh --install   # terminal 2
```

Then open **Preparación → Servidor** (**Prep → Server** in English) in the app
and enter the LAN URL printed by `start.sh`.

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
  notes plus PDF, PPTX, and Markdown sources (requires an LLM).
- Shows live state over Server-Sent Events, history/compliance stats, debt, and
  optional weekend goals.
- Keeps the original SimpleStudy XDG data paths on the web and desktop builds,
  so existing config, state, checklist, and history files are reused.
- Ships as a standalone Electron app with the Python backend bundled in; no
  separate server or terminal is needed.
- Ships as a native Android app with the Python engine embedded via Chaquopy;
  the timer, checklist, and settings work fully offline, and it does not start
  a local server.
- Offers an English/Spanish interface on Android with a language selector that
  can follow the system locale; the choice also localizes background-timer
  notifications and lock-screen actions.

### Repository layout

```text
WebStudy/
├── backend/              # FastAPI, domain engine, storage, Study Prep
├── frontend/             # React 19 + Vite + Tailwind CSS
├── desktop/              # Electron shell + PyInstaller build
├── mobile/               # React Native + Chaquopy Android app
├── packaging/            # systemd user unit
├── scripts/              # setup, start, doctor, test, backup
└── README.md
```

See [`mobile/README.md`](mobile/README.md) and
[`desktop/README.md`](desktop/README.md) for the platform-specific architecture.

## Requirements

- **Python 3.11+** for the backend. The Android/Chaquopy build specifically
  requires **Python 3.14**; `setup-mobile.sh` finds it in `.venv` or on `PATH`,
  and `WEBSTUDY_PYTHON` overrides the choice.
- **Node.js 20.19+ or 22.12+** and npm for the web frontend; **22.12+** for
  desktop packaging and **22.11+** for the Android app.
- **Linux** for the `fcntl`/`flock` single-instance lock and the current
  Electron packaging targets.
- **JDK 21**, **Android SDK platform 36**, **build-tools 36.0.0**,
  **NDK 27.1.12297006**, and **CMake 3.22.1** only when building the Android
  app.
- **PyInstaller** only when packaging the desktop app; it is included in the
  backend's `desktop` extra.
- `adb` for installing the APK and `curl` for setup/doctor checks.
- For Study Prep: a local Ollama or LM Studio server, an existing OpenCode V2
  service, or a remote OpenAI-compatible endpoint. This is optional; the rest
  of WebStudy works without it.

## Setup

### Automatic

```bash
./scripts/setup.sh
```

It installs the backend in `.venv`, installs and builds the frontend, configures
Study Prep, and optionally builds the Android APK. Use `--yes` for unattended
setup; `setup-ai.sh` then picks an available provider automatically.

| Option | Effect |
| --- | --- |
| `--yes`, `-y` | Accept defaults and skip the Android prompt; use `--with-mobile` to build it. |
| `--with-mobile` | Build the Android release APK too. |
| `--with-desktop` | Install the backend desktop extra and desktop npm dependencies. |
| `--no-frontend` | Skip the frontend install/build. |
| `--skip-ai` | Do not configure Study Prep. |
| `--auto-ai` | Choose the best available AI provider automatically. |
| `--provider NAME` | `ollama`, `lmstudio`, `opencode`, `openai`, or `skip`. |
| `--model NAME` | Model name for the selected provider. |
| `--base-url URL` | Base URL for a remote OpenAI-compatible API or a remote OpenCode service. |
| `--reset-ai` | Back up and clear the existing AI configuration first. |

Run `./scripts/setup.sh --help` for the same list.

### Manual backend

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -e './backend[dev]'

cd frontend
npm install
npm run build
cd ..
```

If you create the venv yourself for Android, use Python 3.14;
`setup-mobile.sh` can also use `python3.14` on `PATH` or a `WEBSTUDY_PYTHON`
override. The backend itself accepts 3.11+.

### Manual frontend dev/prod

Development, with the backend running separately:

```bash
cd frontend
npm install
npm run dev
```

Production build served by the backend:

```bash
cd frontend
npm install
npm run build
```

The build is written to `frontend/dist`. See [Frontend](#frontend) for the Vite
proxy and override details.

### Manual Android build

Requires Python 3.14, JDK 21, and the SDK packages listed in
[Requirements](#requirements).

```bash
cd mobile
npm install
cd android
./gradlew :app:assembleRelease
```

The APK is written to
`mobile/android/app/build/outputs/apk/release/app-release.apk`. The helper
script also copies it to `mobile/release/WebStudy-0.1.0.apk`.

`setup-mobile.sh` auto-detects a Python 3.14 build interpreter: the repository
`.venv` when it is 3.14, otherwise `python3.14` on `PATH`. Set
`WEBSTUDY_PYTHON=/path/to/python3.14` to override. A manual Gradle build uses
`.venv` unless `WEBSTUDY_PYTHON` is set:

```bash
WEBSTUDY_PYTHON=/path/to/python3.14 ./gradlew :app:assembleRelease
```

See [Android app](#android-app) for installation and LAN setup.

### Manual desktop build

```bash
.venv/bin/pip install -e './backend[dev,desktop]'

cd frontend
npm install
npm run build
cd ..

cd desktop
npm install
npm run dist:linux
```

Artifacts are written to `desktop/release/`. The packaged backend is a
PyInstaller bundle, so the installed app does not require Python or Node. See
[`desktop/README.md`](desktop/README.md) for development mode, logs, and
packaging details.

### Scripts

| Script | What it does |
| --- | --- |
| `scripts/setup.sh` | One-command setup: backend, frontend, AI, optional Android. Options in the table above. |
| `scripts/setup-backend.sh` | Creates `.venv` and installs the editable backend. `--with-desktop` installs the backend desktop extra and desktop npm dependencies. |
| `scripts/setup-frontend.sh` | Installs frontend dependencies and builds `frontend/dist`. `--deps-only` skips the build. |
| `scripts/setup-ai.sh` | Interactively configures Study Prep and writes the shared env file. `--auto`, `--reset`, `--provider`, `--model`, `--base-url`, `--api-key`, `--context-tokens`, `--max-output-tokens`. |
| `scripts/setup-mobile.sh` | Checks the Android toolchain, auto-detects a Python 3.14 build interpreter, installs mobile dependencies, and builds the release APK. `--deps-only`, `--install`. |
| `scripts/start.sh` | Starts the backend with the saved AI config. `--lan`, `--host`, `--port`. |
| `scripts/install-service.sh` | Installs or removes a systemd user service for the backend. `--lan`, `--no-start`, `--uninstall`. |
| `scripts/dev.sh` | Runs the backend with auto-reload plus the Vite dev server. |
| `scripts/doctor.sh` | Diagnoses versions, frontend build, backend, AI provider, network, and Android. `--strict`, `--deep`. |
| `scripts/test.sh` | Runs backend, frontend, and mobile checks. `--backend-only`, `--frontend-only`, `--mobile-only`, `--no-build`. |
| `scripts/backup-simplestudy.sh` | Archives the SimpleStudy XDG config and state directories without modifying them. Optional destination argument. |
| `scripts/lib/common.sh` | Shared shell helpers sourced by the other scripts: paths, prompts, env-file access, LAN detection, and test runner. |

## AI setup (Study Prep)

Study Prep is optional. Without a provider the page shows a configuration
warning, and creating a run fails with `provider_not_configured`; the timer,
checklist, history, and settings still work. The provider is configured through
environment variables, never through `config.toml` or a settings screen.

### Interactive setup and verification

```bash
./scripts/setup-ai.sh
```

The script detects Ollama on `127.0.0.1:11434`, LM Studio on
`127.0.0.1:1234`, and a running OpenCode service, then offers Ollama, LM Studio,
OpenCode, Remote API, or Skip. It lists installed models, asks for a model and
context/output limits where relevant, tests the provider connection, and saves
the configuration. Rerun it to change providers; `--reset` backs up the env
file and clears the old AI keys immediately.

```bash
./scripts/doctor.sh
./scripts/doctor.sh --deep
```

`doctor.sh` prints the env file path and mode, the configured provider/model,
and reachability. For Ollama, `--deep` also sends a small completion to the
configured model. For OpenCode, `doctor.sh` uses the local service and
`service.json`, so for a remote OpenCode service verify
`WEBSTUDY_OPENCODE_BASE_URL`/`WEBSTUDY_OPENCODE_PASSWORD` and the config
endpoint instead. Restart the backend after changing the env file.

### The env file

The default file is:

```text
~/.config/simplestudy/webstudy.env
```

It is written by `setup-ai.sh` with mode `600` (owner read/write only). Override
the location with `WEBSTUDY_ENV_FILE`; if `WEBSTUDY_CONFIG_DIR` is set, the
default moves with that config directory. The backend auto-loads the file at
startup, including when started as `uvicorn webstudy.main:app` and by the
desktop app.

Precedence is:

```text
real environment variables  >  webstudy.env  >  built-in defaults
```

Real environment variables always win, which is useful for one-off overrides.
The file is a simple `KEY=VALUE` list: blank lines, `#` comments, an optional
`export ` prefix, and quoted values are accepted. It is not a shell script, so
there is no command substitution or variable expansion.

### Ollama

`setup-ai.sh` detects a running Ollama server with
`http://127.0.0.1:11434/api/tags`. If it is not reachable, start it and pull a
model first:

```bash
ollama serve
ollama pull llama3.1
```

Then rerun `./scripts/setup-ai.sh`, choose Ollama, and select an installed
model. The script writes the local endpoint
`http://127.0.0.1:11434/v1`, `WEBSTUDY_LLM_PROVIDER=ollama`, and
`WEBSTUDY_LLM_REASONING_EFFORT=none`.

**The 4096-context gotcha.** Ollama defaults to a 4096-token context even when
the model supports more. The safe defaults written for Ollama are:

```text
WEBSTUDY_LLM_CONTEXT_TOKENS=4096
WEBSTUDY_LLM_MAX_OUTPUT_TOKENS=1500
```

If you need a larger window, raise Ollama's context length and match it in the
backend. For example:

```bash
OLLAMA_CONTEXT_LENGTH=8192 ollama serve
```

Then set `WEBSTUDY_LLM_CONTEXT_TOKENS=8192` (rerun `setup-ai.sh` or edit the env
file) and restart the backend. If Ollama runs as a service, set
`OLLAMA_CONTEXT_LENGTH` in that service's environment instead. A mismatch is the
usual cause of prompts being cut off or replies ending mid-JSON: the backend
must not assume a larger window than Ollama actually serves. At 4096 tokens,
keep `WEBSTUDY_LLM_MAX_OUTPUT_TOKENS` at 1500 so the outline prompt and response
both fit.

### LM Studio

1. Load a model in LM Studio.
2. Open **Developer → Start Server**.
3. Keep the server running while Study Prep works.
4. Run `./scripts/setup-ai.sh` and choose LM Studio.

The script reads models from `http://127.0.0.1:1234/v1/models` and asks for the
model context length configured in LM Studio. Use the same value in LM Studio's
model settings; the script writes
`WEBSTUDY_LLM_BASE_URL=http://127.0.0.1:1234/v1`,
`WEBSTUDY_LLM_PROVIDER=lmstudio`, a context default of 8192, an output default
of 2000, and `WEBSTUDY_LLM_REASONING_EFFORT=none`. The backend treats every
non-`opencode` provider as OpenAI-compatible, so `lmstudio` is the setup
script's label and `openai-compatible` is equally valid in a manual config. If
the server is not running, the script exits and tells you to start it.

Thinking models such as Qwen3.5 can spend the whole output budget on hidden
reasoning, which produces an empty answer. `WEBSTUDY_LLM_REASONING_EFFORT=none`
disables thinking for these JSON tasks. The adapter retries once with reasoning
disabled when a reply contains reasoning but no content; if the provider rejects
the parameter, it retries without it and reports a clear error instead.

### OpenCode

Study Prep can use an existing **OpenCode V2** agent as its generation backend.
WebStudy connects to the OpenCode background service over its local HTTP API;
the browser and phone never contact OpenCode directly. **No API token is
requested** — OpenCode uses its own service password.

Choosing OpenCode in `./scripts/setup-ai.sh` for a local service:

- verifies `opencode --version` reports V2;
- runs `opencode service status` and offers `opencode service start` if the
  service is not running;
- reads the Basic-auth password from `~/.config/opencode/service.json` (or a
  saved `WEBSTUDY_OPENCODE_PASSWORD`);
- lists models with `opencode models`;
- tests `GET /api/info` on the service;
- writes `WEBSTUDY_LLM_PROVIDER=opencode`,
  `WEBSTUDY_OPENCODE_AGENT=study-prep`, and
  `WEBSTUDY_OPENCODE_MODEL=...` to the env file.

For a local service, if OpenCode is not installed, install it from
<https://opencode.ai/docs> or choose Ollama/LM Studio instead.

**Remote service (advanced).** Pass its URL with `--base-url`; the script uses
that URL directly and does **not** require the local `opencode` CLI. It prompts
for the **service password** if it cannot find one, and saves
`WEBSTUDY_OPENCODE_BASE_URL` and `WEBSTUDY_OPENCODE_PASSWORD`. The model list is
shown only when the CLI is available; otherwise pass `--model` or leave it blank
to use the agent default. It never asks for a provider API token.

Each run gets its own `.opencode/agents/study-prep.md` under the run directory.
The generated agent has read-only access to that directory and is denied shell,
edit, web, and external-directory access. Reads are workspace-relative (`**`),
so absolute paths outside the run directory remain blocked by
`external_directory`. When `WEBSTUDY_OPENCODE_LOCATION` points at a fixed
workspace, an existing agent file is preserved; make sure that agent is
read-only before using it.

Each model call creates a fresh OpenCode session, waits for it to finish, reads
the final assistant text, validates the JSON, and deletes the session. This
keeps sections independent and avoids leaving sessions behind. The session wait
timeout defaults to 900 seconds (`WEBSTUDY_OPENCODE_TIMEOUT_SECONDS`).

### Remote OpenAI-compatible API

Choose **Remote API** in `setup-ai.sh`, then enter the base URL, model, and API
key. The key prompt is hidden and the key is stored only in the mode-600 env
file. The script sends a small test prompt and warns that source excerpts will
be sent to that endpoint.

Only the extracted excerpts needed for a prompt are sent; WebStudy does not
upload files to a third party itself. A remote provider still receives that
excerpt text, so do not use one for confidential material.

### Manual environment examples

You can skip `setup-ai.sh` and write these to `webstudy.env` (or export them)
before starting the backend.

Ollama:

```bash
export WEBSTUDY_LLM_PROVIDER=ollama
export WEBSTUDY_LLM_MODEL=llama3.1
export WEBSTUDY_LLM_BASE_URL=http://127.0.0.1:11434/v1
export WEBSTUDY_LLM_CONTEXT_TOKENS=4096
export WEBSTUDY_LLM_MAX_OUTPUT_TOKENS=1500
export WEBSTUDY_LLM_REASONING_EFFORT=none
```

LM Studio:

```bash
export WEBSTUDY_LLM_PROVIDER=lmstudio
export WEBSTUDY_LLM_MODEL=your-lm-studio-model-id
export WEBSTUDY_LLM_BASE_URL=http://127.0.0.1:1234/v1
export WEBSTUDY_LLM_CONTEXT_TOKENS=8192
export WEBSTUDY_LLM_MAX_OUTPUT_TOKENS=2000
export WEBSTUDY_LLM_REASONING_EFFORT=none
```

OpenCode:

```bash
export WEBSTUDY_LLM_PROVIDER=opencode
export WEBSTUDY_OPENCODE_AGENT=study-prep
export WEBSTUDY_OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash

# Optional for a remote service; omit both to auto-discover locally.
export WEBSTUDY_OPENCODE_BASE_URL=https://opencode.example:4096
export WEBSTUDY_OPENCODE_PASSWORD=service-password
```

Remote OpenAI-compatible:

```bash
export WEBSTUDY_LLM_PROVIDER=openai-compatible
export WEBSTUDY_LLM_MODEL=gpt-4.1-mini
export WEBSTUDY_LLM_BASE_URL=https://api.openai.com/v1
export WEBSTUDY_LLM_API_KEY=sk-...
```

### Configuration reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `WEBSTUDY_LLM_MODEL` | empty | Model name, e.g. `llama3.1` or `gpt-4.1-mini`; required for Ollama/remote, optional for OpenCode. |
| `WEBSTUDY_LLM_BASE_URL` | `http://127.0.0.1:11434/v1` | OpenAI-compatible endpoint. |
| `WEBSTUDY_LLM_API_KEY` | empty | Bearer token for a remote provider. |
| `WEBSTUDY_LLM_PROVIDER` | inferred | `ollama`, `lmstudio`, `openai-compatible`, or `opencode`. Any non-`opencode` value uses the OpenAI-compatible adapter. |
| `WEBSTUDY_LLM_CONTEXT_TOKENS` | `16384` | Prompt budget for the adapter; `setup-ai.sh` writes `4096` for Ollama. |
| `WEBSTUDY_LLM_MAX_OUTPUT_TOKENS` | `2500` | Maximum generation per request; `setup-ai.sh` writes `1500` for Ollama. |
| `WEBSTUDY_LLM_REASONING_EFFORT` | empty | `none` disables thinking on supported models. |
| `WEBSTUDY_LLM_TIMEOUT_SECONDS` | `300` | Per-request timeout. |
| `WEBSTUDY_OPENCODE_BASE_URL` | auto-discover | OpenCode V2 service URL. |
| `WEBSTUDY_OPENCODE_PASSWORD` | `service.json` | OpenCode Basic-auth password. |
| `WEBSTUDY_OPENCODE_AGENT` | `study-prep` | Agent used for JSON generation. |
| `WEBSTUDY_OPENCODE_MODEL` | agent default | Optional `provider/model#variant`. |
| `WEBSTUDY_OPENCODE_LOCATION` | per-run | Optional fixed agent workspace. |
| `WEBSTUDY_OPENCODE_TIMEOUT_SECONDS` | `900` | Session wait timeout. |

### Verify it works

```bash
./scripts/doctor.sh
./scripts/doctor.sh --deep
curl -s http://127.0.0.1:8000/api/study-prep/config
```

The config response should show `"configured": true` with the provider and
model you chose. If not, rerun `./scripts/setup-ai.sh`, restart the backend,
then retry. If a run already failed with `provider_not_configured`, use Retry
after the restart. Adjust the curl port if you started the backend with
`--port`.

## Running

```bash
./scripts/start.sh
```

The backend loads `webstudy.env`; the script checks `.venv` and
`frontend/dist`, refuses to start if the chosen port is in use, and prints the
configured Study Prep provider. Open <http://127.0.0.1:8000>.

```bash
./scripts/start.sh --lan           # bind 0.0.0.0 for phones; prints the LAN URL
./scripts/start.sh --host 0.0.0.0 --port 8000
./scripts/start.sh --port 8001
```

The backend binds to localhost by default. There is intentionally no
authentication; do not expose it to an untrusted network. `--lan` warns about
this and prints the address to enter on the phone.

For live development:

```bash
./scripts/dev.sh
```

This runs the backend with auto-reload on port 8000 and Vite on port 5173. Press
Ctrl-C to stop both.

### systemd user service

On a systemd Linux host:

```bash
./scripts/install-service.sh          # localhost
./scripts/install-service.sh --lan    # phone on the same Wi-Fi
```

The script writes `~/.config/systemd/user/webstudy.service` (or the same path
under `$XDG_CONFIG_HOME`), enables it, and starts it now, with host/port and the
shared env file configured. `--lan` binds `0.0.0.0`; the backend has no
authentication, so use it only on a trusted network. `--no-start` enables the
unit without starting it, and `--uninstall` removes it.

```bash
systemctl --user status webstudy.service
journalctl --user -u webstudy.service -f
```

The packaged [`packaging/webstudy.service`](packaging/webstudy.service) remains
an alternative if you prefer to copy and edit the unit manually; adjust
`WorkingDirectory` and `ExecStart` if your checkout lives elsewhere. Open
<http://127.0.0.1:8000>.

## Frontend

During development Vite serves <http://127.0.0.1:5173> and proxies `/api`
(including the SSE stream) to `WEBSTUDY_API` or `http://127.0.0.1:8000` by
default. Start the backend separately, or use `./scripts/dev.sh` for both.

```bash
cd frontend
WEBSTUDY_API=http://127.0.0.1:9000 npm run dev
```

For production, `npm run build` writes `frontend/dist`; the backend serves it
automatically when it exists. `./scripts/start.sh` requires that build and tells
you to run `./scripts/setup-frontend.sh` if it is missing. Override the location
with `WEBSTUDY_FRONTEND_DIST` or `webstudy --frontend-dist /path/to/dist`.

Keyboard shortcuts on the timer page: `Space` starts/pauses, `S` skips a phase.

## Android app

The Android app is a native React Native UI backed by the same Python engine,
embedded with Chaquopy. It does not use a WebView, FastAPI, or a localhost
server; React Native calls `StudyService` directly through a JSON bridge. It
works fully offline and keeps its data in app-private storage, separate from the
desktop data directory. See [`mobile/README.md`](mobile/README.md) for the full
architecture, background timer, data paths, and limitations.

Requirements:

- JDK 21
- Android SDK platform 36 (`platforms;android-36`)
- Build Tools 36.0.0
- NDK 27.1.12297006
- CMake 3.22.1
- Python 3.14 for Chaquopy (auto-detected by `setup-mobile.sh`)
- Node.js 22.11+ and npm
- `adb` for installing on a device

Fast path:

```bash
./scripts/setup-mobile.sh            # build only
./scripts/setup-mobile.sh --install  # build and install on a connected device
```

`setup-mobile.sh` checks the toolchain, installs mobile npm dependencies, builds
the release APK, and copies it to `mobile/release/WebStudy-0.1.0.apk`. It
auto-detects a Python 3.14 build interpreter: `.venv` when it is 3.14, otherwise
`python3.14` on `PATH`. Set `WEBSTUDY_PYTHON` to override. The backend `.venv`
can stay on Python 3.11-3.13.

To build manually:

```bash
cd mobile
npm install
cd android
./gradlew :app:assembleRelease
```

The APK is written to
`mobile/android/app/build/outputs/apk/release/app-release.apk`. Install it with:

```bash
adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.webstudy.mobile/.MainActivity
```

If you built through `./scripts/setup-mobile.sh`, the copy at
`mobile/release/WebStudy-0.1.0.apk` is equivalent.

**Point the app at the backend.** Start the backend with LAN access:

```bash
./scripts/start.sh --lan
```

Keep the phone and computer on the same Wi-Fi, allow TCP port 8000 through the
computer's firewall, then open **Preparación → Servidor** (**Prep → Server** in
English) in the app and enter the printed URL, for example
`http://192.168.0.20:8000`. Tap **Conectar**/**Connect**. Cleartext HTTP is
enabled for LAN connections; the backend has no authentication, so use a
trusted network.

**Offline behavior.** The timer, checklist, stats, vacation settings, and
language choice work offline. Study Prep is the exception: it needs the
backend, and generation and source storage happen on the server. Force-stopping
the app or rebooting stops the foreground timer service; time while the process
was dead is not credited.

Debug builds still need Metro:

```bash
cd mobile
npm start          # terminal 1
npm run android    # terminal 2
```

The release APK is currently signed with the React Native debug keystore, so it
installs locally but is not store-ready. Create a private keystore before
distributing it.

## Desktop app

The Electron shell reuses the same frontend and backend. It starts the Python
engine on a loopback port, serves `frontend/dist` from it, and loads the result
in an Electron window. Data still lives in the SimpleStudy XDG paths, so the web
and desktop front ends can use the same data directory — but not at the same
time.

Fast path:

```bash
./scripts/setup.sh --with-desktop
cd desktop
npm start              # development; rebuilds frontend/dist first
# or
npm run dist:linux     # AppImage in desktop/release/
```

The desktop backend reads the shared
`~/.config/simplestudy/webstudy.env` AI configuration (override
`WEBSTUDY_ENV_FILE`), exactly like the web backend. Configure Study Prep once
with `./scripts/setup-ai.sh`; the packaged app picks the file up on launch. No
AI settings are stored inside Electron.

Packaging requires the `desktop` extra (PyInstaller). The installed app does not
need Python or Node. See [`desktop/README.md`](desktop/README.md) for
development overrides, logs, and the build layout.

## Data, backups, privacy

Default paths:

| Path | Contents |
| --- | --- |
| `~/.config/simplestudy/config.toml` | Study rules and settings. |
| `~/.config/simplestudy/webstudy.env` | Study Prep AI configuration, mode `600`. |
| `~/.local/state/simplestudy/state.json` | Current tracker state. |
| `~/.local/state/simplestudy/checklist.json` | Checklist subjects and items. |
| `~/.local/state/simplestudy/history.db` | SQLite history. |
| `~/.local/state/simplestudy/study-prep/<run_id>/` | Uploads, extracted text, notes, plan, and run progress. |
| `~/.local/state/simplestudy/webstudy.lock` | Advisory single-instance lock. |

`XDG_CONFIG_HOME` and `XDG_STATE_HOME` are honored. For side-by-side
development or tests, override the whole directories with
`WEBSTUDY_CONFIG_DIR` and `WEBSTUDY_STATE_DIR`. The Android app uses its own
app-private storage; clearing app data or uninstalling removes it.

Before first running against real SimpleStudy data, stop the original daemon and
make a backup:

```bash
./scripts/backup-simplestudy.sh
```

The script copies the XDG config and state directories into a timestamped
tarball under `~/webstudy-backups` by default (pass a different destination as
the first argument). It never modifies the originals. The original GTK
application remains a rollback path until web parity is fully verified.

**Stop the old GTK daemon before using the same data directory.** Both processes
would write the same files. WebStudy takes an advisory lock (`webstudy.lock`)
and refuses to start if another WebStudy backend owns it, but the old daemon
does not use that lock.

Study Prep runs are stored under `state_dir()/study-prep/<run_id>/`. Deleting a
run from the page (or `DELETE /api/study-prep/runs/{id}`) removes its whole
directory, including uploads, extracted text, notes, and plan. Runs are processed
one at a time so a local Ollama instance is not overloaded.

Only the extracted excerpts needed for a prompt are sent to the configured
model. A remote provider therefore receives that excerpt text; WebStudy itself
does not upload files to a third party. Do not send confidential material to a
remote provider.

The backend has no authentication. Keep it on localhost unless you are on a
trusted LAN, and do not expose it to the internet.

## Tests

```bash
./scripts/test.sh
```

This runs the backend unittest suite, frontend tests/lint/build, and mobile
TypeScript/tests/lint. Select subsets with `--backend-only`, `--frontend-only`,
or `--mobile-only`; `--no-build` skips the frontend build. Mobile checks require
mobile npm dependencies (`./scripts/setup-mobile.sh --deps-only`).

Manual commands:

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

The backend suite covers domain, service, API, storage, and Study Prep behavior.
The API tests use temporary directories, a fake clock, and disable the tick loop
and instance lock; they never read or write the real user data directory.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Study Prep says a model is not configured, or run creation returns `provider_not_configured` | No env file, model, or OpenCode agent | Run `./scripts/setup-ai.sh`, restart the backend, and retry. Check `curl -s http://127.0.0.1:8000/api/study-prep/config`. |
| Ollama connection refused | Ollama is not running, or the URL is wrong | Start it with `ollama serve`; check `curl http://127.0.0.1:11434/api/tags`; the base URL must be `http://127.0.0.1:11434/v1`. |
| "model not found" from Ollama | The model is not installed locally | Run `ollama list`, then `ollama pull <model>`; update `WEBSTUDY_LLM_MODEL` or rerun `setup-ai.sh`. |
| LM Studio is unreachable | The Developer server is stopped or no model is loaded | In LM Studio open **Developer → Start Server**, load a model, and use `http://127.0.0.1:1234/v1`. |
| OpenCode service is unavailable or the version is rejected | Not running, not V2, or not on `PATH` | Check `opencode --version` is 2.x and `opencode service status`; run `opencode service start`; install from <https://opencode.ai/docs> if missing. |
| OpenCode authentication fails | Wrong service password, or a remote URL/password mismatch | Check `~/.config/opencode/service.json`; set `WEBSTUDY_OPENCODE_PASSWORD`; verify `WEBSTUDY_OPENCODE_BASE_URL` for a remote service. |
| Replies are truncated, empty, or invalid JSON | Context/output limits do not match the model; a thinking model spent the budget on reasoning | For Ollama use 4096/1500 or raise `OLLAMA_CONTEXT_LENGTH` and match `WEBSTUDY_LLM_CONTEXT_TOKENS`; set `WEBSTUDY_LLM_REASONING_EFFORT=none`. |
| Port 8000 is already in use | Another backend or old process | Find it with `ss -ltnp \| grep 8000`, stop it, or run `./scripts/start.sh --port 8001`. |
| "another WebStudy backend is already using..." or the app will not start | A second backend/desktop instance, or the old GTK daemon, owns the data directory | Stop the other WebStudy process and the old SimpleStudy GTK daemon. The lock file is advisory and can remain on disk. |
| The phone cannot reach the backend | The backend is bound to localhost, the firewall blocks port 8000, or the URL is wrong | Start with `./scripts/start.sh --lan`, use the printed LAN URL, keep both devices on the same Wi-Fi, and allow TCP 8000. |
| Android build reports missing SDK, NDK, or CMake packages | Toolchain packages are not installed | Run the `sdkmanager` command printed by `setup-mobile.sh`, or install the packages in Android Studio; set `ANDROID_HOME` or `sdk.dir` in `mobile/android/local.properties`. |
| Chaquopy reports a Python version mismatch | The build interpreter is not Python 3.14 | Run `./scripts/setup-mobile.sh` (it auto-detects `.venv` or `python3.14` on `PATH`), or set `WEBSTUDY_PYTHON=/path/to/python3.14`. A manual Gradle build uses `.venv` unless overridden. |
| A remote API returns 401/403 or rejects the key | Wrong/expired key, wrong base URL, or a non-OpenAI-compatible endpoint | Rerun `./scripts/setup-ai.sh` and re-enter the key; verify the base URL ends in `/v1`; use `./scripts/doctor.sh`. |
| `frontend/dist` is missing | The frontend was never built | Run `./scripts/setup-frontend.sh` or `cd frontend && npm run build`. |

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
- Study Prep requires a reachable Ollama, LM Studio/OpenAI-compatible, or
  OpenCode provider. The Android Prep tab also requires the WebStudy backend to
  be running and reachable over the LAN; generation is not performed on the
  phone.
- Study Prep has no OCR: scanned PDFs and image-only slides must be converted to
  text or uploaded as slides/Markdown with selectable text. DOCX is not
  supported; sources must be PDF, PPTX, or Markdown.
- The Android release APK is debug-signed and is intended for local
  installation; create a private keystore before distributing it.
- The desktop app's `[transparency]` config is preserved on save but is not
  exposed in the web settings UI.
- The backend is a single-worker application. Do not run multiple workers
  against one state directory.
- The backend has no authentication. Localhost is the safe default; `--lan`
  exposes it to the local network.
- The web app reuses the existing engine import paths under `webstudy.core` and
  `webstudy.storage`; the GTK/D-Bus layer is not part of this project.
