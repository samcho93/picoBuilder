// 예제 프로젝트
'use strict';

function buildProject(name, fn, board = 'pico') {
  const bd = BOARDS[board];
  const nodes = [{ id: bd.id, type: board, name: bd.id, x: 430, y: 40, st: bd.init ? bd.init() : {} }];
  const wires = [];
  let seq = 1;
  const counts = {};
  const api = {
    _find: id => nodes.find(n => n.id === id),
    P(p) {
      if (board === 'microbit') return 'mb:' + (typeof p === 'number' ? 'P' + p : p);
      if (board.startsWith('nano')) {
        const pins = Object.values(BOARDS[board].pins);
        const name = p === 'GND2' ? 'GND' : p;
        const hit = p === 'GND2' ? pins.filter(x => x.name === 'GND')[1] : pins.find(x => x.name === name);
        return 'nano:' + hit.num;
      }
      if (board === 'rp2040zero') return 'zero:' + (typeof p === 'number' ? ZERO_GPIO_KEY[p] : { '5V': 'L1', GND: 'L2', '3V3': 'L3', GND2: 'L2' }[p]);
      if (board === 'esp32') return 'esp:' + (typeof p === 'number' ? ESP_GPIO_KEY[p] : { '3V3': 'L1', GND: 'R1', GND2: 'L14', GND3: 'R7', '5V': 'L19' }[p]);
      if (typeof p === 'number') return 'pico:' + p;
      if (/^GP\d+$/.test(p)) return 'pico:' + GPIO_TO_PIN[+p.slice(2)];
      return 'pico:' + { '3V3': 36, VBUS: 40, VSYS: 39, GND: 38 }[p];
    },
    dev(type, x, y, opt = {}) {
      const d = DEVICES[type];
      const id = 'n' + seq++;
      counts[d.prefix] = (counts[d.prefix] || 0) + 1;
      nodes.push({ id, type, x, y, flip: !!opt.flip, name: opt.name || d.prefix + counts[d.prefix], st: { ...(d.init ? d.init() : {}), ...(opt.st || {}) } });
      return id;
    },
    node(type, x, y, st = {}) {
      const id = 'n' + seq++;
      const s = {};
      for (const p of NODES[type].props || []) s[p.k] = p.def;
      nodes.push({ id, type, x, y, st: { ...s, ...st } });
      return id;
    },
    hw(dev, pairs) { for (const [pin, pico] of Object.entries(pairs)) wires.push({ a: api.P(pico), b: `${dev}:${pin}` }); },
    w(a, b) { wires.push({ a, b }); },
    ref(dev, node) { wires.push({ a: dev + ':@', b: node + ':dev' }); const n = nodes.find(x => x.id === node); n.st.dev = dev; },
    flow(...ids) { for (let i = 0; i < ids.length - 1; i++) { const [a, pa] = ids[i].split('.'); const b = ids[i + 1].split('.')[0]; wires.push({ a: `${a}:${pa || 'out'}`, b: `${b}:in` }); } },
    data(src, dst) { const [a, pa] = src.split('.'); const [b, pb] = dst.split('.'); wires.push({ a: `${a}:${pa}`, b: `${b}:${pb}` }); },
  };
  const extra = fn(api) || {};
  return { version: 1, name, board, circuit: { nodes, wires, seq }, ...extra };
}

