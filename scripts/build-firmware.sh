#!/bin/sh
# Builds the keypad firmware with PlatformIO and copies the merged image + ESP Web Tools manifest
# into web/public/fw/ so the Worker serves it to the browser flasher.
# Runs in Cloudflare Workers Builds (`npm run build`) and locally.
#
# Fast path: the manifest records a hash of the firmware sources. If the committed
# web/public/fw/ build already matches the sources, nothing is compiled (Cloudflare build ~35 s
# instead of ~6 min). Build locally and commit web/public/fw/ whenever firmware/ changes.
#   FORCE_FIRMWARE=1  always rebuild
#   SKIP_FIRMWARE=1   never build, ship whatever is committed
set -e
cd "$(dirname "$0")/.."

SOURCE=$( (ls firmware/platformio.ini firmware/partitions.csv; find firmware/src -type f) | LC_ALL=C sort | xargs cat | sha256sum | cut -c1-16)

if [ "${SKIP_FIRMWARE:-0}" = "1" ]; then
  echo "SKIP_FIRMWARE=1: keeping the committed firmware in web/public/fw/"
  exit 0
fi

if [ "${FORCE_FIRMWARE:-0}" != "1" ] && [ -f web/public/fw/keypad-factory.bin ] \
   && grep -q "\"source\": \"${SOURCE}\"" web/public/fw/manifest.json 2>/dev/null; then
  echo "Firmware unchanged (source ${SOURCE}) - using the committed build in web/public/fw/"
  exit 0
fi

echo "Building firmware (source ${SOURCE}) with PlatformIO..."
if ! command -v pio >/dev/null 2>&1; then
  echo "Installing PlatformIO..."
  python3 -m pip install --user --quiet --disable-pip-version-check platformio || python3 -m pip install --quiet --break-system-packages platformio
  PATH="$HOME/.local/bin:$PATH"
fi

# quieter library clones in the build log
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=advice.detachedHead GIT_CONFIG_VALUE_0=false

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
  "source": "${SOURCE}",
  "new_install_prompt_erase": false,
  "new_install_improv_wait_time": 0,
  "builds": [
    { "chipFamily": "ESP32-S3", "parts": [{ "path": "keypad-factory.bin", "offset": 0 }] }
  ]
}
JSON
echo "Firmware ${VERSION} -> web/public/fw/keypad-factory.bin"
