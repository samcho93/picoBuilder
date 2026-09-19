// 예제 프로젝트
'use strict';

function buildProject(name, fn) {
  const nodes = [{ id: 'pico', type: 'pico', name: 'pico', x: 430, y: 40, st: {} }];
  const wires = [];
  let seq = 1;
  const counts = {};
  const api = {
    _find: id => nodes.find(n => n.id === id),
    P(p) {
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
  return { version: 1, name, circuit: { nodes, wires, seq }, ...extra };
}

const EXAMPLES = [
  {
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