const EXAMPLES = [
  {
    group: '🍓 Raspberry Pi Pico',
    name: '① 보드 LED 깜빡이기', desc: '가장 기본: 내장 LED(GP25)를 0.5초마다 토글',
    build: () => buildProject('보드 LED 깜빡이기', E => {
      const loop = E.node('ev_loop', 780, 60, { delay: 0 });
      const t = E.node('onboard_toggle', 960, 60);
      const w = E.node('wait', 1140, 60);
      E.flow(loop, t, w);
    }),
  },
  {
    name: '② 버튼으로 LED 켜기', desc: '푸시 버튼(GP14)을 누르는 동안 LED(GP15) 켜기',
    build: () => buildProject('버튼으로 LED 켜기', E => {
      const btn = E.dev('button', 160, 250, { flip: true });
      const led = E.dev('led', 170, 390, { flip: true });
      E.hw(btn, { A: 'GP14', B: 18 });
      E.hw(led, { '+': 'GP15', '-': 13 });
      const loop = E.node('ev_loop', 790, 60);
      const set = E.node('m_led', 990, 60);
      const rd = E.node('m_button', 790, 200);
      E.flow(loop, set);
      E.ref(led, set); E.ref(btn, rd);
      E.data(rd + '.pressed', set + '.on');
    }),
  },
  {
    name: '③ 가변저항으로 서보 제어', desc: 'ADC(GP26) 값을 0~180°로 변환해 서보(GP16) 회전',
    build: () => buildProject('가변저항 서보', E => {
      const pot = E.dev('pot', 760, 300);
      const sv = E.dev('servo', 760, 460);
      E.hw(pot, { VCC: '3V3', GND: 33, OUT: 'GP26' });
      E.hw(sv, { GND: 38, VCC: 'VBUS', SIG: 'GP16' });
      const loop = E.node('ev_loop', 1040, 60, { delay: 20 });
      const m = E.node('m_servo', 1240, 60);
      const a = E.node('m_analog', 1040, 220);
      const map = E.node('map', 1240, 220, {});
      E.flow(loop, m);
      E.ref(sv, m); E.ref(pot, a);
      E.data(a + '.value', map + '.x');
      Object.assign(nodeSt(E, map), { b: 100, d: 180 });
      E.data(map + '.r', m + '.angle');
    }),
  },
  {
    name: '④ DHT11 온습도 → OLED', desc: 'DHT11(GP22) 값을 SSD1306 OLED(I2C0: GP20/21)에 표시',
    build: () => buildProject('DHT11 OLED', E => {
      const oled = E.dev('oled', 760, 40);
      const dht = E.dev('dht11', 760, 330);
      E.hw(oled, { GND: 38, VCC: '3V3', SCL: 'GP21', SDA: 'GP20' });
      E.hw(dht, { VCC: '3V3', DATA: 'GP22', GND: 28 });
      const loop = E.node('ev_loop', 1080, 40, { delay: 1000 });
      const c = E.node('m_oled_clear', 1250, 40);
      const t1 = E.node('m_oled_text', 1420, 40);
      const t2 = E.node('m_oled_text', 1620, 40);
      const s = E.node('m_oled_show', 1820, 40);
      E.flow(loop, c, t1, t2, s);
      [c, t1, t2, s].forEach(n => E.ref(oled, n));
      const d = E.node('m_dht', 1080, 260);
      E.ref(dht, d);
      const j1 = E.node('join', 1260, 250), j2 = E.node('join', 1260, 350);
      Object.assign(nodeSt(E, j1), { a: 'Temp: ' }); Object.assign(nodeSt(E, j2), { a: 'Humi: ' });
      E.data(d + '.t', j1 + '.b'); E.data(d + '.h', j2 + '.b');
      E.data(j1 + '.r', t1 + '.text'); E.data(j2 + '.r', t2 + '.text');
      Object.assign(nodeSt(E, t1), { x: 0, y: 16 }); Object.assign(nodeSt(E, t2), { x: 0, y: 36 });
    }),
  },
  {
    name: '⑤ 네오픽셀 무지개', desc: 'WS2812 8개(GP16)에 회전하는 무지개 표시',
    build: () => buildProject('네오픽셀 무지개', E => {
      const np = E.dev('neopixel', 760, 420);
      E.hw(np, { DIN: 'GP16', VCC: 'VBUS', GND: 38 });
      const loop = E.node('ev_loop', 1000, 60, { delay: 30 });
      const inc = E.node('var_change', 1180, 60, { name: 'hue' });
      const rb = E.node('m_np_rainbow', 1360, 60);
      const g = E.node('var_get', 1180, 200, { name: 'hue' });
      Object.assign(nodeSt(E, inc), { by: 6 });
      E.flow(loop, inc, rb);
      E.ref(np, rb);
      E.data(g + '.value', rb + '.off');
    }),
  },
  {
    name: '⑥ 초음파 거리 → LCD1602', desc: 'HC-SR04(TRIG GP17, ECHO GP16) 거리를 I2C LCD에 표시',
    build: () => buildProject('초음파 LCD', E => {
      const lcd = E.dev('lcd', 760, 40);
      const so = E.dev('hcsr04', 760, 260);
      E.hw(lcd, { GND: 38, VCC: 'VBUS', SDA: 'GP20', SCL: 'GP21' });
      E.hw(so, { VCC: 'VBUS', TRIG: 'GP17', ECHO: 'GP16', GND: 23 });
      const loop = E.node('ev_loop', 1040, 40, { delay: 300 });
      const p1 = E.node('m_lcd_print', 1220, 40);
      const p2 = E.node('m_lcd_print', 1440, 40);
      E.flow(loop, p1, p2);
      E.ref(lcd, p1); E.ref(lcd, p2);
      Object.assign(nodeSt(E, p1), { text: 'Distance:' });
      Object.assign(nodeSt(E, p2), { col: 0, row: 1 });
      const d = E.node('m_sonar', 1040, 260);
      const f = E.node('format', 1220, 260);
      const j = E.node('join', 1400, 260);
      E.ref(so, d);
      E.data(d + '.cm', f + '.x'); E.data(f + '.r', j + '.a');
      Object.assign(nodeSt(E, j), { b: ' cm     ' });
      E.data(j + '.r', p2 + '.text');
    }),
  },
  {
    name: '⑦ 버튼 카운터 → 8x8 매트릭스', desc: '버튼 인터럽트로 숫자를 세어 MAX7219(SPI0)에 표시',
    build: () => buildProject('버튼 카운터 매트릭스', E => {
      const btn = E.dev('button', 160, 380, { flip: true });
      const mx = E.dev('max7219', 760, 330);
      E.hw(btn, { A: 'GP15', B: 18 });
      E.hw(mx, { VCC: 'VBUS', GND: 38, DIN: 'GP19', CS: 'GP17', CLK: 'GP18' });
      const st = E.node('ev_start', 1020, 40);
      const ic = E.node('m_mtx_icon', 1200, 40);
      E.flow(st, ic); E.ref(mx, ic);
      const ev = E.node('ev_button', 1020, 180);
      const inc = E.node('var_change', 1200, 180, { name: 'count' });
      const tx = E.node('m_mtx_text', 1380, 180);
      const pr = E.node('print', 1580, 180);
      E.flow(ev, inc, tx, pr);
      E.ref(btn, ev); E.ref(mx, tx);
      const g = E.node('var_get', 1020, 330, { name: 'count' });
      const md = E.node('math', 1200, 330, { op: '%' });
      Object.assign(nodeSt(E, md), { b: 10 });
      E.data(g + '.value', md + '.a'); E.data(md + '.r', tx + '.text');
      E.data(g + '.value', pr + '.value');
    }),
  },
  {
    name: '⑧ GPS 위치 출력', desc: 'NEO-6M GPS(UART0: GP16 TX / GP17 RX) 위도·경도 출력',
    build: () => buildProject('GPS', E => {
      const gps = E.dev('gps', 760, 300);
      E.hw(gps, { VCC: '3V3', GND: 38, TX: 'GP17', RX: 'GP16' });
      const loop = E.node('ev_loop', 1040, 60, { delay: 1000 });
      const p1 = E.node('print', 1220, 60), p2 = E.node('print', 1400, 60);
      E.flow(loop, p1, p2);
      const g = E.node('m_gps', 1040, 200);
      E.ref(gps, g);
      const j1 = E.node('join', 1220, 200), j2 = E.node('join', 1220, 300);
      Object.assign(nodeSt(E, j1), { a: 'LAT ' }); Object.assign(nodeSt(E, j2), { a: 'LON ' });
      E.data(g + '.lat', j1 + '.b'); E.data(g + '.lon', j2 + '.b');
      E.data(j1 + '.r', p1 + '.value'); E.data(j2 + '.r', p2 + '.value');
    }),
  },
  {
    name: '⑨ 블루투스로 LED 제어', desc: 'HC-05(UART1: GP20/21)로 "on"/"off" 수신 시 LED 제어',
    build: () => buildProject('블루투스 LED', E => {
      const bt = E.dev('hc05', 760, 250);
      const led = E.dev('led', 170, 390, { flip: true });
      E.hw(bt, { VCC: 'VBUS', GND: 38, TXD: 'GP21', RXD: 'GP20' });
      E.hw(led, { '+': 'GP15', '-': 18 });
      const loop = E.node('ev_loop', 1040, 40, { delay: 50 });
      const set = E.node('var_set', 1220, 40, { name: 'msg' });
      const if1 = E.node('if', 1400, 40);
      const if2 = E.node('if', 1400, 230);
      const on = E.node('m_led', 1600, 20), off = E.node('m_led', 1600, 230);
      const s1 = E.node('m_uart_send', 1800, 20), s2 = E.node('m_uart_send', 1800, 230);
      E.flow(loop, set, if1);
      E.w(if1 + ':then', on + ':in'); E.w(on + ':out', s1 + ':in');
      E.w(if1 + ':out', if2 + ':in');
      E.w(if2 + ':then', off + ':in'); E.w(off + ':out', s2 + ':in');
      E.ref(led, on); E.ref(led, off); E.ref(bt, s1); E.ref(bt, s2);
      Object.assign(nodeSt(E, off), { on: false });
      Object.assign(nodeSt(E, s1), { text: 'LED ON' }); Object.assign(nodeSt(E, s2), { text: 'LED OFF' });
      const rx = E.node('m_uart_recv', 1040, 200);
      E.ref(bt, rx);
      E.data(rx + '.line', set + '.value');
      const g = E.node('var_get', 1040, 330, { name: 'msg' });
      const c1 = E.node('compare', 1220, 250, { op: '==' }), c2 = E.node('compare', 1220, 380, { op: '==' });
      Object.assign(nodeSt(E, c1), { b: 'on' }); Object.assign(nodeSt(E, c2), { b: 'off' });
      E.data(g + '.value', c1 + '.a'); E.data(g + '.value', c2 + '.a');
      E.data(c1 + '.r', if1 + '.cond'); E.data(c2 + '.r', if2 + '.cond');
    }),
  },
  {
    name: '⑩ [코드] 타이머 인터럽트', desc: 'Python 직접 작성: machine.Timer 로 LED 토글',
    build: () => buildProject('타이머 인터럽트 (코드)', E => {
      const led = E.dev('led', 170, 390, { flip: true, name: 'led' });
      E.hw(led, { '+': 'GP15', '-': 18 });
      return {
        codeMode: 'manual', code: `from machine import Pin, Timer
import time

led = Pin(15, Pin.OUT)
count = 0


def tick(t):
    global count
    count += 1
    led.toggle()
    print('tick', count)


tim = Timer(period=500, mode=Timer.PERIODIC, callback=tick)
print('타이머 시작 - 메인 루프는 다른 일을 할 수 있습니다')
while True:
    time.sleep(2)
    print('메인 루프 동작 중... count =', count)
`,
      };
    }),
  },
  {
    name: '⑪ [코드] I2C 스캔 + AHT20', desc: 'Python 직접 작성: I2C 장치 검색 후 온습도 출력',
    build: () => buildProject('I2C 스캔 AHT20 (코드)', E => {
      const a = E.dev('aht20', 760, 60);
      E.hw(a, { VIN: '3V3', GND: 38, SCL: 'GP21', SDA: 'GP20' });
      return {
        codeMode: 'manual', code: `from machine import Pin, I2C
from aht20 import AHT20
import time

i2c = I2C(0, sda=Pin(20), scl=Pin(21), freq=400000)
print('I2C 장치:', [hex(a) for a in i2c.scan()])

sensor = AHT20(i2c)
while True:
    t, h = sensor.measure()
    print('온도 {:.1f}C  습도 {:.1f}%'.format(t, h))
    time.sleep(1)
`,
      };
    }),
  },
];

