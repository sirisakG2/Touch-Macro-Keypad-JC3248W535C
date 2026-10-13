# JC3248W535C hardware notes (vendor/community code vs. the esp32-s3-jc3248w535c skill)

Before writing the firmware I compared the board's original/community demo code with the skill's verified settings.

| Topic | Vendor / community code | Skill (verified on a board) | Used here |
|---|---|---|---|
| Display bus | QSPI CS 45, SCK 47, D0-D3 21/48/40/39 ([byte-me404/JC3248W535_lvgl_test](https://github.com/byte-me404/JC3248W535_lvgl_test) `pincfg.h`) | same | same |
| Backlight | GPIO 1 | GPIO 1 | GPIO 1, LEDC PWM 5 kHz for brightness/dimming |
| Panel driver | `Arduino_AXS15231B` + `Arduino_Canvas`, `begin(40000000)` | same, "always draw through a canvas" | same |
| Refresh mode | AXS15231B only works with **full-frame refresh**; LVGL partial/direct modes break ([atomic14](https://www.atomic14.com/esp32/boards/guition-jc3248w535/), [LVGL forum](https://forum.lvgl.io/t/jc3248w535-axs15231b-driver/18707)) | canvas + whole-frame `flush()`, throttled to ≥ 30 ms | whole-frame compose + flush, only while something changes |
| Rotation | no hardware rotation; software only | portrait only | portrait 320×480 |
| Touch | I2C 0x3B, SDA 4, SCL 8, **INT GPIO 3**, read cmd `B5 AB A5 5A 00 00 00 08` | same (polled, no INT) | polled like the skill; INT pin unused |
| Touch calibration | community code maps raw X 12…310 → 0…319 and Y 14…461 → 0…479 | "coordinates already match, no calibration" | none (skill); if edge keys feel off on your unit, this mapping is the first thing to try |
| Vendor demo stack | `esp_bsp.h` + LVGL 8.4.0 on Arduino-ESP32 3.2.1 (per [done.land](https://done.land/components/microcontroller/families/esp/esp32/developmentboards/esp32-s3/guitionjc3248w535/)); Espressif also ships [`esp_lcd_axs15231b`](https://components.espressif.com/components/espressif/esp_lcd_axs15231b) | pioarduino (Arduino core 3.x), GFX Library for Arduino | pioarduino + GFX Library v1.6.9 (no LVGL - the keypad uses its own small renderer) |
| USB | native USB on GPIO 19/20 (no UART bridge) | `ARDUINO_USB_MODE=1` (USB-Serial/JTAG) | **`ARDUINO_USB_MODE=0`** (TinyUSB) so the board can be a HID keyboard + CDC serial |

Differences worth knowing:

- **USB mode.** With TinyUSB the board no longer appears as `USB JTAG/serial debug unit` while the keypad runs. `pio run -t upload` still works through the CDC 1200-baud reset; if it doesn't, hold BOOT, tap RESET, release BOOT. The studio's *Restart into firmware update mode* button does the same thing from the browser.
- **Touch INT (GPIO 3)** is not in the skill. Polling works (skill-verified), so it is not used.

## Learned on the real board

- **USB starts before `setup()`.** With `ARDUINO_USB_CDC_ON_BOOT=1` the core calls `USB.begin()` before `setup()`, so `ARDUINO_USB_STARTED_EVENT` fires before a handler registered in `setup()` can see it. Read the state directly instead: `(bool)USB && !tud_suspended()` (fixed in 1.3.4).
- **Browser installer and TinyUSB.** While the keypad firmware runs, the board shows up as *Touch Macro Keypad* (TinyUSB), and ESP Web Tools cannot reset it into the ROM loader ("Failed to initialize"). Either hold BOOT while plugging in, send the `bootloader` command (`usb_persist_restart(RESTART_BOOTLOADER)`), or, from 1.3.0, update in place over the app's own serial link (OTA, two app slots).
- **Installer stuck at "wrapping up".** After flashing, the device re-enumerates as a different USB device, so ESP Web Tools waits forever. `new_install_improv_wait_time: 0` in the manifest avoids it.
- **No gyro or accelerometer** on this board, so screen orientation is a setting. Rotation is done in software because the AXS15231B is portrait-only.
- **Multiple FreeRTOS tasks and `millis()`.** A timestamp written by another task can be newer than the reader's `now`; `now - t` must be clamped (bug fixed in 1.3.3).
