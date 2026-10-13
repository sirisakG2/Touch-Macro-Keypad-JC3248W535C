#!/bin/sh
# Builds the keypad firmware with PlatformIO and copies the merged image + ESP Web Tools manifest
# into web/public/fw/ so the Worker serves it to the browser flasher.
# Runs in Cloudflare Workers Builds (`npm run build`) and locally.
# SKIP_FIRMWARE=1 skips it and ships the firmware already committed in web/public/fw/.
set -e
cd "$(dirname "$0")/.."

if [ "${SKIP_FIRMWARE:-0}" = "1" ]; then
  echo "SKIP_FIRMWARE=1: keeping the committed firmware in web/public/fw/"
  exit 0
fi

if ! command -v pio >/dev/null 2>&1; then
  echo "Installing PlatformIO..."
  python3 -m pip install --user --quiet --disable-pip-version-check platformio || python3 -m pip install --quiet --break-system-packages platformio
  PATH="$HOME/.local/bin:$PATH"
fi

pio run -d firmware -e keypad

VERSION=$(sed -n 's/.*-DFW_VERSION=\\"\([^\\]*\)\\".*/\1/p' firmware/platformio.ini)
BUILT=$(date -u +%Y-%m-%dT%H:%MZ)
mkdir -p web/public/fw
cp firmware/.pio/build/keypad/firmware.factory.bin web/public/fw/keypad-factory.bin
cat > web/public/fw/manifest.json <<JSON
{
  "name": "Touch Macro Keypad",
  "version": "${VERSION}",
  "built": "${BUILT}",
  "new_install_prompt_erase": false,
  "new_install_improv_wait_time": 0,
  "builds": [
    { "chipFamily": "ESP32-S3", "parts": [{ "path": "keypad-factory.bin", "offset": 0 }] }
  ]
}
JSON
echo "Firmware ${VERSION} -> web/public/fw/keypad-factory.bin"