// 예제에서 노드 입력 기본값을 지정할 때 사용
function nodeSt(E, id) { return E._find(id).st; }

// ---------------- Arduino Nano RP2040 Connect 예제 ----------------
EXAMPLES.push(
  {
    group: '🔷 Arduino Nano RP2040 Connect', board: 'nanorp2040',
    name: 'Ⓐ① 내장 LED(D13) 깜빡이기', desc: '외부 부품 없이 보드 내장 LED를 0.5초마다 토글',
    build: () => buildProject('Nano RP2040 블링크', E => {
      const loop = E.node('ev_loop', 800, 60, { delay: 0 });
      const t = E.node('onboard_toggle', 980, 60);
      const w = E.node('wait', 1160, 60);
      E.flow(loop, t, w);
    }, 'nanorp2040'),
  },
  {
    board: 'nanorp2040',
    name: 'Ⓐ② 버튼(D2)으로 LED(D9) 켜기', desc: 'Nano 핀 이름(D2, D9)이 RP2040 GPIO로 자동 변환됩니다',
    build: () => buildProject('Nano RP2040 버튼 LED', E => {
      const btn = E.dev('button', 120, 120, { flip: true });
      const led = E.dev('led', 120, 300, { flip: true });
      E.hw(btn, { A: 'D2', B: 'GND' });
      E.hw(led, { '+': 'D9', '-': 'GND2' });
      const loop = E.node('ev_loop', 820, 60);
      const set = E.node('m_led', 1020, 60);
      const rd = E.node('m_button', 820, 200);
      E.flow(loop, set);
      E.ref(led, set); E.ref(btn, rd);
      E.data(rd + '.pressed', set + '.on');
    }, 'nanorp2040'),
  },
  {
    board: 'nanorp2040',
    name: 'Ⓐ③ 가변저항(A0) → OLED 표시', desc: 'A0 아날로그 값을 I2C OLED(A4 SDA / A5 SCL)에 표시',
    build: () => buildProject('Nano RP2040 A0 OLED', E => {
      const pot = E.dev('pot', 120, 300, { flip: true });
      const oled = E.dev('oled', 800, 60);
      E.hw(pot, { VCC: '3V3', GND: 'GND', OUT: 'A0' });
      E.hw(oled, { GND: 'GND2', VCC: '3V3', SDA: 'A4', SCL: 'A5' });
      const loop = E.node('ev_loop', 1100, 40, { delay: 200 });
      const c = E.node('m_oled_clear', 1270, 40);
      const t1 = E.node('m_oled_text', 1440, 40);
      const s = E.node('m_oled_show', 1640, 40);
      E.flow(loop, c, t1, s);
      [c, t1, s].forEach(x => E.ref(oled, x));
      const a = E.node('m_analog', 1100, 250);
      E.ref(pot, a);
      const j = E.node('join', 1280, 250);
      Object.assign(nodeSt(E, j), { a: 'A0: ' });
      E.data(a + '.value', j + '.b');
      E.data(j + '.r', t1 + '.text');
      Object.assign(nodeSt(E, t1), { y: 24 });
    }, 'nanorp2040'),
  },
  {
    board: 'nanorp2040',
    name: 'Ⓐ④ [코드] A0 값으로 LED 밝기', desc: 'Python 직접 작성: A0(ADC) 값을 D13 LED PWM 밝기로',
    build: () => buildProject('Nano RP2040 PWM (코드)', E => {
      const pot = E.dev('pot', 120, 300, { flip: true });
      E.hw(pot, { VCC: '3V3', GND: 'GND', OUT: 'A0' });
      return {
        codeMode: 'manual', code: `from machine import Pin, ADC, PWM
import time

# Arduino Nano RP2040 Connect: A0 = GPIO26, D13(LED) = GPIO6
pot = ADC(Pin(26))
led = PWM(Pin(6))
led.freq(1000)

while True:
    v = pot.read_u16()
    led.duty_u16(v)
    print('A0 =', v, '(', round(v * 100 / 65535), '% )')
    time.sleep_ms(200)
`,
      };
    }, 'nanorp2040'),
  },
);

