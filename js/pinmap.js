// Raspberry Pi Pico 물리 핀맵 (핀 1~20: 왼쪽 위→아래, 핀 21~40: 오른쪽 아래→위)
'use strict';

const PICO_LEFT = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7',
  'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
// 물리 핀 21 ~ 40
const PICO_RIGHT = ['GP16', 'GP17', 'GND', 'GP18', 'GP19', 'GP20', 'GP21', 'GND', 'GP22', 'RUN',
  'GP26', 'GP27', 'AGND', 'GP28', 'ADC_VREF', '3V3', '3V3_EN', 'GND', 'VSYS', 'VBUS'];

function gpioFunctions(n) {
  const f = [];
  if (n >= 26 && n <= 28) f.push('ADC' + (n - 26));
  f.push(`I2C${(n >> 1) & 1} ${n % 2 ? 'SCL' : 'SDA'}`);
  f.push(`SPI${(n >> 3) & 1} ${['RX', 'CSn', 'SCK', 'TX'][n % 4]}`);
  const u = ['TX', 'RX', 'CTS', 'RTS'][n % 4];
  f.push(`UART${((n + 4) >> 3) & 1} ${u}`);
  f.push(`PWM${(n >> 1) & 7}${n & 1 ? 'B' : 'A'}`);
  return f;
}

const PICO_PINS = (() => {
  const pins = {};
  const mk = (num, name, side) => {
    const p = { num, name, side, gpio: null, type: 'gpio', funcs: [] };
    if (/^GP\d+$/.test(name)) { p.gpio = +name.slice(2); p.funcs = gpioFunctions(p.gpio); }
    else if (name === 'GND' || name === 'AGND') { p.type = 'gnd'; p.v = 0; }
    else if (name === '3V3' || name === 'ADC_VREF') { p.type = 'power'; p.v = 3.3; }
    else if (name === 'VSYS' || name === 'VBUS') { p.type = 'power5'; p.v = 5.0; }
    else p.type = 'ctrl';
    pins[num] = p;
  };
  PICO_LEFT.forEach((n, i) => mk(i + 1, n, 'L'));
  PICO_RIGHT.forEach((n, i) => mk(i + 21, n, 'R'));
  return pins;
})();

const PICO_DESC = {
  GND: '그라운드 (0V)', AGND: '아날로그 그라운드 (0V)', '3V3': '3.3V 출력 (최대 300mA)',
  '3V3_EN': '3.3V 레귤레이터 Enable', VSYS: '시스템 전원 입력/출력 (≈5V)', VBUS: 'USB 5V',
  ADC_VREF: 'ADC 기준 전압 (3.3V)', RUN: 'RP2040 리셋 (LOW = 리셋)',
};

// GPIO 번호 -> 물리 핀 번호
const GPIO_TO_PIN = {};
Object.values(PICO_PINS).forEach(p => { if (p.gpio !== null) GPIO_TO_PIN[p.gpio] = p.num; });

// 하드웨어 버스 판정
const HW = {
  i2cBus(sda, scl) {
    if (sda == null || scl == null) return null;
    if (sda % 2 !== 0 || scl % 2 !== 1) return null;
    const b1 = (sda >> 1) & 1, b2 = (scl >> 1) & 1;
    return b1 === b2 ? b1 : null;
  },
  spiRole(n) { return ['RX', 'CSn', 'SCK', 'TX'][n % 4]; },
  spiBusOf(n) { return (n >> 3) & 1; },
  spiBus(sck, mosi, miso) {
    if (sck == null || mosi == null) return null;
    if (HW.spiRole(sck) !== 'SCK' || HW.spiRole(mosi) !== 'TX') return null;
    const b = HW.spiBusOf(sck);
    if (HW.spiBusOf(mosi) !== b) return null;
    if (miso != null && (HW.spiRole(miso) !== 'RX' || HW.spiBusOf(miso) !== b)) return null;
    return b;
  },
  uartBus(tx, rx) {
    const role = n => ['TX', 'RX', 'CTS', 'RTS'][n % 4];
    const bus = n => ((n + 4) >> 3) & 1;
    if (tx == null && rx == null) return null;
    if (tx != null && role(tx) !== 'TX') return null;
    if (rx != null && role(rx) !== 'RX') return null;
    if (tx != null && rx != null && bus(tx) !== bus(rx)) return null;
    return bus(tx != null ? tx : rx);
  },
  adcChannel(g) { return g >= 26 && g <= 29 ? g - 26 : null; },
};

// 블록 드롭다운용 GPIO 목록
const GPIO_LIST = [...Array(23).keys(), 26, 27, 28];
