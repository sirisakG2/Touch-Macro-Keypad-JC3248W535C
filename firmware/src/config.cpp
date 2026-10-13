#include "config.h"
#include "keymap.h"
#include <ArduinoJson.h>
#include <LittleFS.h>

Config cfg;

static const char DEFAULT_CONFIG[] PROGMEM = R"JSON({
"v":1,"name":"Macro Keypad","brightness":80,"statusBar":true,
"dim":{"after":120,"level":10},"idle":{"effect":"breathe","after":20,"color":"#00a6ff","speed":40},
"pages":[
 {"name":"Edit","bg":{"color":"#0b1020","color2":"#1d2550"},"keys":[
  {"x":10,"y":32,"w":96,"h":90,"label":"Copy","color":"#2f6fed","actions":[{"t":"combo","mods":["ctrl"],"key":"c"}]},
  {"x":112,"y":32,"w":96,"h":90,"label":"Paste","color":"#2f6fed","actions":[{"t":"combo","mods":["ctrl"],"key":"v"}]},
  {"x":214,"y":32,"w":96,"h":90,"label":"Cut","color":"#2f6fed","actions":[{"t":"combo","mods":["ctrl"],"key":"x"}]},
  {"x":10,"y":128,"w":96,"h":90,"label":"Undo","color":"#7a3cf0","actions":[{"t":"combo","mods":["ctrl"],"key":"z"}]},
  {"x":112,"y":128,"w":96,"h":90,"label":"Redo","color":"#7a3cf0","actions":[{"t":"combo","mods":["ctrl"],"key":"y"}]},
  {"x":214,"y":128,"w":96,"h":90,"label":"Save","color":"#12a150","actions":[{"t":"combo","mods":["ctrl"],"key":"s"}]},
  {"x":10,"y":224,"w":96,"h":90,"label":"Find","color":"#d97706","actions":[{"t":"combo","mods":["ctrl"],"key":"f"}]},
  {"x":112,"y":224,"w":96,"h":90,"label":"All","color":"#d97706","actions":[{"t":"combo","mods":["ctrl"],"key":"a"}]},
  {"x":214,"y":224,"w":96,"h":90,"label":"Hello","color":"#db2777","light":"ripple","actions":[{"t":"text","s":"Hello from my keypad!"}]},
  {"x":10,"y":320,"w":96,"h":90,"label":"Desk","color":"#334155","actions":[{"t":"combo","mods":["gui"],"key":"d"}]},
  {"x":112,"y":320,"w":96,"h":90,"label":"Lock","color":"#334155","actions":[{"t":"combo","mods":["gui"],"key":"l"}]},
  {"x":214,"y":320,"w":96,"h":90,"label":"Tab","color":"#334155","actions":[{"t":"combo","mods":["alt"],"key":"tab"}]}
 ]},
 {"name":"Nav","bg":{"color":"#101010","color2":"#203020"},"keys":[
  {"x":112,"y":60,"w":96,"h":90,"label":"Up","color":"#15803d","actions":[{"t":"combo","key":"up"}]},
  {"x":10,"y":156,"w":96,"h":90,"label":"Left","color":"#15803d","actions":[{"t":"combo","key":"left"}]},
  {"x":112,"y":156,"w":96,"h":90,"label":"Down","color":"#15803d","actions":[{"t":"combo","key":"down"}]},
  {"x":214,"y":156,"w":96,"h":90,"label":"Right","color":"#15803d","actions":[{"t":"combo","key":"right"}]},
  {"x":10,"y":300,"w":145,"h":90,"label":"PgUp","color":"#0f766e","actions":[{"t":"combo","key":"pageup"}]},
  {"x":165,"y":300,"w":145,"h":90,"label":"PgDn","color":"#0f766e","actions":[{"t":"combo","key":"pagedown"}]}
 ]}
]})JSON";

uint16_t hexTo565(const char *hex, uint16_t fallback) {
  if (!hex || hex[0] != '#' || strlen(hex) < 7) return fallback;
  char *end;
  uint32_t v = strtoul(hex + 1, &end, 16);
  if (end != hex + 7) return fallback;
  uint8_t r = v >> 16, g = (v >> 8) & 0xFF, b = v & 0xFF;
  return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3);
}

static Motion parseMotion(const char *s) {
  if (!s) return MO_PUSH;
  if (!strcmp(s, "none")) return MO_NONE;
  if (!strcmp(s, "pop")) return MO_POP;
  if (!strcmp(s, "sink")) return MO_SINK;
  if (!strcmp(s, "bounce")) return MO_BOUNCE;
  return MO_PUSH;
}

static Light parseLight(const char *s) {
  if (!s) return LI_GLOW;
  if (!strcmp(s, "none")) return LI_NONE;
  if (!strcmp(s, "ripple")) return LI_RIPPLE;
  if (!strcmp(s, "flash")) return LI_FLASH;
  if (!strcmp(s, "outline")) return LI_OUTLINE;
  return LI_GLOW;
}

static Idle parseIdle(const char *s) {
  if (!s) return ID_BREATHE;
  if (!strcmp(s, "none")) return ID_NONE;
  if (!strcmp(s, "rainbow")) return ID_RAINBOW;
  if (!strcmp(s, "wave")) return ID_WAVE;
  return ID_BREATHE;
}