// ---------------- Arduino Nano ESP32 예제 ----------------
EXAMPLES.push(
  {
    group: '🔶 Arduino Nano ESP32', board: 'nanoesp32',
    name: 'Ⓝ① WiFi 연결 + 내장 LED', desc: 'WiFi 접속 후 D13 LED 깜빡이기 (ESP32-S3)',
    build: () => buildProject('Nano ESP32 WiFi 블링크', E => {
      const st = E.node('ev_start', 800, 40);
      const wf = E.node('esp_wifi', 980, 40);
      const loop = E.node('ev_loop', 800, 220, { delay: 0 });
      const t = E.node('onboard_toggle', 980, 220);
      const w = E.node('wait', 1160, 220);
      E.flow(st, wf); E.flow(loop, t, w);
    }, 'nanoesp32'),
  },
  {
    board: 'nanoesp32',
    name: 'Ⓝ② 가변저항(A0) → 서보(D9)', desc: 'A0(GPIO1) 아날로그 입력으로 D9 서보 제어',
    build: () => buildProject('Nano ESP32 서보', E => {
      const pot = E.dev('pot', 120, 120, { flip: true });
      const sv = E.dev('servo', 120, 330, { flip: true });
      E.hw(pot, { VCC: '3V3', GND: 'GND', OUT: 'A0' });
      E.hw(sv, { GND: 'GND2', VCC: '5V', SIG: 'D9' });
      const loop = E.node('ev_loop', 820, 40, { delay: 20 });
      const m = E.node('m_servo', 1000, 40);
      const a = E.node('m_analog', 820, 200);
      const map = E.node('map', 1000, 200);
      E.flow(loop, m);
      E.ref(sv, m); E.ref(pot, a);
      E.data(a + '.value', map + '.x');
      Object.assign(nodeSt(E, map), { b: 100, d: 180 });
      E.data(map + '.r', m + '.angle');
    }, 'nanoesp32'),
  },
  {
    board: 'nanoesp32',
    name: 'Ⓝ③ 터치(A2)로 네오픽셀', desc: 'A2 터치 감지(버튼으로 손가락 흉내) 시 WS2812(D2) 켜기',
    build: () => buildProject('Nano ESP32 터치', E => {
      const np = E.dev('neopixel', 800, 300);
      const btn = E.dev('button', 800, 450, { name: 'finger' });
      E.hw(np, { DIN: 'D2', VCC: '5V', GND: 'GND2' });
      E.hw(btn, { A: 'A2', B: 'GND' });
      const loop = E.node('ev_loop', 1100, 40, { delay: 50 });
      const iff = E.node('if', 1280, 40);
      const on = E.node('m_np_fill', 1470, 0), off = E.node('m_np_fill', 1470, 230);
      E.flow(loop, iff);
      E.w(iff + ':then', on + ':in'); E.w(iff + ':else', off + ':in');
      E.ref(np, on); E.ref(np, off);
      Object.assign(nodeSt(E, on), { r: 0, g: 200, b: 60 }); Object.assign(nodeSt(E, off), { r: 0, g: 0, b: 0 });
      const t = E.node('esp_touch', 1100, 230);
      Object.assign(nodeSt(E, t), { pin: '3' });
      E.data(t + '.t', iff + '.cond');
    }, 'nanoesp32'),
  },
  {
    board: 'nanoesp32',
    name: 'Ⓝ④ [코드] WiFi 스캔 + LED', desc: 'Python 직접 작성: 주변 AP 검색 후 D13 LED 깜빡이기',
    build: () => buildProject('Nano ESP32 WiFi 스캔 (코드)', () => ({
      codeMode: 'manual', code: `from machine import Pin
import network, time

# Arduino Nano ESP32: D13(LED) = GPIO48, A0 = GPIO1
led = Pin(48, Pin.OUT)
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
for ssid, bssid, ch, rssi, auth, hidden in wlan.scan():
    print('AP:', ssid.decode(), 'ch', ch, 'rssi', rssi)

wlan.connect('MyWiFi', 'password')
while not wlan.isconnected():
    led.value(not led.value())
    time.sleep_ms(100)
print('IP:', wlan.ifconfig()[0])

while True:
    led.value(1)
    time.sleep_ms(100)
    led.value(0)
    time.sleep_ms(900)
`,
    }), 'nanoesp32'),
  },
);

