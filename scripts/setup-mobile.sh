#!/usr/bin/env bash
# Check the Android toolchain, install mobile dependencies, and build the APK.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DEPS_ONLY=0
INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --deps-only) DEPS_ONLY=1 ;;
    --install) INSTALL=1 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--deps-only] [--install]

  --deps-only  Install mobile npm dependencies only.
  --install    Install the built APK on the connected adb device.
EOF
      exit 0
      ;;
    *) die "Unknown option: $arg" ;;
  esac
done

header "Android application"

need_cmd java || die "JDK 21 is required."
java_version="$(java -version 2>&1 | awk -F'"' '/version/ {print $2; exit}')"
version_ge "${java_version%%.*}" "21" || die "JDK 21+ is required (found $java_version)."
ok "Java $java_version"

BUILD_PYTHON="${WEBSTUDY_PYTHON:-}"
if [ -z "$BUILD_PYTHON" ]; then
  if have_venv; then
    venv_python_version="$("$(venv_python)" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
  else
    venv_python_version=""
  fi
  if [[ "$venv_python_version" == 3.14.* ]]; then
    BUILD_PYTHON="$(venv_python)"
  elif need_cmd python3.14; then
    BUILD_PYTHON="$(command -v python3.14)"
  else
    die "Chaquopy needs Python 3.14. Install python3.14 or set WEBSTUDY_PYTHON to a 3.14 interpreter."
  fi
fi
python_version="$("$BUILD_PYTHON" -c 'import sys; print(".".join(map(str, sys.version_info[:3])))')"
[[ "$python_version" == 3.14.* ]] || die "Chaquopy needs Python 3.14 (found $python_version at $BUILD_PYTHON)."
export WEBSTUDY_PYTHON="$BUILD_PYTHON"
ok "Chaquopy Python $python_version ($BUILD_PYTHON)"

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$SDK" ] && [ -f "$ANDROID_DIR/local.properties" ]; then
  SDK="$(sed -n 's/^sdk.dir=//p' "$ANDROID_DIR/local.properties" | head -n1)"
fi
if [ -z "$SDK" ] || [ ! -d "$SDK" ]; then
  cat <<EOF
Android SDK not found.

Install Android Studio or the command-line tools, then set one of:
  export ANDROID_HOME="\$HOME/Android/Sdk"
  echo "sdk.dir=\$HOME/Android/Sdk" > mobile/android/local.properties

Required packages:
  sdkmanager "platforms;android-36" "build-tools;36.0.0" \\
             "ndk;27.1.12297006" "cmake;3.22.1"
EOF
  exit 1
fi
ok "Android SDK: $SDK"

if [ ! -f "$ANDROID_DIR/local.properties" ]; then
  printf 'sdk.dir=%s\n' "$SDK" >"$ANDROID_DIR/local.properties"
  ok "Wrote mobile/android/local.properties"
fi

missing=()
[ -d "$SDK/platforms/android-36" ] || missing+=("platforms;android-36")
[ -d "$SDK/build-tools/36.0.0" ] || missing+=("build-tools;36.0.0")
[ -d "$SDK/ndk/27.1.12297006" ] || missing+=("ndk;27.1.12297006")
[ -d "$SDK/cmake/3.22.1" ] || missing+=("cmake;3.22.1")
if [ "${#missing[@]}" -gt 0 ]; then
  warn "Missing Android SDK packages: ${missing[*]}"
  if [ -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
    printf 'Install them with:\n  %s %s\n' \
      "$SDK/cmdline-tools/latest/bin/sdkmanager" \
      "$(printf '"%s" ' "${missing[@]}")"
  else
    echo "Open Android Studio → SDK Manager and install the packages above."
  fi
  exit 1
fi
ok "Android SDK packages present"

cd "$MOBILE_DIR"
need_cmd npm || die "npm is required to build the Android app."
if [ -f package-lock.json ]; then
  info "Installing mobile dependencies (npm ci)"
  npm ci
else
  info "Installing mobile dependencies (npm install)"
  npm install
fi

if [ "$DEPS_ONLY" = "1" ]; then
  ok "Mobile dependencies installed"
  exit 0
fi

info "Building release APK (first build can take several minutes)"
cd "$ANDROID_DIR"
./gradlew :app:assembleRelease

APK="$ANDROID_DIR/app/build/outputs/apk/release/app-release.apk"
[ -f "$APK" ] || die "Gradle did not produce $APK"
mkdir -p "$MOBILE_DIR/release"
cp "$APK" "$MOBILE_DIR/release/WebStudy-0.1.0.apk"
ok "APK: mobile/release/WebStudy-0.1.0.apk"

if [ "$INSTALL" = "1" ]; then
  need_cmd adb || die "adb is required to install the APK."
  devices="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
  [ -n "$devices" ] || die "No adb device connected. Enable USB debugging and authorize this computer."
  info "Installing on $devices"
  adb install -r "$MOBILE_DIR/release/WebStudy-0.1.0.apk"
  ok "Installed"
else
  echo
  echo "Install it with:"
  echo "  adb install -r \"$MOBILE_DIR/release/WebStudy-0.1.0.apk\""
fi

echo
cat <<EOF
For Study Prep on the phone:
  1. Start the backend with LAN access: ./scripts/start.sh --lan
  2. Keep the phone and computer on the same Wi-Fi.
  3. In the app open Preparación → Servidor and enter the printed http://IP:8000 URL.

The release APK is signed with the React Native debug keystore; create a
private keystore before distributing it outside your own devices.
EOF
