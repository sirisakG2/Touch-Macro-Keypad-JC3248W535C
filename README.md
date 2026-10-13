# Touch Macro Keypad - JC3248W535C

A touchscreen macro keypad on the Guition **JC3248W535C** (ESP32-S3, 3.5" 320×480 capacitive touch), plus **Macro Keypad Studio**, a browser app on Cloudflare Workers where you design everything:

- **Layouts.** Pages of keys you place freely, or arrange as a grid.
- **Keycaps.** Six styles (flat, 3D, glass, outline, neon, picture) with any font and emoji, plus your own pictures.
- **Backgrounds.** A colour, a gradient or a picture for each page.
- **Press motion.** Push, pop, sink, bounce or none.
- **Light.** Glow, ripple, flash, outline, plus an idle ambient light (breathe, rainbow or wave).
- **Click sound on the PC's speakers.** Six built-in sounds or your own, set for the whole keypad or for one key.
- **Macros.** Shortcuts, text and pauses, or **record** real keystrokes with their timing.

The keypad types over **USB** when a PC has enumerated it. Otherwise it types over **Bluetooth LE**.

> Full spec page: [`docs/index.html`](docs/index.html) · Hardware research: [`docs/hardware-notes.md`](docs/hardware-notes.md)

## How it fits together

```
 Browser (Chrome/Edge)                     Cloudflare Worker                 JC3248W535C
 ┌──────────────────────┐   https    ┌───────────────────────┐
 │ Macro Keypad Studio  │◄──────────│ web/public + fw/*.bin │
 │ design · macros · fx │            └───────────────────────┘
 │ click sound (WebAudio)│  Web Serial (USB CDC) or Web Bluetooth (NUS)   ┌──────────────────┐
 └──────────────────────┘◄──────────── line JSON protocol ─────────────► │ firmware         │
                          ◄── {"ev":"press"} → play click on PC speakers │ USB HID / BLE HID│──► PC types
                                                                          └──────────────────┘
```

- `firmware/` - PlatformIO project (pioarduino, Arduino core 3.x). It is based on the `esp32-s3-jc3248w535c` skill: the canvas display path, touch handling and pins all come from there.
- `web/public/` - the studio. It is static ES modules with no build step.
  - `web/src/worker.js` serves it.
  - `web/test/` holds the unit tests.
- `scripts/build-firmware.sh` - builds the firmware and puts `keypad-factory.bin` and the ESP Web Tools manifest in `web/public/fw/`, so the browser flasher always serves the matching firmware.

## Use it

1. Open the studio (your Worker URL), click **Firmware → Install firmware** and flash the board over USB-C.
2. In the studio, click **USB**, then pick the keypad.
3. Design your layout and macros, then click **Save to keypad**.
   - Over USB, Save sends everything, including pictures and keycap designs.
   - Over Bluetooth, Save sends only the layout and macros.
4. Plug the keypad into a PC and it types over USB. On a charger or battery it advertises over Bluetooth as **Macro Keypad**, so pair it like any keyboard.
5. Keep the studio open, or install it as an app from the address bar, to hear the click sound on the PC's speakers.

Text macros type with the **US keyboard layout**, and the device's fallback font is ASCII only. Keycap labels can use any language or emoji, because the studio renders them into images.

## Develop

**Firmware.** Build and flash locally, as the skill recommends:

```bash
cd firmware
pio run -t upload --upload-port $(ls /dev/cu.usbmodem* | head -1)   # macOS
pio device monitor
```

The firmware uses `ARDUINO_USB_MODE=0` (TinyUSB) so it can be a USB keyboard. If an upload doesn't start, hold BOOT, tap RESET, release BOOT and try again.

**Web app**

```bash
npm install
npm test               # unit tests (keymap parity with firmware, schema, recorder, protocol, image packer)
npx wrangler dev       # local Worker at http://localhost:8787
```

## Deploy (Cloudflare Workers Builds)

Every push to GitHub builds and deploys automatically. It does not use GitHub Actions. You set it up once in the dashboard:

1. Go to **dash.cloudflare.com → Workers & Pages → Create → Import a repository** and pick this repo.
2. Enter these settings:
   - **Build command:** `npm run build` (installs PlatformIO and compiles the firmware into `web/public/fw/`)
   - **Deploy command:** `npm run deploy:ci`
   - **Root directory:** `/`
   - **Branch:** `main`
3. Save. Each push now builds the firmware and redeploys the studio.

If the firmware build ever runs past Cloudflare's 20-minute build limit, add the build variable `SKIP_FIRMWARE=1`. The build then ships the firmware already committed in `web/public/fw/`. Refresh that copy with `npm run build` locally and commit it.