// ---------------- RP2040-Zero 예제 ----------------
EXAMPLES.push(
  {
    group: '🟩 Waveshare RP2040-Zero', board: 'rp2040zero',
    name: 'Ⓩ① 내장 RGB LED 신호등', desc: 'GP16 WS2812 RGB LED로 빨강 → 노랑 → 초록 반복 (외부 부품 없음)',
    build: () => buildProject('RP2040-Zero 신호등', E => {
      const loop = E.node('ev_loop', 760, 40, { delay: 0 });
      const seq = [[255, 0, 0, 1000], [255, 140, 0, 500], [0, 255, 0, 1000]];
      const ids = [loop];
      seq.forEach(([r, g, b, ms], i) => {
        const c = E.node('board_rgb', 940 + i * 360, 40);
        Object.assign(nodeSt(E, c), { r, g, b });
        const w = E.node('wait', 1120 + i * 360, 40);
        Object.assign(nodeSt(E, w), { ms });
        ids.push(c, w);
      });
      E.flow(...ids);
    }, 'rp2040zero'),
  },
  {
    board: 'rp2040zero',
    name: 'Ⓩ② BOOT 버튼 → RGB LED', desc: '보드의 BOOT 버튼을 누르는 동안 RGB LED 파랑 (rp2.bootsel_button)',
    build: () => buildProject('RP2040-Zero BOOT 버튼', E => {
      const loop = E.node('ev_loop', 760, 40, { delay: 20 });
      const iff = E.node('if', 940, 40);
      const on = E.node('board_rgb', 1140, 0), off = E.node('board_rgb', 1140, 200);
      Object.assign(nodeSt(E, on), { r: 0, g: 0, b: 255 }); Object.assign(nodeSt(E, off), { r: 0, g: 0, b: 0 });
      E.flow(loop, iff);
      E.w(iff + ':then', on + ':in'); E.w(iff + ':else', off + ':in');
      const bs = E.node('bootsel', 760, 200);
      E.data(bs + '.p', iff + '.cond');
    }, 'rp2040zero'),
  },
  {
    board: 'rp2040zero',
    name: 'Ⓩ③ 가변저항(GP29 ADC3) → 서보', desc: 'Pico에는 없는 ADC3(GP29) 핀으로 가변저항을 읽어 GP0 서보 제어',
    build: () => buildProject('RP2040-Zero 서보', E => {
      const pot = E.dev('pot', 120, 60, { flip: true });
      const sv = E.dev('servo', 740, 60);
      E.hw(pot, { VCC: '3V3', GND: 'GND', OUT: 29 });
      E.hw(sv, { GND: 'GND2', VCC: '5V', SIG: 0 });
      const loop = E.node('ev_loop', 1000, 40, { delay: 20 });
      const m = E.node('m_servo', 1180, 40);
      const a = E.node('m_analog', 1000, 200);
      const map = E.node('map', 1180, 200);
      E.flow(loop, m);
      E.ref(sv, m); E.ref(pot, a);
      E.data(a + '.value', map + '.x');
      Object.assign(nodeSt(E, map), { b: 100, d: 180 });
      E.data(map + '.r', m + '.angle');
    }, 'rp2040zero'),
  },
  {
    board: 'rp2040zero',
    name: 'Ⓩ④ AHT20 온습도 → OLED', desc: 'I2C0(SDA GP4 / SCL GP5)에 AHT20과 SSD1306 OLED 연결',
    build: () => buildProject('RP2040-Zero AHT20 OLED', E => {
      const oled = E.dev('oled', 740, 40);
      const aht = E.dev('aht20', 740, 300);
      E.hw(oled, { GND: 'GND2', VCC: '3V3', SCL: 5, SDA: 4 });
      E.hw(aht, { VIN: '3V3', GND: 'GND2', SCL: 5, SDA: 4 });
      const loop = E.node('ev_loop', 1040, 40, { delay: 1000 });
      const c = E.node('m_oled_clear', 1210, 40);
      const t1 = E.node('m_oled_text', 1380, 40), t2 = E.node('m_oled_text', 1580, 40);
      const s = E.node('m_oled_show', 1780, 40);
      E.flow(loop, c, t1, t2, s);
      [c, t1, t2, s].forEach(n => E.ref(oled, n));
      const a = E.node('m_aht', 1040, 250);
      E.ref(aht, a);
      const j1 = E.node('join', 1220, 240), j2 = E.node('join', 1220, 340);
      Object.assign(nodeSt(E, j1), { a: 'Temp: ' }); Object.assign(nodeSt(E, j2), { a: 'Humi: ' });
      E.data(a + '.t', j1 + '.b'); E.data(a + '.h', j2 + '.b');
      E.data(j1 + '.r', t1 + '.text'); E.data(j2 + '.r', t2 + '.text');
      Object.assign(nodeSt(E, t1), { y: 16 }); Object.assign(nodeSt(E, t2), { y: 36 });
    }, 'rp2040zero'),
  },
  {
    board: 'rp2040zero',
    name: 'Ⓩ⑤ [코드] RGB 무지개 + BOOT 밝기', desc: 'Python 직접 작성: 내장 RGB LED 무지개, BOOT 버튼으로 밝기 전환',
    build: () => buildProject('RP2040-Zero 무지개 (코드)', () => ({
      codeMode: 'manual', code: `from machine import Pin
import neopixel, rp2, time

led = neopixel.NeoPixel(Pin(16), 1)   # RP2040-Zero 내장 WS2812


def wheel(p):
    p %= 255
    if p < 85:
        return (255 - p * 3, p * 3, 0)
    if p < 170:
        p -= 85
        return (0, 255 - p * 3, p * 3)
    p -= 170
    return (p * 3, 0, 255 - p * 3)


bright = 1.0
i = 0
while True:
    if rp2.bootsel_button():
        bright = 0.15 if bright == 1.0 else 1.0
        print('밝기:', bright)
        while rp2.bootsel_button():
            time.sleep_ms(10)
    r, g, b = wheel(i)
    led[0] = (int(r * bright), int(g * bright), int(b * bright))
    led.write()
    i += 3
    time.sleep_ms(20)
`,
    }), 'rp2040zero'),
  },
);

