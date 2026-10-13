// Line-delimited JSON protocol used by the web app over USB CDC (Web Serial) and BLE NUS (Web Bluetooth).
// Request:  {"id":7,"cmd":"hello"}            Reply: {"id":7,"ok":true,...} or {"id":7,"ok":false,"err":"..."}
// Events:   {"ev":"press","p":0,"k":3}  {"ev":"page","p":1}
// Commands: hello, ls, read, wbegin, wchunk, wend, rm, apply, run, page, bright, bootloader, reboot
#pragma once
#include <Arduino.h>

void protoBegin();
void protoLoop();
void protoEvent(const char *json);   // broadcast to every connected config channel
