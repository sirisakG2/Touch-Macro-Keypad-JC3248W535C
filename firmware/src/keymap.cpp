#include "keymap.h"
#include <string.h>

struct KeyName { const char *name; uint8_t usage; };

// KEYMAP-TABLE-BEGIN (parsed by web/test/keymap.test.js)
static const KeyName KEYS[] = {
  {"a",0x04},{"b",0x05},{"c",0x06},{"d",0x07},{"e",0x08},{"f",0x09},{"g",0x0A},{"h",0x0B},
  {"i",0x0C},{"j",0x0D},{"k",0x0E},{"l",0x0F},{"m",0x10},{"n",0x11},{"o",0x12},{"p",0x13},
  {"q",0x14},{"r",0x15},{"s",0x16},{"t",0x17},{"u",0x18},{"v",0x19},{"w",0x1A},{"x",0x1B},
  {"y",0x1C},{"z",0x1D},
  {"1",0x1E},{"2",0x1F},{"3",0x20},{"4",0x21},{"5",0x22},{"6",0x23},{"7",0x24},{"8",0x25},
  {"9",0x26},{"0",0x27},
  {"enter",0x28},{"esc",0x29},{"backspace",0x2A},{"tab",0x2B},{"space",0x2C},{"minus",0x2D},
  {"equal",0x2E},{"lbracket",0x2F},{"rbracket",0x30},{"backslash",0x31},{"semicolon",0x33},
  {"quote",0x34},{"grave",0x35},{"comma",0x36},{"period",0x37},{"slash",0x38},{"capslock",0x39},
  {"f1",0x3A},{"f2",0x3B},{"f3",0x3C},{"f4",0x3D},{"f5",0x3E},{"f6",0x3F},{"f7",0x40},{"f8",0x41},
  {"f9",0x42},{"f10",0x43},{"f11",0x44},{"f12",0x45},
  {"printscreen",0x46},{"scrolllock",0x47},{"pause",0x48},{"insert",0x49},{"home",0x4A},
  {"pageup",0x4B},{"delete",0x4C},{"end",0x4D},{"pagedown",0x4E},{"right",0x4F},{"left",0x50},
  {"down",0x51},{"up",0x52},{"numlock",0x53},
  {"kp_slash",0x54},{"kp_asterisk",0x55},{"kp_minus",0x56},{"kp_plus",0x57},{"kp_enter",0x58},
  {"kp_1",0x59},{"kp_2",0x5A},{"kp_3",0x5B},{"kp_4",0x5C},{"kp_5",0x5D},{"kp_6",0x5E},
  {"kp_7",0x5F},{"kp_8",0x60},{"kp_9",0x61},{"kp_0",0x62},{"kp_dot",0x63},
  {"intl_backslash",0x64},{"menu",0x65},
  {"f13",0x68},{"f14",0x69},{"f15",0x6A},{"f16",0x6B},{"f17",0x6C},{"f18",0x6D},{"f19",0x6E},
  {"f20",0x6F},{"f21",0x70},{"f22",0x71},{"f23",0x72},{"f24",0x73},
  {"lctrl",0xE0},{"lshift",0xE1},{"lalt",0xE2},{"lgui",0xE3},
  {"rctrl",0xE4},{"rshift",0xE5},{"ralt",0xE6},{"rgui",0xE7},
};
// KEYMAP-TABLE-END

uint8_t keyUsage(const char *name) {
  if (!name || !*name) return 0;
  for (const auto &k : KEYS)
    if (strcasecmp(k.name, name) == 0) return k.usage;
  return 0;
}

uint8_t modBit(const char *name) {
  if (!name) return 0;
  static const KeyName MODS[] = {
    {"ctrl",MOD_LCTRL},{"shift",MOD_LSHIFT},{"alt",MOD_LALT},{"gui",MOD_LGUI},
    {"lctrl",MOD_LCTRL},{"lshift",MOD_LSHIFT},{"lalt",MOD_LALT},{"lgui",MOD_LGUI},
    {"rctrl",MOD_RCTRL},{"rshift",MOD_RSHIFT},{"ralt",MOD_RALT},{"rgui",MOD_RGUI},
    {"cmd",MOD_LGUI},{"win",MOD_LGUI},{"meta",MOD_LGUI},{"option",MOD_LALT},
  };
  for (const auto &m : MODS)
    if (strcasecmp(m.name, name) == 0) return m.usage;
  return 0;
}

bool asciiToKey(char c, uint8_t &usage, bool &shift) {
  shift = false;
  if (c >= 'a' && c <= 'z') { usage = 0x04 + (c - 'a'); return true; }
  if (c >= 'A' && c <= 'Z') { usage = 0x04 + (c - 'A'); shift = true; return true; }
  if (c >= '1' && c <= '9') { usage = 0x1E + (c - '1'); return true; }
  if (c == '0') { usage = 0x27; return true; }
  switch (c) {
    case '\n': usage = 0x28; return true;
    case '\t': usage = 0x2B; return true;
    case ' ':  usage = 0x2C; return true;
    case '-':  usage = 0x2D; return true;
    case '=':  usage = 0x2E; return true;
    case '[':  usage = 0x2F; return true;
    case ']':  usage = 0x30; return true;
    case '\\': usage = 0x31; return true;
    case ';':  usage = 0x33; return true;
    case '\'': usage = 0x34; return true;
    case '`':  usage = 0x35; return true;
    case ',':  usage = 0x36; return true;
    case '.':  usage = 0x37; return true;
    case '/':  usage = 0x38; return true;
  }
  shift = true;
  switch (c) {
    case '!': usage = 0x1E; return true;
    case '@': usage = 0x1F; return true;
    case '#': usage = 0x20; return true;
    case '$': usage = 0x21; return true;
    case '%': usage = 0x22; return true;
    case '^': usage = 0x23; return true;
    case '&': usage = 0x24; return true;
    case '*': usage = 0x25; return true;
    case '(': usage = 0x26; return true;
    case ')': usage = 0x27; return true;
    case '_': usage = 0x2D; return true;
    case '+': usage = 0x2E; return true;
    case '{': usage = 0x2F; return true;
    case '}': usage = 0x30; return true;
    case '|': usage = 0x31; return true;
    case ':': usage = 0x33; return true;
    case '"': usage = 0x34; return true;
    case '~': usage = 0x35; return true;
    case '<': usage = 0x36; return true;
    case '>': usage = 0x37; return true;
    case '?': usage = 0x38; return true;
  }
  shift = false;
  return false;
}