// ---------------- ESP32 예제 ----------------
EXAMPLES.push(
  {
    group: '📡 ESP32 DevKitC',
    name: 'Ⓔ① WiFi 연결 + LED 깜빡이기', desc: 'WiFi에 접속한 뒤 보드 LED(GPIO2)를 깜빡임',
    build: () => buildProject('ESP32 WiFi 블링크', E => {
      const st = E.node('ev_start', 800, 40);
      const wf = E.node('esp_wifi', 980, 40);
      const loop = E.node('ev_loop', 800, 220, { delay: 0 });
      const t = E.node('onboard_toggle', 980, 220);
      const w = E.node('wait', 1160, 220);
      E.flow(st, wf); E.flow(loop, t, w);
    }, 'esp32'),
  },
  {
    name: 'Ⓔ② DHT22 → LCD1602', desc: 'DHT22(GPIO4) 온습도를 I2C LCD(SDA 21 / SCL 22)에 표시',
    build: () => buildProject('ESP32 DHT22 LCD', E => {
      const dht = E.dev('dht22', 790, 300);
      const lcd = E.dev('lcd', 790, 60);
      E.hw(dht, { VCC: '3V3', DATA: 4, GND: 'GND' });
      E.hw(lcd, { GND: 'GND3', VCC: '5V', SDA: 21, SCL: 22 });
      const loop = E.node('ev_loop', 1080, 40, { delay: 2000 });
      const p1 = E.node('m_lcd_print', 1260, 40), p2 = E.node('m_lcd_print', 1470, 40);
      E.flow(loop, p1, p2);
      E.ref(lcd, p1); E.ref(lcd, p2);
      Object.assign(nodeSt(E, p2), { row: 1 });
      const d = E.node('m_dht', 1080, 260);
      E.ref(dht, d);
      const j1 = E.node('join', 1260, 250), j2 = E.node('join', 1260, 350);
      Object.assign(nodeSt(E, j1), { a: 'Temp: ' }); Object.assign(nodeSt(E, j2), { a: 'Humi: ' });
      E.data(d + '.t', j1 + '.b'); E.data(d + '.h', j2 + '.b');
      E.data(j1 + '.r', p1 + '.text'); E.data(j2 + '.r', p2 + '.text');
    }, 'esp32'),
  },
  {
    name: 'Ⓔ③ 가변저항 → 서보', desc: 'ADC1(GPIO34) 가변저항으로 GPIO13 서보 제어',
    build: () => buildProject('ESP32 서보', E => {
      const pot = E.dev('pot', 110, 60, { flip: true });
      const sv = E.dev('servo', 110, 300, { flip: true });
      E.hw(pot, { VCC: '3V3', GND: 'GND2', OUT: 34 });
      E.hw(sv, { GND: 'GND2', VCC: '5V', SIG: 13 });
      const loop = E.node('ev_loop', 800, 40, { delay: 20 });
      const m = E.node('m_servo', 980, 40);
      const a = E.node('m_analog', 800, 200);
      const map = E.node('map', 980, 200);
      E.flow(loop, m);
      E.ref(sv, m); E.ref(pot, a);
      E.data(a + '.value', map + '.x');
      Object.assign(nodeSt(E, map), { b: 100, d: 180 });
      E.data(map + '.r', m + '.angle');
    }, 'esp32'),
  },
  {
    name: 'Ⓔ④ 터치 센서 → 네오픽셀', desc: 'GPIO15 터치(버튼으로 손가락 흉내) 시 WS2812(GPIO5) 빨강',
    build: () => buildProject('ESP32 터치 네오픽셀', E => {
      const np = E.dev('neopixel', 790, 330);
      const btn = E.dev('button', 790, 470, { name: 'finger' });
      E.hw(np, { DIN: 5, VCC: '5V', GND: 'GND3' });
      E.hw(btn, { A: 15, B: 'GND3' });
      const loop = E.node('ev_loop', 1060, 40, { delay: 50 });
      const iff = E.node('if', 1240, 40);
      const on = E.node('m_np_fill', 1440, 0), off = E.node('m_np_fill', 1440, 230);
      E.flow(loop, iff);
      E.w(iff + ':then', on + ':in'); E.w(iff + ':else', off + ':in');
      E.ref(np, on); E.ref(np, off);
      Object.assign(nodeSt(E, on), { r: 255, g: 0, b: 0 }); Object.assign(nodeSt(E, off), { r: 0, g: 0, b: 0 });
      const t = E.node('esp_touch', 1060, 230, {});
      Object.assign(nodeSt(E, t), { pin: '15' });
      E.data(t + '.t', iff + '.cond');
    }, 'esp32'),
  },
  {
    name: 'Ⓔ⑤ [코드] WiFi 스캔 + 타이머', desc: 'Python 직접 작성: 주변 AP 검색, 하드웨어 타이머로 LED 토글',
    build: () => buildProject('ESP32 WiFi 스캔 (코드)', () => ({
      codeMode: 'manual', code: `from machine import Pin, Timer
import network, esp32, time

led = Pin(2, Pin.OUT)
wlan = network.WLAN(network.STA_IF)
wlan.active(True)
for ssid, bssid, ch, rssi, auth, hidden in wlan.scan():
    print('AP:', ssid.decode(), 'ch', ch, 'rssi', rssi)

wlan.connect('MyWiFi', 'password')
while not wlan.isconnected():
    time.sleep_ms(200)
print('IP:', wlan.ifconfig()[0])

tim = Timer(0)
tim.init(period=300, mode=Timer.PERIODIC, callback=lambda t: led.value(not led.value()))
while True:
    print('칩 온도(°F):', esp32.raw_temperature())
    time.sleep(2)
`,
    }), 'esp32'),
  },
);

