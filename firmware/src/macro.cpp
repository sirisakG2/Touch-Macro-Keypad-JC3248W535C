#include "macro.h"
#include "hid_out.h"
#include "keymap.h"

static QueueHandle_t jobs;
static volatile bool busy = false;

// Live report state for raw down/up actions.
static uint8_t curMods = 0;
static uint8_t curKeys[6] = {0};

static const uint32_t KEY_GAP_MS = 8;

static void sendNow() { hidSend(curMods, curKeys); }

static void releaseAll() {
  curMods = 0;
  memset(curKeys, 0, sizeof(curKeys));
  sendNow();
}

static void keyDown(uint8_t usage) {
  if (usage >= 0xE0 && usage <= 0xE7) { curMods |= 1 << (usage - 0xE0); sendNow(); return; }
  for (uint8_t &k : curKeys) if (k == usage) return;
  for (uint8_t &k : curKeys) if (!k) { k = usage; sendNow(); return; }
}

static void keyUp(uint8_t usage) {
  if (usage >= 0xE0 && usage <= 0xE7) { curMods &= ~(1 << (usage - 0xE0)); sendNow(); return; }
  for (uint8_t &k : curKeys) if (k == usage) k = 0;
  sendNow();
}

static void tap(uint8_t mods, uint8_t usage) {
  uint8_t keys[6] = {usage, 0, 0, 0, 0, 0};
  hidSend(mods | curMods, keys);
  delay(KEY_GAP_MS);
  hidSend(curMods, curKeys);
  delay(KEY_GAP_MS);
}

static void runOne(const Action &a) {
  switch (a.t) {
    case ACT_COMBO:
      if (a.mods) { uint8_t none[6] = {0}; hidSend(a.mods | curMods, none); delay(KEY_GAP_MS); }
      tap(a.mods, a.key);
      break;
    case ACT_TEXT: {
      char prev = 0;
      for (size_t i = 0; i < a.text.length(); i++) {
        char c = a.text[i];
        uint8_t u; bool shift;
        if (!asciiToKey(c, u, shift)) continue;
        if (c == prev) { hidSend(curMods, curKeys); delay(KEY_GAP_MS); }   // repeated char needs a release
        tap(shift ? MOD_LSHIFT : 0, u);
        prev = c;
      }
      break;
    }
    case ACT_DELAY: delay(a.ms); break;
    case ACT_DOWN: keyDown(a.key); delay(2); break;
    case ACT_UP: keyUp(a.key); delay(2); break;
  }
}

static void macroTask(void *) {
  std::vector<Action> *job;
  for (;;) {
    if (xQueueReceive(jobs, &job, portMAX_DELAY) != pdTRUE) continue;
    busy = true;
    for (const Action &a : *job) runOne(a);
    releaseAll();   // never leave keys stuck
    delete job;
    busy = false;
  }
}

void macroBegin() {
  jobs = xQueueCreate(8, sizeof(std::vector<Action> *));
  xTaskCreatePinnedToCore(macroTask, "macro", 6144, nullptr, 2, nullptr, 0);
}

bool macroRun(const std::vector<Action> &acts) {
  if (acts.empty()) return true;
  auto *job = new std::vector<Action>(acts);
  if (xQueueSend(jobs, &job, 0) != pdTRUE) { delete job; return false; }
  return true;
}

bool macroBusy() { return busy || uxQueueMessagesWaiting(jobs) > 0; }
