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

## Background timer and notifications

While a study session is running, the app starts an Android foreground service
from the visible app. The service keeps the embedded Python engine ticking every
five seconds, so the timer continues through backgrounding and screen lock. It
uses Android's `SystemClock.elapsedRealtime()` for the engine clock, which
counts deep-sleep time instead of losing it.

The ongoing notification shows the current phase and a live countdown, with
**Pause** and **Skip phase** actions. Phase changes, rest-over, item expiry, day
rollover, and day completion are posted to a separate alert channel while the
app is in the background. React Native keeps handling in-app toasts while the
app is visible; the service does not consume those events in the foreground.

Android 13+ requires notification permission. The app asks when you start your
first session and also shows the status in **Settings → System notifications**.
Without permission the timer still runs, but background alerts and lock-screen
controls may not appear. The ongoing timer notification is required by the
foreground service; the **Alerts** toggle only controls event notifications and
in-app toasts.

A partial wake lock is held during a running session so phase alerts stay
timely. Pause the session to release it. On devices with aggressive battery
management, disable battery optimization for WebStudy if the OS still stops the
service; the app does not request that permission automatically.

When you return to the app, a banner reports time credited while you were away
(for example, “+12m 34s credited while you were away”). The app also persists an
away marker in native storage, so the banner still appears if Android destroyed
the UI while the service kept running—for example, after swiping the app out of
Recents. The marker includes a monotonic timestamp, so time that was not
actually credited (such as a force-stop or reboot gap) is not reported as away
time. Force-stopping the app or rebooting stops the service; time while the
process was dead is not credited.

## Vacation, debt ceiling, and recovery

Vacation mode is configured in **Settings → Vacation** as an optional date
range. Vacation days have no quota and add no new debt, but existing debt is
preserved. Already-settled days are not rewritten.

**Settings → Recovery** controls the debt ceiling and the reset cooldown. The
ceiling defaults to 12 hours (`0` disables it). When debt would exceed the
ceiling, the excess is forgiven and an event is emitted. **Forgive carried
debt** clears the current daily debt without erasing study time, history, or
checklist progress; the next reset is unavailable until the cooldown passes.
The cooldown is persisted in the tracker state, so it survives app restarts.

## Language

**Settings → Language** offers **System**, **English**, and **Español**
(rioplatense). The choice is stored in app-private preferences, applies without
a restart, and is remembered across launches. **System** follows the Android
locale, so Spanish devices start in Spanish automatically.

The selection also localizes the background timer notification, its
Pause/Skip actions, and the alert notifications emitted by the embedded engine.
Study Prep's generated output has its own **Language** selector and remains
independent (default: **Auto**, matching the source material).

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
    │   ├── WebStudyEngine.kt     # Shared serialised Python runtime
    │   ├── WebStudyModule.kt     # Native module + timer service controls
    │   ├── TimerService.kt       # Foreground timer and notification actions
    │   ├── TimerNotifications.kt # Channels, ongoing notification, alerts
    │   ├── WebStudyPackage.kt
    │   ├── MainActivity.kt
    │   └── MainApplication.kt
    └── python/webstudy_bridge.py # JSON bridge around StudyService
```

The shared Kotlin engine starts Python on a background executor and lazily
initializes the bridge. React Native and the foreground timer service both call
`NativeModules.WebStudy.dispatch(method, json)`; the bridge returns
`{ok: true, data: ...}` or `{ok: false, error: ...}`.

The UI polls `poll` every second while the app is active. Starting/pausing,
checklist edits, and config saves send their own action and immediately apply
the returned payload. Engine events are shown as in-app toasts. While a session
is running, the foreground service also polls every five seconds so the timer
and event alerts continue when the UI is not active. Tab icons use
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
export WEBSTUDY_LLM_CONTEXT_TOKENS=4096
export WEBSTUDY_LLM_MAX_OUTPUT_TOKENS=1500
.venv/bin/webstudy --host 0.0.0.0
```

Use `--host 0.0.0.0` so the phone can connect. The model is configured with the
`WEBSTUDY_LLM_*` environment variables described in the main README; no model
settings are written to the app. The backend stores runs under
`state_dir()/study-prep/<run_id>/`, including the raw uploads, extracted text,
`notes.md`, `plan.json`, and `run.json`.

To use an OpenCode agent instead, start OpenCode on the backend host and select
it in the backend environment:

```bash
opencode service start
export WEBSTUDY_LLM_PROVIDER=opencode
export WEBSTUDY_OPENCODE_AGENT=study-prep
export WEBSTUDY_OPENCODE_MODEL=opencode-go/deepseek-v4.1-flash
.venv/bin/webstudy --host 0.0.0.0
```

The phone still connects only to `http://<computer>:8000`. It never contacts the
OpenCode service, and the OpenCode password stays on the backend host.

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

- The background timer requires Android notification permission on Android 13+.
  Without it the timer still runs, but the ongoing notification, lock-screen
  controls, and background alerts may not be visible.
- Force-stopping the app or rebooting stops the foreground service. Time while
  the process was dead is not credited; the persisted session resumes on the
  next launch.
- Aggressive OEM battery managers may still stop the service. Disable battery
  optimization for WebStudy if that happens; the app does not request the
  exemption automatically.
- Desktop-only settings (transparency, XDG paths) are not exposed on Android.
- Study Prep needs the WebStudy backend and an Ollama or OpenAI-compatible
  provider reachable over the LAN; the phone cannot generate notes offline.
- Study Prep accepts only text-based PDF, PPTX, and Markdown. Scanned PDFs and
  image-only slides are rejected because there is no OCR, and DOCX is not
  supported.
- The release APK is debug-signed and is intended for local installation, not
  store distribution.