// ---------------- micro:bit 예제 ----------------
EXAMPLES.push(
  {
    group: '🟦 BBC micro:bit V2',
    name: 'Ⓜ① 버튼으로 표정 바꾸기', desc: '버튼 A=웃음, B=슬픔, 흔들면 소리 (내장 기능만 사용)',
    build: () => buildProject('micro:bit 표정', E => {
      const st = E.node('ev_start', 1000, 40);
      const sc = E.node('mb_scroll', 1180, 40);
      Object.assign(nodeSt(E, sc), { text: 'Hi!' });
      E.flow(st, sc);
      const a = E.node('ev_mb_button', 1000, 150, { btn: 'a' });
      const ia = E.node('mb_image', 1200, 150, { img: 'HAPPY' });
      E.flow(a, ia);
      const b = E.node('ev_mb_button', 1000, 270, { btn: 'b' });
      const ib = E.node('mb_image', 1200, 270, { img: 'SAD' });
      E.flow(b, ib);
      const g = E.node('ev_mb_gesture', 1000, 390, { g: 'shake' });
      const m = E.node('mb_melody', 1200, 390, { m: 'BA_DING', wait: 'False' });
      const ic = E.node('mb_image', 1400, 390, { img: 'SURPRISED' });
      E.flow(g, m, ic);
    }, 'microbit'),
  },
  {
    name: 'Ⓜ② 기울기 수평계', desc: '가속도 센서로 기울어진 쪽에 LED 점 표시',
    build: () => buildProject('micro:bit 수평계', E => {
      const loop = E.node('ev_loop', 1000, 40, { delay: 50 });
      const cl = E.node('mb_clear', 1180, 40);
      const pl = E.node('mb_plot', 1360, 40);
      E.flow(loop, cl, pl);
      const ac = E.node('mb_accel', 1000, 200);
      const mx = E.node('map', 1180, 180), my = E.node('map', 1180, 350);
      for (const m of [mx, my]) Object.assign(nodeSt(E, m), { a: -1024, b: 1024, c: 0, d: 4 });
      const rx = E.node('mathfn', 1360, 200, { fn: 'round' }), ry = E.node('mathfn', 1360, 300, { fn: 'round' });
      E.data(ac + '.x', mx + '.x'); E.data(ac + '.y', my + '.x');
      E.data(mx + '.r', rx + '.x'); E.data(my + '.r', ry + '.x');
      E.data(rx + '.r', pl + '.x'); E.data(ry + '.r', pl + '.y');
    }, 'microbit'),
  },
  {
    name: 'Ⓜ③ 가변저항 → 서보', desc: '엣지 커넥터 P0(아날로그) 가변저항으로 P1 서보 제어',
    build: () => buildProject('micro:bit 서보', E => {
      const pot = E.dev('pot', 360, 520);
      const sv = E.dev('servo', 620, 520);
      E.hw(pot, { VCC: '3V', GND: 'GND', OUT: 0 });
      E.hw(sv, { GND: 'GND', VCC: '3V', SIG: 1 });
      const loop = E.node('ev_loop', 1000, 40, { delay: 20 });
      const m = E.node('m_servo', 1180, 40);
      const a = E.node('m_analog', 1000, 200);
      const map = E.node('map', 1180, 200);
      E.flow(loop, m);
      E.ref(sv, m); E.ref(pot, a);
      E.data(a + '.value', map + '.x');
      Object.assign(nodeSt(E, map), { b: 100, d: 180 });
      E.data(map + '.r', m + '.angle');
    }, 'microbit'),
  },
  {
    name: 'Ⓜ④ 내장 센서 → OLED', desc: '온도·빛 센서 값을 I2C OLED(P19/P20)에 표시',
    build: () => buildProject('micro:bit OLED', E => {
      const oled = E.dev('oled', 560, 520);
      E.hw(oled, { GND: 'GND', VCC: '3V', SCL: 19, SDA: 20 });
      const loop = E.node('ev_loop', 1000, 40, { delay: 1000 });
      const c = E.node('m_oled_clear', 1170, 40);
      const t1 = E.node('m_oled_text', 1340, 40), t2 = E.node('m_oled_text', 1540, 40);
      const s = E.node('m_oled_show', 1740, 40);
      E.flow(loop, c, t1, t2, s);
      [c, t1, t2, s].forEach(n => E.ref(oled, n));
      const sen = E.node('mb_sensors', 1000, 250);
      const j1 = E.node('join', 1180, 240), j2 = E.node('join', 1180, 340);
      Object.assign(nodeSt(E, j1), { a: 'Temp: ' }); Object.assign(nodeSt(E, j2), { a: 'Light: ' });
      E.data(sen + '.t', j1 + '.b'); E.data(sen + '.l', j2 + '.b');
      E.data(j1 + '.r', t1 + '.text'); E.data(j2 + '.r', t2 + '.text');
      Object.assign(nodeSt(E, t1), { y: 16 }); Object.assign(nodeSt(E, t2), { y: 36 });
    }, 'microbit'),
  },
  {
    name: 'Ⓜ⑤ [코드] 반응 속도 게임', desc: 'Python 직접 작성: 화면이 켜지면 A 버튼을 빨리 누르기',
    build: () => buildProject('micro:bit 반응속도 (코드)', () => ({
      codeMode: 'manual', code: `from microbit import *
import music
import random

display.scroll('READY')
while True:
    display.clear()
    sleep(random.randint(1000, 3000))
    display.show(Image.TARGET)
    start = running_time()
    while not button_a.is_pressed():
        sleep(1)
    ms = running_time() - start
    music.pitch(880, 100)
    print('반응 시간:', ms, 'ms')
    display.scroll(str(ms))
    sleep(500)
`,
    }), 'microbit'),
  },
);
