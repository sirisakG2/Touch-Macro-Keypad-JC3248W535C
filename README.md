# Touch Macro Keypad – JC3248W535C

A 3.5" touchscreen **macro keypad** built on the Guition **JC3248W535C** (ESP32-S3), plus **Macro Keypad Studio**, a browser app for designing everything: pages, keycaps, icons, pictures, effects, click sounds and macros. It types as a **USB keyboard** when plugged into a computer and as a **Bluetooth keyboard** otherwise. Firmware updates install from the studio with one click.

| | |
|---|---|
| **Open the studio** | https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev |
| **User guide – English** (install, use, update, troubleshooting) | [online](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev/guide.html) · [`web/public/guide.html`](web/public/guide.html) |
| **คู่มือการใช้งาน – ภาษาไทย** | [ออนไลน์](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev/guide-th.html) · [`web/public/guide-th.html`](web/public/guide-th.html) |
| **Install firmware in the browser** | [Firmware page](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev/flasher.html) |
| **Product specification** | [`docs/index.html`](docs/index.html) |
| **Hardware notes** | [`docs/hardware-notes.md`](docs/hardware-notes.md) |

## Features

- **Keyboard over USB or Bluetooth LE.** USB is used when a computer has set the keypad up; otherwise it advertises over BLE as *Macro Keypad*.
- **Pages of keys.** Place keys freely or arrange them in a grid, in portrait or landscape (four orientations).
- **Keycaps.**
  - Styles: flat, 3D, glass, outline, neon or picture.
  - Labels in any font, language or emoji, with adjustable text transparency.
