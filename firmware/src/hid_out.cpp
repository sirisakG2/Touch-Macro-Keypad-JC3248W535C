#include "hid_out.h"
#include "USB.h"
#include "USBHIDKeyboard.h"
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>
#include <freertos/stream_buffer.h>

static USBHIDKeyboard usbKbd;
static volatile bool usbMounted = false, usbSuspended = false;

static NimBLEServer *bleServer;
static NimBLEHIDDevice *bleHid;
static NimBLECharacteristic *bleInput, *nusTx;
static volatile bool bleConnected = false, nusSubscribed = false;
static volatile uint16_t bleMtu = 23;
static bool bleAdvertising = false;
static StreamBufferHandle_t bleRx;

#define NUS_SERVICE "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_RX      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

// Standard keyboard report map, report ID 1: 8-byte input + 1-byte LED output.
static const uint8_t REPORT_MAP[] = {
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0xFF, 0x05, 0x07, 0x19, 0x00, 0x29, 0xFF, 0x81, 0x00,
  0xC0,
};

static void onUsbEvent(void *, esp_event_base_t base, int32_t id, void *) {
  if (base != ARDUINO_USB_EVENTS) return;
  switch (id) {
    case ARDUINO_USB_STARTED_EVENT: usbMounted = true; usbSuspended = false; break;
    case ARDUINO_USB_STOPPED_EVENT: usbMounted = false; break;
    case ARDUINO_USB_SUSPEND_EVENT: usbSuspended = true; break;
    case ARDUINO_USB_RESUME_EVENT:  usbSuspended = false; break;
  }
}

class ServerCb : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *, NimBLEConnInfo &) override { bleConnected = true; bleAdvertising = false; }
  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int) override {
    bleConnected = bleServer->getConnectedCount() > 0;
    nusSubscribed = false;
    bleMtu = 23;
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo &) override { bleMtu = mtu; }
};

class RxCb : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *c, NimBLEConnInfo &) override {
    NimBLEAttValue v = c->getValue();
    xStreamBufferSend(bleRx, v.data(), v.length(), 0);
  }
};

class TxCb : public NimBLECharacteristicCallbacks {
  void onSubscribe(NimBLECharacteristic *, NimBLEConnInfo &, uint16_t subValue) override { nusSubscribed = subValue != 0; }
};

void hidBegin(const char *name) {
  USB.onEvent(onUsbEvent);
  USB.productName("Touch Macro Keypad");
  USB.manufacturerName("JC3248W535C");
  usbKbd.begin();
  USB.begin();

  bleRx = xStreamBufferCreate(16384, 1);
  NimBLEDevice::init(name);
  NimBLEDevice::setMTU(247);
  NimBLEDevice::setSecurityAuth(true, false, true);         // bonding, Just Works, secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  bleServer = NimBLEDevice::createServer();
  bleServer->setCallbacks(new ServerCb());
  bleServer->advertiseOnDisconnect(false);

  bleHid = new NimBLEHIDDevice(bleServer);
  bleHid->setManufacturer("JC3248W535C");
  bleHid->setPnp(0x02, 0x303A, 0x8100, 0x0100);
  bleHid->setHidInfo(0x00, 0x01);
  bleHid->setReportMap((uint8_t *)REPORT_MAP, sizeof(REPORT_MAP));
  bleInput = bleHid->getInputReport(1);
  bleHid->getOutputReport(1);
  bleHid->setBatteryLevel(100);

  NimBLEService *nus = bleServer->createService(NUS_SERVICE);
  nus->createCharacteristic(NUS_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR)->setCallbacks(new RxCb());
  nusTx = nus->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  nusTx->setCallbacks(new TxCb());
  bleServer->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setAppearance(0x03C1);   // HID keyboard
  adv->addServiceUUID(bleHid->getHidService()->getUUID());
  adv->setName(name);
  adv->enableScanResponse(true);
}

bool hidUsbReady() { return usbMounted && !usbSuspended && (bool)USB; }

void hidLoop() {
  // USB wins when a host has enumerated us; give it 2.5 s after boot before falling back to BLE.
  bool wantBle = !hidUsbReady() && millis() > 2500;
  if (wantBle && !bleConnected && !bleAdvertising) {
    bleAdvertising = NimBLEDevice::getAdvertising()->start();
  } else if (!wantBle && bleAdvertising) {
    NimBLEDevice::getAdvertising()->stop();
    bleAdvertising = false;
  }
}

Link hidLink() {
  if (hidUsbReady()) return LINK_USB;
  if (bleConnected) return LINK_BLE;
  return LINK_NONE;
}

BleState hidBleState() { return bleConnected ? BLE_CONN : (bleAdvertising ? BLE_ADV : BLE_OFF); }

void hidSend(uint8_t mods, const uint8_t keys[6]) {
  Link l = hidLink();
  if (l == LINK_USB) {
    KeyReport r;
    r.modifiers = mods;
    r.reserved = 0;
    memcpy(r.keys, keys, 6);
    usbKbd.sendReport(&r);
  } else if (l == LINK_BLE) {
    uint8_t r[8] = {mods, 0};
    memcpy(r + 2, keys, 6);
    bleInput->setValue(r, sizeof(r));
    bleInput->notify();
  }
}

size_t bleRxRead(char *dst, size_t max) { return xStreamBufferReceive(bleRx, dst, max, 0); }
bool bleConfigConnected() { return bleConnected && nusSubscribed; }

void bleTxWrite(const char *data, size_t len) {
  if (!bleConfigConnected()) return;
  size_t chunk = bleMtu > 23 ? bleMtu - 3 : 20;
  for (size_t off = 0; off < len; off += chunk) {
    size_t n = min(chunk, len - off);
    nusTx->setValue((const uint8_t *)data + off, n);
    nusTx->notify();
    delay(4);   // let the stack drain; Web Bluetooth reassembles by newline
  }
}
