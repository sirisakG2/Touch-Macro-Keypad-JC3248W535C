// Keyboard output router: USB HID when a PC has enumerated the keypad, BLE HID otherwise.
// The BLE server also carries a Nordic-UART-style service that the web app uses for config.
#pragma once
#include <Arduino.h>

enum Link : uint8_t { LINK_NONE, LINK_USB, LINK_BLE };
enum BleState : uint8_t { BLE_OFF, BLE_ADV, BLE_CONN };

void hidBegin(const char *name);
void hidLoop();                       // call from loop(): switches BLE advertising on/off
Link hidLink();                       // where keystrokes go right now
BleState hidBleState();
bool hidUsbReady();
void hidSend(uint8_t mods, const uint8_t keys[6]);

// Config channel over BLE (NUS). Bytes received are buffered; poll with bleRxRead.
size_t bleRxRead(char *dst, size_t max);
bool bleConfigConnected();
void bleTxWrite(const char *data, size_t len);   // notifies in MTU-sized chunks
