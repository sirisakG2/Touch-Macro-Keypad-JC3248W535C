#include "proto.h"
#include "config.h"
#include "hid_out.h"
#include "macro.h"
#include "ui.h"
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Update.h>
#include <esp32-hal-tinyusb.h>
#include <esp_rom_crc.h>
#include <mbedtls/base64.h>

enum Src : uint8_t { SRC_USB, SRC_BLE };

#define PROTO_LINE_MAX 12288
static char *lineBuf[2];
static size_t lineLen[2];

// Firmware update (OTA) state.
static bool otaActive = false;
static uint32_t otaSize = 0, otaDone = 0, otaCrc = 0;
static int otaPct = -1;

// One upload at a time.
static File upFile;
static String upName;
static uint32_t upSize = 0, upDone = 0, upCrc = 0;

static void sendLine(Src s, const String &line) {
  if (s == SRC_USB) {
    if (Serial) { Serial.print(line); Serial.print('\n'); }
  } else {
    String l = line + "\n";
    bleTxWrite(l.c_str(), l.length());
  }
}

void protoEvent(const char *json) {
  if (Serial) { Serial.print(json); Serial.print('\n'); }
  if (bleConfigConnected()) { String l = String(json) + "\n"; bleTxWrite(l.c_str(), l.length()); }
}

// Only "/name" or "/img/name" with [A-Za-z0-9_.-] characters.
static bool safePath(const char *in, String &out) {
  String p = in ? in : "";
  if (!p.startsWith("/")) p = "/" + p;
  if (p.length() < 2 || p.length() > 48 || p.indexOf("..") >= 0) return false;
  int slashes = 0;
  for (size_t i = 0; i < p.length(); i++) {
    char c = p[i];
    if (c == '/') { slashes++; continue; }
    if (!isalnum((unsigned char)c) && c != '_' && c != '.' && c != '-') return false;
  }
  if (slashes > 2 || (slashes == 2 && !p.startsWith("/img/"))) return false;
  out = p;
  return true;
}

static void listDir(const char *dir, JsonArray arr) {
  File d = LittleFS.open(dir);
  if (!d || !d.isDirectory()) return;
  for (File f = d.openNextFile(); f; f = d.openNextFile()) {
    if (f.isDirectory()) continue;
    JsonObject o = arr.add<JsonObject>();
    String n = String(dir) == "/" ? String("/") + f.name() : String(dir) + "/" + f.name();
    o["n"] = n;
    o["s"] = f.size();
  }
}

static String applyConfig() {
  File f = LittleFS.open("/config.json", "r");
  if (!f) return "no /config.json";
  size_t n = f.size();
  if (n > CONFIG_MAX_BYTES) { f.close(); return "config too big"; }
  char *buf = (char *)ps_malloc(n + 1);
  if (!buf) { f.close(); return "out of memory"; }
  f.readBytes(buf, n);
  f.close();
  buf[n] = 0;
  Config c;
  String err = parseConfig(buf, n, c);
  free(buf);
  if (err.length()) return err;
  uiApplyConfig(c);
  return "";
}