static String parseAction(JsonObjectConst a, Action &out) {
  const char *t = a["t"] | "";
  if (!strcmp(t, "combo")) {
    out.t = ACT_COMBO;
    for (JsonVariantConst m : a["mods"].as<JsonArrayConst>()) {
      uint8_t b = modBit(m.as<const char *>());
      if (!b) return String("unknown modifier ") + (m.as<const char *>() ? m.as<const char *>() : "?");
      out.mods |= b;
    }
    const char *k = a["key"] | "";
    if (*k) {
      out.key = keyUsage(k);
      if (!out.key) return String("unknown key ") + k;
    }
    if (!out.mods && !out.key) return "empty combo";
  } else if (!strcmp(t, "text")) {
    out.t = ACT_TEXT;
    out.text = a["s"] | "";
    if (out.text.length() > MAX_TEXT) return "text too long";
  } else if (!strcmp(t, "delay")) {
    out.t = ACT_DELAY;
    out.ms = min<uint32_t>(a["ms"] | 0, MAX_DELAY_MS);
  } else if (!strcmp(t, "down") || !strcmp(t, "up")) {
    out.t = !strcmp(t, "down") ? ACT_DOWN : ACT_UP;
    out.key = keyUsage(a["key"] | "");
    if (!out.key) return String("unknown key ") + (a["key"] | "?");
  } else {
    return String("unknown action ") + t;
  }
  return "";
}

String parseConfig(const char *json, size_t len, Config &out) {
  JsonDocument doc;
  DeserializationError e = deserializeJson(doc, json, len);
  if (e) return String("json: ") + e.c_str();
  out = Config();
  out.name = doc["name"] | "Macro Keypad";
  out.brightness = constrain(doc["brightness"] | 80, 5, 100);
  out.statusBar = doc["statusBar"] | true;
  out.dimAfter = doc["dim"]["after"] | 120;
  out.dimLevel = constrain(doc["dim"]["level"] | 10, 0, 100);
  out.idle = parseIdle(doc["idle"]["effect"] | "breathe");
  out.idleAfter = max(1, (int)(doc["idle"]["after"] | 20));
  out.idleColor = hexTo565(doc["idle"]["color"] | "", 0x055F);
  out.idleSpeed = constrain(doc["idle"]["speed"] | 40, 1, 100);

  JsonArrayConst pages = doc["pages"].as<JsonArrayConst>();
  if (pages.size() == 0) return "no pages";
  if (pages.size() > MAX_PAGES) return "too many pages";
  for (JsonObjectConst p : pages) {
    PageDef pd;
    pd.name = p["name"] | "Page";
    pd.bg = hexTo565(p["bg"]["color"] | "", 0x0841);
    const char *c2 = p["bg"]["color2"] | "";
    pd.gradient = *c2 != 0;
    pd.bg2 = hexTo565(c2, pd.bg);
    pd.bgImg = p["bg"]["img"] | "";
    JsonArrayConst keys = p["keys"].as<JsonArrayConst>();
    if (keys.size() > MAX_KEYS) return "too many keys on page " + pd.name;
    for (JsonObjectConst k : keys) {
      KeyDef kd;
      kd.x = k["x"] | 0; kd.y = k["y"] | 0;
      kd.w = constrain(k["w"] | 80, 8, 320); kd.h = constrain(k["h"] | 80, 8, 480);
      kd.r = constrain(k["r"] | 12, 0, 80);
      kd.color = hexTo565(k["color"] | "", 0x2945);
      kd.textColor = hexTo565(k["text"] | "", 0xFFFF);
      kd.fxColor = hexTo565(k["fx"] | "", 0x07FF);
      kd.fontSize = constrain(k["fs"] | 2, 1, 6);
      kd.label = k["label"] | "";
      kd.img = k["img"] | "";
      kd.motion = parseMotion(k["motion"] | "push");
      kd.light = parseLight(k["light"] | "glow");
      kd.fxMs = constrain(k["ms"] | 260, 60, 2000);
      JsonArrayConst acts = k["actions"].as<JsonArrayConst>();
      if (acts.size() > MAX_ACTIONS) return "too many actions on key " + kd.label;
      for (JsonObjectConst a : acts) {
        Action act;
        String err = parseAction(a, act);
        if (err.length()) return "key '" + kd.label + "': " + err;
        kd.actions.push_back(act);
      }
      pd.keys.push_back(kd);
    }
    out.pages.push_back(pd);
  }
  return "";
}

String loadConfig() {
  String err = "no /config.json";
  File f = LittleFS.open("/config.json", "r");
  if (f && f.size() > 0 && f.size() <= CONFIG_MAX_BYTES) {
    size_t n = f.size();
    char *buf = (char *)ps_malloc(n + 1);
    if (buf) {
      f.readBytes(buf, n);
      buf[n] = 0;
      Config c;
      err = parseConfig(buf, n, c);
      free(buf);
      if (!err.length()) { cfg = c; f.close(); return ""; }
    }
  }
  if (f) f.close();
  parseConfig(DEFAULT_CONFIG, strlen(DEFAULT_CONFIG), cfg);
  return err;
}