- **Icons.** A searchable table of 1,854 free [Lucide](https://lucide.dev) icons, placed above the label, to its left, or alone.
- **Pictures.**
  - A picture per key (drag a photo onto a key in the studio).
  - One picture spread across all keys of a page.
  - Picture or gradient backgrounds.
- **Apply to all.** Copy text and icon style, or keycap and picture layout, to the whole page or every page.
- **Macros.** Shortcuts, text and pauses, plus **recording** of real keystrokes, either tidied up or replayed with exact timing.
- **Effects.**
  - Press motion: push, pop, sink or bounce.
  - Light: glow, ripple, flash or outline.
  - Idle ambience: breathe, rainbow or wave.
  - Brightness and automatic dimming.
- **Click sound on the PC's speakers.** Built-in sounds or your own, set per key.
- **One-click firmware updates** from the studio over USB, installed in place (OTA) with no BOOT button.
- **Unsaved-changes indicator.** The Save button shows an orange dot until the keypad has your exact design.
- **Light / dark mode** button on every page (Auto follows the system), and a user guide in **English and Thai**.

## Hardware

| | |
|---|---|
| Board | Guition JC3248W535C (also sold as JC3248W535EN), ESP32-S3, 16 MB flash, 8 MB PSRAM |
| Display / touch | 3.5" IPS 320×480, AXS15231B over QSPI · capacitive touch on I2C 0x3B |
| USB | Native USB-C. The firmware runs TinyUSB, so the keypad appears as a HID keyboard plus a CDC serial port |
| Not used | microSD, speaker amp, spare GPIO headers. There is **no** gyro or accelerometer |

Pin map and research notes: [`docs/hardware-notes.md`](docs/hardware-notes.md).

## Quick start (no tools needed)

1. Plug the board into a computer with a USB-C **data** cable.
2. Open the [Firmware page](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev/flasher.html) in **Chrome or Edge**.
3. Click **Install firmware** and pick **USB JTAG/serial debug unit**.
   - If you see "Failed to initialize": unplug, hold **BOOT**, plug in, release BOOT, and try again.
4. Open the [studio](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev), click **USB**, design your keys, then click **Save to keypad**.
5. Later updates: in the studio, open the **Keypad** tab → **Firmware** → **Update**. The keypad restarts by itself.

The [user guide](https://touch-macro-keypad-jc3248w535c.sirisak-anotai.workers.dev/guide.html) covers everything step by step, including troubleshooting.

> **Mac users:** shortcuts use **Win/Cmd**, not Ctrl. **Text macros** type with the US keyboard layout and plain ASCII; labels can use any language.

## Repository layout

| Path | What |
|---|---|
| `firmware/` | PlatformIO project (pioarduino, Arduino-ESP32 3.x) |
| `firmware/src/display.*` | Panel and touch, software rotation for landscape |
| `firmware/src/gfx2d.*` | Small anti-aliased renderer: rounded rects, glows, rings, scaled alpha blits |
| `firmware/src/ui.*` | Pages, keys, animations, status and page bars; touch on its own task |
| `firmware/src/hid_out.*` | USB HID (TinyUSB) or BLE HID (NimBLE) plus the BLE config channel |
| `firmware/src/macro.*` | Macro runner (combos, text, pauses, raw key down/up) |
| `firmware/src/proto.*` | Line-JSON protocol: files, apply, run, OTA update, reboot |
| `firmware/src/config.*` | `/config.json` parser and built-in default layout |
| `web/public/` | The studio: static ES modules, no build step. `guide.html` (English), `guide-th.html` (Thai), `flasher.html` and `theme.js` (light/dark) live here too |
| `web/public/icons/lucide.json` | Generated icon data (`npm run icons`) |
| `web/public/fw/` | Committed firmware build plus ESP Web Tools manifest, served to the flasher and the studio |
| `web/src/worker.js` | Cloudflare Worker: serves the assets plus `/api/version` |
| `web/test/` | Node unit tests |
| `scripts/build-firmware.sh` | Builds the firmware only when its sources changed |
| `scripts/gen-icons.mjs` | Regenerates the icon table from `lucide-static` |
| `docs/` | Spec page and hardware notes |

## How it works

```
 Studio (Chrome/Edge) ── Web Serial (USB CDC) or Web Bluetooth (NUS) ── line JSON ──► Keypad firmware
   designs keys, renders keycaps                                                       draws screen, runs macros
   into images, plays click sound  ◄── {"ev":"press"} events ──────────────────────    USB HID / BLE HID ──► computer types
 Cloudflare Worker serves the studio, guide, firmware files and /api/version (deployed commit)
```

- **The studio renders every keycap** (style, label, font, icon, picture) into an image (`img/<hash>.565`, RGB565 plus alpha). It sends those images with `config.json` and `project.json`, so the keypad shows exactly the preview.
- **Protocol** (`firmware/src/proto.h`): `hello`, `ls`, `read`, `wbegin`/`wchunk`/`wend` (CRC-checked files), `rm`, `apply`, `run`, `page`, `bright`, `ota_begin`/`ota_chunk`/`ota_end` (firmware update), `bootloader`, `reboot`.
- **Flash layout:** two 3 MB app slots (OTA) plus 9.9 MB LittleFS for config, design and pictures.

## Develop

**Firmware.** Build and flash locally with PlatformIO:

```bash
cd firmware
pio run -t upload --upload-port $(ls /dev/cu.usbmodem* | head -1)   # macOS
pio device monitor
```

The firmware uses `ARDUINO_USB_MODE=0` (TinyUSB) so it can be a keyboard. If an upload doesn't start, hold BOOT while plugging in.

**Studio:**

```bash
npm install
npm test             # keymap parity with firmware, schema, recorder, protocol/CRC, OTA, serial, icons
npx wrangler dev     # local Worker at http://localhost:8787
```

**Releasing new firmware:**
1. Bump `FW_VERSION` in `firmware/platformio.ini`.
2. Run `npm run build`. It compiles and refreshes `web/public/fw/` with the binary and a manifest containing a source hash.
3. Commit `web/public/fw/` together with the source change. Cloudflare then reuses the committed build instead of compiling.
4. Users get **Update to x.y.z** in the studio.

## Deploy (Cloudflare Workers Builds)

Connected once in the Cloudflare dashboard (Workers & Pages → the Worker → Settings → Builds):

| Setting | Value |
|---|---|
| Build command | `npm run build` (skips PlatformIO when `web/public/fw/` matches the firmware sources, about 35 s per deploy) |
| Deploy command | `npm run deploy:ci` |
| Root directory | `/` |

Optional build variables:
- `FORCE_FIRMWARE=1` always recompiles the firmware (about 6 min).
- `SKIP_FIRMWARE=1` never compiles it.

The deployed commit shows next to the studio title ("build abc1234").

## Version history

| Firmware | Highlights |
|---|---|
| 1.0.0 | First release: USB/BLE keyboard, canvas renderer, effects, config protocol |
| 1.1.0 | Touch on its own task; cached base frame for faster drawing |
| 1.2.0 | Version shown on the startup screen and by holding the top bar |
| 1.3.0 | One-click updates from the studio (two app slots); storage moved and formatted once |
| 1.3.1 | Version in the keypad's top bar |
| 1.3.2 | Fixed "crc mismatch" when saving or updating |
| 1.3.3 | Fixed taps being swallowed as wake-ups (timer race) |
| 1.3.4 | Fixed "Typing via NONE": USB readiness now read directly |
| 1.4.0 | Landscape and upside-down screen orientations |

Studio-only additions, which need no firmware update:
- picture across keys and drag-and-drop pictures
- text transparency
- apply-to-all
- the icon table
- the unsaved-changes dot
- the user guide

## Credits & licences

- Icons: [Lucide](https://lucide.dev), ISC License (licence text embedded in `web/public/icons/lucide.json`).
- [Arduino_GFX](https://github.com/moononournation/Arduino_GFX), [NimBLE-Arduino](https://github.com/h2zero/NimBLE-Arduino), [ArduinoJson](https://arduinojson.org), Arduino-ESP32 / TinyUSB.
- [ESP Web Tools](https://esphome.github.io/esp-web-tools/) for the browser installer.
- Board bring-up based on the `esp32-s3-jc3248w535c` skill and [sirisakG2/JC3248W535C](https://github.com/sirisakG2/JC3248W535C).