static void handle(Src src, char *line, size_t len) {
  JsonDocument req;
  if (deserializeJson(req, line, len)) return;     // ignore noise
  JsonDocument res;
  res["id"] = req["id"];
  const char *cmd = req["cmd"] | "";
  String err;

  if (!strcmp(cmd, "hello")) {
    res["fw"] = FW_VERSION;
    res["board"] = "JC3248W535C";
    Link l = hidLink();
    res["link"] = l == LINK_USB ? "usb" : (l == LINK_BLE ? "ble" : "none");
    BleState b = hidBleState();
    res["ble"] = b == BLE_CONN ? "conn" : (b == BLE_ADV ? "adv" : "off");
    res["via"] = src == SRC_USB ? "usb" : "ble";
    res["fsTotal"] = LittleFS.totalBytes();
    res["fsUsed"] = LittleFS.usedBytes();
    res["page"] = uiPage();
    res["frameMs"] = (int)(uiFrameMs() + .5f);
    res["heap"] = ESP.getFreeHeap();
    res["psram"] = ESP.getFreePsram();
    res["w"] = 320; res["h"] = 480; res["statusH"] = STATUS_H; res["navH"] = NAV_H;
  } else if (!strcmp(cmd, "ls")) {
    JsonArray arr = res["files"].to<JsonArray>();
    listDir("/", arr);
    listDir("/img", arr);
  } else if (!strcmp(cmd, "read")) {
    String p;
    if (!safePath(req["name"], p)) err = "bad name";
    else {
      File f = LittleFS.open(p, "r");
      if (!f) err = "not found";
      else {
        uint32_t off = req["off"] | 0, want = min<uint32_t>(req["len"] | 2048, 4096);
        res["size"] = f.size();
        static uint8_t buf[4096];
        f.seek(off);
        size_t n = f.read(buf, want);
        f.close();
        size_t olen = 0;
        static unsigned char b64[5600];
        mbedtls_base64_encode(b64, sizeof(b64), &olen, buf, n);
        b64[olen] = 0;
        res["data"] = (const char *)b64;
        res["n"] = n;
      }
    }
  } else if (!strcmp(cmd, "wbegin")) {
    String p;
    uint32_t size = req["size"] | 0;
    if (!safePath(req["name"], p)) err = "bad name";
    else if (size > LittleFS.totalBytes() - LittleFS.usedBytes()) err = "no space";
    else {
      if (upFile) upFile.close();
      if (p.startsWith("/img/")) LittleFS.mkdir("/img");
      upName = p;
      upFile = LittleFS.open(p + ".tmp", "w");
      upSize = size; upDone = 0; upCrc = 0;
      if (!upFile) err = "open failed";
    }
  } else if (!strcmp(cmd, "wchunk")) {
    const char *data = req["data"] | "";
    uint32_t off = req["off"] | 0;
    if (!upFile) err = "no upload";
    else if (off != upDone) err = "offset " + String(upDone);
    else {
      static unsigned char bin[8192];
      size_t olen = 0;
      if (mbedtls_base64_decode(bin, sizeof(bin), &olen, (const unsigned char *)data, strlen(data))) err = "base64";
      else if (upFile.write(bin, olen) != olen) err = "write failed (full?)";
      else { upDone += olen; upCrc = esp_rom_crc32_le(upCrc, bin, olen); res["done"] = upDone; }
    }
  } else if (!strcmp(cmd, "wend")) {
    if (!upFile) err = "no upload";
    else {
      upFile.close();
      uint32_t crc = req["crc"] | 0;
      if (upDone != upSize) err = "size mismatch";
      else if (crc != upCrc) err = "crc mismatch";
      if (err.length()) LittleFS.remove(upName + ".tmp");
      else {
        LittleFS.remove(upName);
        if (!LittleFS.rename(upName + ".tmp", upName)) err = "rename failed";
      }
    }
  } else if (!strcmp(cmd, "rm")) {
    String p;
    if (!safePath(req["name"], p)) err = "bad name";
    else if (!LittleFS.remove(p)) err = "not found";
  } else if (!strcmp(cmd, "apply")) {
    err = applyConfig();
    if (!err.length()) uiMessage("Saved");
  } else if (!strcmp(cmd, "run")) {
    std::vector<Action> acts;
    if (req["actions"].is<JsonArray>()) {
      JsonDocument tmp;
      tmp["v"] = 1;
      JsonObject pg = tmp["pages"].add<JsonObject>();
      JsonObject k = pg["keys"].add<JsonObject>();
      k["actions"] = req["actions"];
      String json;
      serializeJson(tmp, json);
      Config c;
      err = parseConfig(json.c_str(), json.length(), c);
      if (!err.length()) acts = c.pages[0].keys[0].actions;
    } else {
      int p = req["p"] | -1, k = req["k"] | -1;
      if (p < 0 || p >= (int)cfg.pages.size() || k < 0 || k >= (int)cfg.pages[p].keys.size()) err = "bad key";
      else acts = cfg.pages[p].keys[k].actions;
    }
    if (!err.length() && !macroRun(acts)) err = "busy";
  } else if (!strcmp(cmd, "page")) {
    uiSetPage(req["p"] | 0);
  } else if (!strcmp(cmd, "bright")) {
    uiBrightnessPreview(req["v"] | -1);
  } else if (!strncmp(cmd, "ota_", 4) && src != SRC_USB) {
    err = "connect over USB to update the firmware";
  } else if (!strcmp(cmd, "ota_begin")) {
    uint32_t size = req["size"] | 0;
    if (otaActive) Update.abort();
    otaActive = false;
    if (!size) err = "size missing";
    else if (!Update.begin(size, U_FLASH)) err = String("begin: ") + Update.errorString();
    else {
      otaActive = true; otaSize = size; otaDone = 0; otaCrc = 0; otaPct = 0;
      uiMessage("Updating 0%");
    }
  } else if (!strcmp(cmd, "ota_chunk")) {
    const char *data = req["data"] | "";
    uint32_t off = req["off"] | 0;
    if (!otaActive) err = "no update running";
    else if (off != otaDone) err = "offset " + String(otaDone);
    else {
      static unsigned char bin[8192];
      size_t olen = 0;
      if (mbedtls_base64_decode(bin, sizeof(bin), &olen, (const unsigned char *)data, strlen(data))) err = "base64";
      else if (Update.write(bin, olen) != olen) err = String("write: ") + Update.errorString();
      else {
        otaDone += olen;
        otaCrc = esp_rom_crc32_le(otaCrc, bin, olen);
        res["done"] = otaDone;
        int pct = (int)((uint64_t)otaDone * 100 / otaSize);
        if (pct / 5 != otaPct / 5) {
          otaPct = pct;
          static char msg[24];
          snprintf(msg, sizeof(msg), "Updating %d%%", pct);
          uiMessage(msg);
        }
      }
    }
    if (err.length() && otaActive) { Update.abort(); otaActive = false; uiMessage("Update failed"); }
  } else if (!strcmp(cmd, "ota_end")) {
    uint32_t crc = req["crc"] | 0;
    if (!otaActive) err = "no update running";
    else if (otaDone != otaSize) err = "size mismatch";
    else if (crc != otaCrc) err = "crc mismatch";
    else if (!Update.end(true)) err = String("verify: ") + Update.errorString();   // checks image + SHA-256
    if (err.length()) {
      if (otaActive) Update.abort();
      otaActive = false;
      uiMessage("Update failed");
    } else {
      otaActive = false;
      uiMessage("Restarting...");
      sendLine(src, String("{\"id\":") + (int)(req["id"] | 0) + ",\"ok\":true}");
      Serial.flush();
      delay(400);
      ESP.restart();
      return;
    }
  } else if (!strcmp(cmd, "bootloader")) {
    sendLine(src, String("{\"id\":") + (int)(req["id"] | 0) + ",\"ok\":true}");
    delay(200);
    usb_persist_restart(RESTART_BOOTLOADER);   // re-enumerates as the ROM USB-Serial/JTAG downloader
    return;
  } else if (!strcmp(cmd, "reboot")) {
    sendLine(src, String("{\"id\":") + (int)(req["id"] | 0) + ",\"ok\":true}");
    delay(200);
    ESP.restart();
  } else {
    err = String("unknown cmd ") + cmd;
  }

  res["ok"] = err.length() == 0;
  if (err.length()) res["err"] = err;
  String out;
  serializeJson(res, out);
  sendLine(src, out);
}

static void feed(Src s, const char *data, size_t n) {
  char *buf = lineBuf[s];
  size_t &len = lineLen[s];
  for (size_t i = 0; i < n; i++) {
    char c = data[i];
    if (c == '\n' || c == '\r') {
      if (len) { buf[len] = 0; handle(s, buf, len); len = 0; }
    } else if (len < PROTO_LINE_MAX - 1) {
      buf[len++] = c;
    } else {
      len = 0;   // overlong line: drop it
    }
  }
}

void protoBegin() {
  for (int i = 0; i < 2; i++) { lineBuf[i] = (char *)ps_malloc(PROTO_LINE_MAX); lineLen[i] = 0; }
}

void protoLoop() {
  char tmp[512];
  int guard = 0;
  while (Serial.available() && guard++ < 64) {
    size_t n = Serial.read((uint8_t *)tmp, min((int)sizeof(tmp), Serial.available()));
    feed(SRC_USB, tmp, n);
  }
  size_t n;
  guard = 0;
  while ((n = bleRxRead(tmp, sizeof(tmp))) > 0 && guard++ < 64) feed(SRC_BLE, tmp, n);
}
