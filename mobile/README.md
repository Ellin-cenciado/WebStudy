# WebStudy Mobile

A native Android front end for WebStudy. The UI is React Native (not a WebView),
and the original Python domain engine runs inside the app through
[Chaquopy](https://chaquo.com/chaquopy/). There is no HTTP server, FastAPI,
Pydantic, or localhost connection on Android.

The Python bridge calls `StudyService` directly. React Native polls it once a
second and receives the same state, checklist, and event data that the web and
desktop apps use. The Study Prep screen is the one exception: it talks to a
WebStudy backend over HTTP for source extraction and note generation, then uses
the bridge to import the generated plan into the local checklist.

## Requirements

- Node.js 22.12+ and npm
- JDK 21
- Android SDK with:
  - Platform 36 (`platforms;android-36`)
  - Build Tools 36.0.0
  - NDK 27.1.12297006
  - CMake 3.22.1
- The repository Python virtual environment at `.venv`, or another Python
  3.14 installation selected with `WEBSTUDY_PYTHON`

This project targets `minSdk 24`, `compileSdk 36`, and `targetSdk 36`. Only the
`arm64-v8a` (devices) and `x86_64` (emulators) ABIs are built because Chaquopy
17.2 with Python 3.14 does not support 32-bit Android ABIs.

## Setup

```bash
cd /home/lin/Projects/WebStudy

python3 -m venv .venv
.venv/bin/pip install -e './backend[dev]'

cd mobile
npm install
```

Chaquopy uses `.venv/bin/python` by default. Override it when the venv lives
elsewhere:

```bash
cd mobile/android
WEBSTUDY_PYTHON=/path/to/python3.14 ./gradlew :app:assembleRelease
```

The Android SDK location is read from `android/local.properties`:

```properties
sdk.dir=/home/lin/Android/Sdk
```

## Build and run

### Debug (Metro required)

```bash
cd mobile
npm start          # terminal 1
npm run android    # terminal 2
```

The debug APK is written to
`android/app/build/outputs/apk/debug/app-debug.apk`. It loads JavaScript from
Metro, so it is not standalone.

### Release (standalone)

```bash
cd mobile/android
./gradlew :app:assembleRelease
```

The standalone APK is written to
`android/app/build/outputs/apk/release/app-release.apk`. JavaScript and the
Python engine are both bundled, so no Metro server is needed. Local validated
builds are also copied to `mobile/release/` (`WebStudy-0.1.0.apk` for the
current version); that directory is gitignored.

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.webstudy.mobile/.MainActivity
```

The release build is currently signed with the React Native debug keystore so
it can be installed locally. Replace `signingConfigs` in
`android/app/build.gradle` with a private keystore before publishing it.

## Architecture

```text
mobile/
├── App.tsx                       # Provider tree, header, tab shell
├── src/
│   ├── components/               # Shared native UI and tab bar
│   ├── context/                  # Theme, toast, dialog, config, live state
│   ├── hooks/useAction.ts        # Applies action responses and events
│   ├── lib/api.ts                # JS bridge + Android preferences
│   ├── lib/format.ts             # Clock/date formatting
│   ├── lib/studyPrep.ts          # Study Prep backend HTTP client
│   ├── lib/types.ts              # Shared engine payload types
│   └── screens/                  # Timer, Checklist, Prep, Stats, Settings
└── android/app/src/main/
    ├── java/com/webstudy/mobile/
    │   ├── WebStudyModule.kt     # Native module, single-threaded Python calls
    │   ├── WebStudyPackage.kt
    │   ├── MainActivity.kt
    │   └── MainApplication.kt
    └── python/webstudy_bridge.py # JSON bridge around StudyService
```

The Kotlin module starts Python on a background executor and lazily initializes
the bridge. React Native calls `NativeModules.WebStudy.dispatch(method, json)`;
the bridge returns `{ok: true, data: ...}` or `{ok: false, error: ...}`.

The UI polls `poll` every second while the app is active. Starting/pausing,
checklist edits, and config saves send their own action and immediately apply
the returned payload. Engine events are shown as in-app toasts. Tab icons use
Material Design Icons on Android (bundled from
`@react-native-vector-icons/material-design-icons`) and SF Symbols on iOS.

On Android the Python paths are redirected to app-private storage:

```text
files/webstudy/config/simplestudy/config.toml
files/webstudy/state/simplestudy/state.json
files/webstudy/state/simplestudy/checklist.json
files/webstudy/state/simplestudy/history.db
```

Timer, checklist, and settings data never leave the device. Study Prep is the
exception: the tab uploads the rough notes and selected sources to the backend
you configure, and the generated notes and plan live on that server. Clearing
app storage or uninstalling WebStudy removes the local data. Use Android
Settings → Apps → WebStudy → Storage → Clear data for a fresh start.

The theme preference is stored separately in Android `SharedPreferences` under
the key `theme` (`system`, `light`, or `dark`); the engine's config remains the
authority for study settings.

## Study Prep

The **Prep** tab generates polished notes and a study plan from rough notes and
text-based PDF, PPTX, or Markdown sources. Extraction, model calls, and source
storage run on the WebStudy backend, not on the phone, so the server must be
running and reachable over the same network.

Start the backend on the computer that runs Ollama (or another
OpenAI-compatible provider), bound to all interfaces:

```bash
export WEBSTUDY_LLM_MODEL=qwen3.8:27b
export WEBSTUDY_LLM_BASE_URL=http://127.0.0.1:11434/v1
export WEBSTUDY_LLM_REASONING_EFFORT=none
.venv/bin/webstudy --host 0.0.0.0
```

Use `--host 0.0.0.0` so the phone can connect. The model is configured with the
`WEBSTUDY_LLM_*` environment variables described in the main README; no model
settings are written to the app. The backend stores runs under
`state_dir()/study-prep/<run_id>/`, including the raw uploads, extracted text,
`notes.md`, `plan.json`, and `run.json`.

In the phone's Prep tab, enter the computer's LAN address (for example
`http://192.168.0.20:8000`) and tap **Connect**. The address is kept in Android
`SharedPreferences` under `studyPrepServer`. Cleartext HTTP is enabled for the
release manifest so the app can reach a LAN backend; use HTTPS or a trusted
network if the traffic must be protected.

The app polls the run until it is ready, then shows the Markdown notes and the
plan. **Import plan to checklist** maps each plan subject to a local checklist
subject and adds its items through the Python bridge. The import is atomic and
does not replace existing subjects. Imported run IDs are remembered in
`SharedPreferences` under `studyPrepImportedRuns`, so the app can label a plan
as already imported. Cancelling, retrying, and deleting a run only affect the
server; the local checklist is unchanged.

Sources must contain selectable text: scanned PDFs and image-only slides are
not supported because the pipeline has no OCR. DOCX is not accepted.

## Development checks

```bash
cd mobile
npx tsc --noEmit
npm test
npm run lint
```

The bridge can be exercised against the host Python environment without Android
by importing `webstudy_bridge` with `PYTHONPATH=backend`, then calling
`init("/tmp/webstudy-mobile")` and `dispatch("poll")`.

## Current limitations

- Notifications are in-app toasts only; there is no Android notification
  channel or background service.
- The app computes elapsed time from the engine's timestamps, so time continues
  to accrue while it is backgrounded or killed, but no alerts appear until the
  app is opened again.
- Desktop-only settings (transparency, XDG paths) are not exposed on Android.
- Study Prep needs the WebStudy backend and an Ollama or OpenAI-compatible
  provider reachable over the LAN; the phone cannot generate notes offline.
- Study Prep accepts only text-based PDF, PPTX, and Markdown. Scanned PDFs and
  image-only slides are rejected because there is no OCR, and DOCX is not
  supported.
- The release APK is debug-signed and is intended for local installation, not
  store distribution.
