// 노드 그래프 → Arduino C++(.ino) 코드 생성 (ATmega328P: Uno / Nano)
// 시뮬레이션은 같은 그래프로 만든 MicroPython 코드를 사용합니다 (nodes.js).
'use strict';

const AVR_PWM_PINS = [3, 5, 6, 9, 10, 11];
const cppStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n') + '"';
const cppNum = v => { const x = Number(v); return Number.isFinite(x) ? String(x) : '0'; };
function cppLit(t, v) {
  if (t === 'number') return cppNum(v);
  if (t === 'bool') return v === false || v === 'False' || v === 0 || v === '0' ? 'false' : 'true';
  if (t === 'string') return cppStr(v ?? '');
  if (v === true || v === false) return v ? 'true' : 'false';
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) return cppNum(v);
  return cppStr(v ?? '');
}
const cppInd = (lines, n = 1) => (lines.length ? lines : []).map(l => '  '.repeat(n) + l);

// ---------------- 모듈(장치) → C++ ----------------
const CPP_DEV = {
  led: (n, C) => {
    const g = C.gpio('+') ?? C.gpio('-');
    if (g == null) return C.warn('+ 핀을 디지털 핀에 연결하세요');
    C.meta.inv = C.gpio('+') == null;
    C.global(`const int ${n.name} = ${C.code(g)};`);
    C.setup(`pinMode(${n.name}, OUTPUT);`);
  },
  relay: (n, C) => CPP_DEV.led(n, { ...C, gpio: p => C.gpio(p === '+' ? 'IN' : p) }),
  rgb: (n, C) => {
    for (const p of ['R', 'G', 'B']) {
      const g = C.gpio(p);
      if (g == null) { C.warn(`${p} 핀을 연결하세요`); continue; }
      if (!AVR_PWM_PINS.includes(g)) C.warn(`${C.code(g)}은 PWM 핀이 아닙니다 (D3, D5, D6, D9, D10, D11)`);
      C.global(`const int ${n.name}_${p.toLowerCase()} = ${C.code(g)};`);
      C.setup(`pinMode(${n.name}_${p.toLowerCase()}, OUTPUT);`);
    }
  },
  button: (n, C) => {
    const gA = C.gpio('A'), gB = C.gpio('B');
    const g = gA ?? gB;
    if (g == null) return C.warn('A 또는 B 핀을 디지털 핀에 연결하세요');
    const other = gA != null ? 'B' : 'A';
    const k = C.kind(other);
    if (k !== 'gnd') C.warn(`${other} 핀을 GND에 연결하세요 (Arduino는 내부 풀다운이 없어 풀업 방식만 지원)`);
    C.meta.activeLow = true;
    C.global(`const int ${n.name} = ${C.code(g)};`);
    C.setup(`pinMode(${n.name}, INPUT_PULLUP);`);
  },
  switch: (n, C) => CPP_DEV.button(n, C),
  pot: (n, C) => CPP_DEV._analog(n, C, 'OUT'),
  ldr: (n, C) => CPP_DEV._analog(n, C, 'AO'),
  _analog: (n, C, pin) => {
    const g = C.gpio(pin);
    if (g == null) return C.warn(`${pin} 핀을 아날로그 핀(A0~)에 연결하세요`);
    if (g < 14) C.warn(`${C.code(g)}은 아날로그 입력 핀이 아닙니다 (A0~A5 사용)`);
    C.global(`const int ${n.name} = ${C.code(g)};`);
  },
  joystick: (n, C) => {
    for (const [p, s] of [['VRx', '_x'], ['VRy', '_y']]) {
      const g = C.gpio(p);
      if (g == null || g < 14) { C.warn(`${p} 핀을 아날로그 핀(A0~)에 연결하세요`); continue; }
      C.global(`const int ${n.name}${s} = ${C.code(g)};`);
    }
    const sw = C.gpio('SW');
    if (sw != null) { C.global(`const int ${n.name}_sw = ${C.code(sw)};`); C.setup(`pinMode(${n.name}_sw, INPUT_PULLUP);`); }
  },
  buzzer: (n, C) => {
    const g = C.gpio('+');
    if (g == null) return C.warn('+ 핀을 디지털 핀에 연결하세요');
    C.global(`const int ${n.name} = ${C.code(g)};`);
  },
  servo: (n, C) => {
    const g = C.gpio('SIG');
    if (g == null) return C.warn('SIG 핀을 디지털 핀에 연결하세요');
    C.inc('Servo.h');
    C.lib('Servo (Arduino 기본 포함)');
    C.global(`Servo ${n.name};`);
    C.setup(`${n.name}.attach(${C.code(g)});`);
  },
  pir: (n, C) => {
    const g = C.gpio('OUT');
    if (g == null) return C.warn('OUT 핀을 디지털 핀에 연결하세요');
    C.global(`const int ${n.name} = ${C.code(g)};`);
    C.setup(`pinMode(${n.name}, INPUT);`);
  },
  neopixel: (n, C) => {
    const g = C.gpio('DIN');
    if (g == null) return C.warn('DIN 핀을 디지털 핀에 연결하세요');
    C.inc('Adafruit_NeoPixel.h');
    C.lib('Adafruit NeoPixel');
    C.global(`Adafruit_NeoPixel ${n.name}(${n.st.count}, ${C.code(g)}, NEO_GRB + NEO_KHZ800);`);
    C.setup(`${n.name}.begin();`, `${n.name}.show();`);
  },
  dht11: (n, C) => CPP_DEV._dht(n, C, 'DHT11'),
  dht22: (n, C) => CPP_DEV._dht(n, C, 'DHT22'),
  _dht: (n, C, kind) => {
    const g = C.gpio('DATA');
    if (g == null) return C.warn('DATA 핀을 디지털 핀에 연결하세요');
    C.inc('DHT.h');
    C.lib('DHT sensor library (Adafruit)');
    C.global(`DHT ${n.name}(${C.code(g)}, ${kind});`);
    C.setup(`${n.name}.begin();`);
  },
  ds18b20: (n, C) => {
    const g = C.gpio('DQ');
    if (g == null) return C.warn('DQ 핀을 디지털 핀에 연결하세요');
    C.inc('OneWire.h'); C.inc('DallasTemperature.h');
    C.lib('OneWire', 'DallasTemperature');
    C.global(`OneWire ${n.name}_wire(${C.code(g)});`, `DallasTemperature ${n.name}(&${n.name}_wire);`);
    C.setup(`${n.name}.begin();`);
  },
  hcsr04: (n, C) => {
    const t = C.gpio('TRIG'), e = C.gpio('ECHO');
    if (t == null || e == null) return C.warn('TRIG/ECHO 핀을 디지털 핀에 연결하세요');
    C.global(`const int ${n.name}_trig = ${C.code(t)};`, `const int ${n.name}_echo = ${C.code(e)};`);
    C.setup(`pinMode(${n.name}_trig, OUTPUT);`, `pinMode(${n.name}_echo, INPUT);`);
  },
  oled: (n, C) => {
    if (!C.i2c()) return;
    C.inc('Adafruit_GFX.h'); C.inc('Adafruit_SSD1306.h');
    C.lib('Adafruit SSD1306', 'Adafruit GFX Library');
    C.global(`Adafruit_SSD1306 ${n.name}(128, 64, &Wire, -1);`);
    C.setup(`${n.name}.begin(SSD1306_SWITCHCAPVCC, 0x${(+n.st.addr).toString(16).toUpperCase()});`,
      `${n.name}.setTextSize(1);`, `${n.name}.setTextColor(SSD1306_WHITE);`, `${n.name}.clearDisplay();`, `${n.name}.display();`);
  },
  lcd: (n, C) => {
    if (!C.i2c()) return;
    C.inc('LiquidCrystal_I2C.h');
    C.lib('LiquidCrystal I2C');
    C.global(`LiquidCrystal_I2C ${n.name}(0x${(+n.st.addr).toString(16).toUpperCase()}, 16, 2);`);
    C.setup(`${n.name}.init();`, `${n.name}.backlight();`);
  },
  aht20: (n, C) => {
    if (!C.i2c()) return;
    C.inc('Adafruit_AHTX0.h');
    C.lib('Adafruit AHTX0');
    C.global(`Adafruit_AHTX0 ${n.name};`);
    C.setup(`${n.name}.begin();`);
  },
  mpu6050: (n, C) => {
    if (!C.i2c()) return;
    C.inc('Adafruit_MPU6050.h'); C.inc('Adafruit_Sensor.h');
    C.lib('Adafruit MPU6050', 'Adafruit Unified Sensor');
    C.global(`Adafruit_MPU6050 ${n.name};`);
    C.setup(`${n.name}.begin();`);
  },
  bh1750: (n, C) => {
    if (!C.i2c()) return;
    C.inc('BH1750.h');
    C.lib('BH1750 (claws)');
    C.global(`BH1750 ${n.name};`);
    C.setup(`${n.name}.begin();`);
  },
  ds3231: (n, C) => {
    if (!C.i2c()) return;
    C.inc('RTClib.h');
    C.lib('RTClib (Adafruit)');
    C.global(`RTC_DS3231 ${n.name};`);
    C.setup(`${n.name}.begin();`);
  },
  max7219: (n, C) => {
    const din = C.gpio('DIN'), clk = C.gpio('CLK'), cs = C.gpio('CS');
    if (din == null || clk == null || cs == null) return C.warn('DIN/CLK/CS 핀을 연결하세요');
    C.inc('LedControl.h');
    C.lib('LedControl');
    C.global(`LedControl ${n.name}(${C.code(din)}, ${C.code(clk)}, ${C.code(cs)}, 1);`);
    C.setup(`${n.name}.shutdown(0, false);`, `${n.name}.setIntensity(0, 3);`, `${n.name}.clearDisplay(0);`);
  },
  mcp3008: (n, C) => {
    const cs = C.gpio('CS');
    if (cs == null) return C.warn('CS 핀을 연결하세요');
    C.spiCheck();
    C.inc('Adafruit_MCP3008.h');
    C.lib('Adafruit MCP3008');
    C.global(`Adafruit_MCP3008 ${n.name};`);
    C.setup(`${n.name}.begin(${C.code(cs)});`);
  },
  gps: (n, C) => {
    const u = C.softSerial(n, 'TX', 'RX', 9600);
    if (!u) return;
    C.inc('TinyGPSPlus.h');
    C.lib('TinyGPSPlus');
    C.global(`TinyGPSPlus ${n.name};`);
    C.meta.serial = u;
  },
  hc05: (n, C) => {
    const u = C.softSerial(n, 'TXD', 'RXD', 9600);
    if (!u) return;
    C.meta.serial = u;
  },
};

// ---------------- 프로그램 노드 → C++ ----------------
const B2 = (G, n, p) => `(${G.expr(n, p)})`;
const CPP_STMT = {
  wait: (n, G) => [`delay(${G.expr(n, 'ms')});`],
  wait_until: (n, G) => [`while (!${B2(G, n, 'cond')}) { delay(10); }`],
  print: (n, G) => { G.useSerial(); return [`Serial.println(${G.expr(n, 'value')});`]; },
  if: (n, G) => {
    const t = G.chain(n, 'then'), e = G.chain(n, 'else');
    const L = [`if (${G.expr(n, 'cond')}) {`, ...cppInd(t), '}'];
    if (e.length) { L[L.length - 1] = '} else {'; L.push(...cppInd(e), '}'); }
    return L;
  },
  repeat: (n, G) => [`for (long i_${n.id} = 0; i_${n.id} < (long)(${G.expr(n, 'count')}); i_${n.id}++) {`, ...cppInd(G.chain(n, 'body')), '}'],
  for_range: (n, G) => [`for (long i_${n.id} = ${G.expr(n, 'from')}; i_${n.id} < (long)(${G.expr(n, 'to')}); i_${n.id} += (long)(${G.expr(n, 'step')})) {`, ...cppInd(G.chain(n, 'body')), '}'],
  while: (n, G) => [`while (${G.expr(n, 'cond')}) {`, ...cppInd(G.chain(n, 'body')), '}'],
  break: () => ['break;'],
  var_set: (n, G) => [`${G.var(n)} = ${G.expr(n, 'value')};`],
  var_change: (n, G) => [`${G.var(n)} += ${G.expr(n, 'by')};`],
  gpio_write: (n, G) => { const p = G.pinVar(n, 'OUTPUT'); return p ? [`digitalWrite(${p}, ${G.expr(n, 'value')} ? HIGH : LOW);`] : []; },
  gpio_toggle: (n, G) => { const p = G.pinVar(n, 'OUTPUT'); return p ? [`digitalWrite(${p}, !digitalRead(${p}));`] : []; },
  pwm_write: (n, G) => {
    const p = G.pinVar(n, 'OUTPUT', true);
    if (!p) return [];
    return [`analogWrite(${p}, constrain(${G.expr(n, 'duty')}, 0, 100) * 255 / 100);  // PWM 주파수는 보드 기본값(약 490Hz) 고정`];
  },
  onboard_led: (n, G) => { G.ledPin(); return [`digitalWrite(LED_BUILTIN, ${G.expr(n, 'value')} ? HIGH : LOW);`]; },
  onboard_toggle: (n, G) => { G.ledPin(); return ['digitalWrite(LED_BUILTIN, !digitalRead(LED_BUILTIN));'] },
  m_led: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    const v = G.expr(n, 'on');
    return [`digitalWrite(${d.name}, ${G.meta(d).inv ? `!(${v})` : v} ? HIGH : LOW);`];
  },
  m_led_toggle: (n, G) => { const d = G.dev(n); return d ? [`digitalWrite(${d.name}, !digitalRead(${d.name}));`] : []; },
  m_rgb: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return ['r', 'g', 'b'].map(c => `analogWrite(${d.name}_${c}, constrain(${G.expr(n, c)}, 0, 255));`);
  },
  m_buzzer: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    const ms = G.expr(n, 'ms');
    return [`tone(${d.name}, ${G.expr(n, 'freq')}, ${ms});`, `delay(${ms});`];
  },
  m_buzzer_off: (n, G) => { const d = G.dev(n); return d ? [`noTone(${d.name});`] : []; },
  m_servo: (n, G) => { const d = G.dev(n); return d ? [`${d.name}.write(constrain(${G.expr(n, 'angle')}, 0, 180));`] : []; },
  m_np_fill: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return [`${d.name}.fill(${d.name}.Color(${G.expr(n, 'r')}, ${G.expr(n, 'g')}, ${G.expr(n, 'b')}));`, `${d.name}.show();`];
  },
  m_np_set: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return [`${d.name}.setPixelColor(((long)(${G.expr(n, 'i')})) % ${d.name}.numPixels(), ${d.name}.Color(${G.expr(n, 'r')}, ${G.expr(n, 'g')}, ${G.expr(n, 'b')}));`];
  },
  m_np_show: (n, G) => { const d = G.dev(n); return d ? [`${d.name}.show();`] : []; },
  m_np_rainbow: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    G.helper('wheel', 'uint32_t wheelColor(Adafruit_NeoPixel &np, int p) {\n  p = p % 255;\n  if (p < 85) return np.Color(255 - p * 3, p * 3, 0);\n  if (p < 170) { p -= 85; return np.Color(0, 255 - p * 3, p * 3); }\n  p -= 170;\n  return np.Color(p * 3, 0, 255 - p * 3);\n}');
    return [`for (int k = 0; k < ${d.name}.numPixels(); k++) {`,
      `  ${d.name}.setPixelColor(k, wheelColor(${d.name}, k * 255 / ${d.name}.numPixels() + (int)(${G.expr(n, 'off')})));`,
      '}', `${d.name}.show();`];
  },
  m_oled_clear: (n, G) => { const d = G.dev(n); return d ? [`${d.name}.clearDisplay();`] : []; },
  m_oled_show: (n, G) => { const d = G.dev(n); return d ? [`${d.name}.display();`] : []; },
  m_oled_text: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return [`${d.name}.setCursor(${G.expr(n, 'x')}, ${G.expr(n, 'y')});`, `${d.name}.print(${G.expr(n, 'text')});`];
  },
  m_oled_shape: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    const a = ['x', 'y', 'w', 'h'].map(p => G.expr(n, p));
    const s = n.st.shape || 'rect';
    if (s === 'pixel') return [`${d.name}.drawPixel(${a[0]}, ${a[1]}, SSD1306_WHITE);`];
    if (s === 'line') return [`${d.name}.drawLine(${a.join(', ')}, SSD1306_WHITE);`];
    return [`${d.name}.${s === 'fill_rect' ? 'fillRect' : 'drawRect'}(${a.join(', ')}, SSD1306_WHITE);`];
  },
  m_lcd_clear: (n, G) => { const d = G.dev(n); return d ? [`${d.name}.clear();`] : []; },
  m_lcd_print: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return [`${d.name}.setCursor(${G.expr(n, 'col')}, ${G.expr(n, 'row')});`, `${d.name}.print(${G.expr(n, 'text')});`];
  },
  m_lcd_bl: (n, G) => { const d = G.dev(n); return d ? [`if (${G.expr(n, 'on')}) ${d.name}.backlight(); else ${d.name}.noBacklight();`] : []; },
  m_mtx_show: (n, G) => { const d = G.dev(n); return d ? (n.st.act === 'clear' ? [`${d.name}.clearDisplay(0);`] : ['// LedControl은 즉시 출력되므로 별도 표시 동작이 없습니다']) : []; },
  m_mtx_pixel: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    return [`${d.name}.setLed(0, ${G.expr(n, 'y')}, ${G.expr(n, 'x')}, ${G.expr(n, 'on')});`];
  },
  m_mtx_icon: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    const I = { heart: '0066FFFFFF7E3C18', smile: '3C4281A58199423C', sad: '3C4281A599A5423C', up: '183C7EFF18181818', down: '18181818FF7E3C18', x: '8142241818244281', check: '0001030706CC7830' };
    G.helper('mtxIcon', 'void mtxIcon(LedControl &m, const char *rows) {\n  for (int y = 0; y < 8; y++) {\n    char b[3] = { rows[y * 2], rows[y * 2 + 1], 0 };\n    m.setRow(0, y, (byte) strtol(b, NULL, 16));\n  }\n}');
    return [`mtxIcon(${d.name}, ${cppStr(I[n.st.icon || 'heart'])});`];
  },
  m_uart_send: (n, G) => { const d = G.dev(n); return d ? [`${G.meta(d).serial}.println(${G.expr(n, 'text')});`] : []; },
  m_rtc_set: (n, G) => {
    const d = G.dev(n); if (!d) return [];
    const e = p => `(int)(${G.expr(n, p)})`;
    return [`${d.name}.adjust(DateTime(${e('y')}, ${e('mo')}, ${e('d')}, ${e('h')}, ${e('mi')}, ${e('s')}));`];
  },
};

const CPP_EXPR = {
  num: n => cppNum(n.st.v),
  str: n => cppStr(n.st.v ?? ''),
  bool: n => n.st.v === 'False' ? 'false' : 'true',
  math: (n, G) => {
    const a = G.expr(n, 'a'), b = G.expr(n, 'b'), op = n.st.op || '+';
    if (op === '//') return `((long)(${a}) / (long)(${b}))`;
    if (op === '%') return `((long)(${a}) % (long)(${b}))`;
    if (op === '**') return `pow(${a}, ${b})`;
    return `${a} ${op} ${b}`;
  },
  mathfn: (n, G) => {
    const x = G.expr(n, 'x');
    const f = { round: `round(${x})`, int: `((long)(${x}))`, abs: `abs(${x})`, 'math.sqrt': `sqrt(${x})`, 'math.sin': `sin(${x})`, 'math.cos': `cos(${x})`, 'math.floor': `floor(${x})`, 'math.ceil': `ceil(${x})`, float: `((float)(${x}))` };
    return f[n.st.fn || 'round'] || `round(${x})`;
  },
  map: (n, G) => {
    G.helper('mapRange', 'float mapRange(float x, float a, float b, float c, float d) {\n  return (x - a) * (d - c) / (b - a) + c;\n}');
    return `mapRange(${['x', 'a', 'b', 'c', 'd'].map(p => G.expr(n, p)).join(', ')})`;
  },
  constrain: (n, G) => `constrain(${G.expr(n, 'x')}, ${G.expr(n, 'lo')}, ${G.expr(n, 'hi')})`,
  random: (n, G) => `random((long)(${G.expr(n, 'lo')}), (long)(${G.expr(n, 'hi')}) + 1)`,
  compare: (n, G) => `${G.expr(n, 'a')} ${n.st.op || '>'} ${G.expr(n, 'b')}`,
  logic: (n, G) => `${G.expr(n, 'a')} ${(n.st.op || 'and') === 'or' ? '||' : '&&'} ${G.expr(n, 'b')}`,
  not: (n, G) => `!${B2(G, n, 'a')}`,
  select: (n, G) => `(${G.expr(n, 'cond')} ? ${G.expr(n, 'a')} : ${G.expr(n, 'b')})`,
  join: (n, G) => `String(${G.expr(n, 'a')}) + String(${G.expr(n, 'b')})`,
  format: (n, G) => `String(${G.expr(n, 'x')}, ${Math.max(0, parseInt(n.st.d ?? 1) || 0)})`,
  ticks: () => 'millis()',
  elapsed: (n, G) => `(${G.expr(n, 'now')} - ${G.expr(n, 'prev')})`,
  var_get: (n, G) => G.var(n),
  repeat: n => `i_${n.id}`,
  for_range: n => `i_${n.id}`,
  gpio_read: (n, G) => { const p = G.pinVar(n, n.st.pull === 'PULL_UP' ? 'INPUT_PULLUP' : 'INPUT'); return p ? `(digitalRead(${p}) == HIGH)` : 'false'; },
  adc_read: (n, G) => {
    const p = G.pinVar(n, null);
    if (p == null) return '0';
    return G.analog(`analogRead(${p})`, n.st.unit);
  },
  cpu_temp: (n, G) => { G.warn(n, 'ATmega328P에는 사용할 수 있는 내부 온도센서가 없습니다 (0 반환)'); return '0'; },
  m_button: (n, G) => { const d = G.dev(n); return d ? `(digitalRead(${d.name}) == LOW)` : 'false'; },
  m_pir: (n, G) => { const d = G.dev(n); return d ? `(digitalRead(${d.name}) == HIGH)` : 'false'; },
  m_analog: (n, G) => { const d = G.dev(n); return d ? G.analog(`analogRead(${d.name})`, n.st.unit || 'pct') : '0'; },
  m_joystick: (n, G, port) => {
    const d = G.dev(n); if (!d) return '0';
    if (port === 'sw') return `(digitalRead(${d.name}_sw) == LOW)`;
    return `map(analogRead(${d.name}_${port}), 0, 1023, -100, 100)`;
  },
  m_dht: (n, G, port) => { const d = G.dev(n); return d ? `${d.name}.${port === 't' ? 'readTemperature()' : 'readHumidity()'}` : '0'; },
  m_ds18: (n, G) => { const d = G.dev(n); return d ? `(${d.name}.requestTemperatures(), ${d.name}.getTempCByIndex(0))` : '0'; },
  m_sonar: (n, G) => {
    const d = G.dev(n); if (!d) return '0';
    G.helper('sonar', 'float distanceCm(int trig, int echo) {\n  digitalWrite(trig, LOW);\n  delayMicroseconds(2);\n  digitalWrite(trig, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(trig, LOW);\n  unsigned long t = pulseIn(echo, HIGH, 30000UL);\n  if (t == 0) return -1;\n  return t / 58.3;\n}');
    return `distanceCm(${d.name}_trig, ${d.name}_echo)`;
  },
  m_aht: (n, G, port) => {
    const d = G.dev(n); if (!d) return '0';
    G.helper('aht', 'float ahtRead(Adafruit_AHTX0 &s, bool wantHum) {\n  sensors_event_t hum, tmp;\n  s.getEvent(&hum, &tmp);\n  return wantHum ? hum.relative_humidity : tmp.temperature;\n}');
    return `ahtRead(${d.name}, ${port === 'h' ? 'true' : 'false'})`;
  },
  m_mpu: (n, G, port) => {
    const d = G.dev(n); if (!d) return '0';
    G.helper('mpu', 'float mpuRead(Adafruit_MPU6050 &s, int idx) {\n  sensors_event_t a, g, t;\n  s.getEvent(&a, &g, &t);\n  float v[6] = { a.acceleration.x / 9.80665, a.acceleration.y / 9.80665, a.acceleration.z / 9.80665,\n                 g.gyro.x * 57.2958, g.gyro.y * 57.2958, g.gyro.z * 57.2958 };\n  return v[idx];\n}');
    return `mpuRead(${d.name}, ${(port[0] === 'a' ? 0 : 3) + 'xyz'.indexOf(port[1])})`;
  },
  m_lux: (n, G) => { const d = G.dev(n); return d ? `${d.name}.readLightLevel()` : '0'; },
  m_mcp: (n, G) => { const d = G.dev(n); return d ? `${d.name}.readADC((int)(${G.expr(n, 'ch')}))` : '0'; },
  m_rtc: (n, G, port) => {
    const d = G.dev(n); if (!d) return '0';
    if (port === 'text' || port === 'date') {
      G.helper('rtcText', 'String rtcText(RTC_DS3231 &r, bool wantDate) {\n  DateTime t = r.now();\n  char buf[12];\n  if (wantDate) sprintf(buf, "%04d-%02d-%02d", t.year(), t.month(), t.day());\n  else sprintf(buf, "%02d:%02d:%02d", t.hour(), t.minute(), t.second());\n  return String(buf);\n}');
      return `rtcText(${d.name}, ${port === 'date' ? 'true' : 'false'})`;
    }
    return `${d.name}.now().${{ h: 'hour', m: 'minute', s: 'second' }[port]}()`;
  },
  m_gps: (n, G, port) => {
    const d = G.dev(n); if (!d) return '0';
    const ser = G.meta(d).serial;
    G.helper('gpsPoll', `void gpsPoll(TinyGPSPlus &g, Stream &s) {\n  while (s.available()) g.encode(s.read());\n}`);
    const poll = `(gpsPoll(${d.name}, ${ser}), `;
    const v = { lat: `${d.name}.location.lat()`, lon: `${d.name}.location.lng()`, sats: `${d.name}.satellites.value()`, fix: `${d.name}.location.isValid()`, time: `String(${d.name}.time.hour()) + ":" + String(${d.name}.time.minute())` }[port];
    return poll + v + ')';
  },
  m_uart_recv: (n, G, port) => {
    const d = G.dev(n); if (!d) return '""';
    const ser = G.meta(d).serial;
    if (port === 'has') return `(${ser}.available() > 0)`;
    G.helper('readLine', 'String readSerialLine(Stream &s) {\n  if (!s.available()) return "";\n  String line = s.readStringUntil(\'\\n\');\n  line.trim();\n  return line;\n}');
    return `readSerialLine(${ser})`;
  },
};

// ---------------- 생성기 ----------------
function generateArduino(graph, sim) {
  sim.invalidate();
  sim.rebuild();
  const boardNode = graph.nodes.find(n => BOARDS[n.type]);
  const bd = BOARDS[boardNode.type];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const into = new Map(), from = new Map();
  for (const w of graph.wires) {
    into.set(w.b, w.a);
    if (!from.has(w.a)) from.set(w.a, []);
    from.get(w.a).push(w.b);
  }
  const warnings = [];
  const warn = (node, msg) => warnings.push({ node: node && node.id, msg: (node ? `[${node.name || NODES[node.type]?.label || node.type}] ` : '') + msg });
  const incs = new Set(), libs = new Set(), globals = [], setupLines = [], helpers = new Map(), metas = new Map();
  const vars = new Map();   // name -> 'float' | 'String'
  const pinDecls = new Map();
  const usedSerial = { on: false };
  const netGpio = t => { const i = sim.netIndex(t); if (i < 0) return null; const g = sim.nets[i].gpios; return g.length ? g[0] : null; };
  const netKind = t => {
    const i = sim.netIndex(t); if (i < 0) return null;
    for (const p of sim.nets[i].pico) {
      if (p.type === 'gnd') return 'gnd';
      if (p.type === 'power') return '3v3';
      if (p.type === 'power5') return '5v';
    }
    return null;
  };
  const code = g => bd.pinCode(g);

  // --- 모듈 설정 ---
  let wireUsed = false;
  for (const n of graph.nodes.filter(x => DEVICES[x.type])) {
    const meta = {};
    metas.set(n.id, meta);
    const T = p => n.id + ':' + p;
    const C = {
      meta, code,
      gpio: p => netGpio(T(p)),
      kind: p => netKind(T(p)),
      warn: m => { warn(n, m); },
      inc: h => incs.add(h),
      lib: (...l) => l.forEach(x => libs.add(x)),
      global: (...l) => globals.push(...l),
      setup: (...l) => setupLines.push(...l),
      i2c() {
        const sda = netGpio(T('SDA')), scl = netGpio(T('SCL'));
        if (sda == null || scl == null) { warn(n, 'SDA/SCL 핀을 연결하세요'); return false; }
        if (sda !== 18 || scl !== 19) { warn(n, `Arduino Uno/Nano의 I2C는 A4(SDA)/A5(SCL) 고정입니다 (현재 ${code(sda)}/${code(scl)})`); return false; }
        if (!wireUsed) { wireUsed = true; incs.add('Wire.h'); setupLines.unshift('Wire.begin();'); }
        return true;
      },
      spiCheck() {
        const d = DEVICES[n.type].spi;
        if (!d) return;
        const sck = netGpio(T(d.sck)), mosi = netGpio(T(d.mosi));
        if (sck != null && sck !== 13) warn(n, `SPI SCK는 D13 고정입니다 (현재 ${code(sck)})`);
        if (mosi != null && mosi !== 11) warn(n, `SPI MOSI는 D11 고정입니다 (현재 ${code(mosi)})`);
      },
      softSerial(node, txPin, rxPin, baud) {
        const rx = netGpio(T(txPin)), tx = netGpio(T(rxPin));   // 모듈 TX → 보드 RX
        if (rx == null && tx == null) { warn(n, `${txPin} → 보드 RX, ${rxPin} → 보드 TX 로 연결하세요`); return null; }
        if (rx === 0 || tx === 1) { warn(n, 'D0/D1은 USB 시리얼과 공유됩니다. 업로드·시리얼 모니터와 충돌하니 다른 핀을 쓰세요'); }
        incs.add('SoftwareSerial.h');
        libs.add('SoftwareSerial (Arduino 기본 포함)');
        const name = node.name + 'Serial';
        globals.push(`SoftwareSerial ${name}(${code(rx ?? 2)}, ${code(tx ?? 3)});  // RX, TX`);
        setupLines.push(`${name}.begin(${baud});`);
        return name;
      },
    };
    const f = CPP_DEV[n.type];
    if (!f) { warn(n, `${DEVICES[n.type].label} 모듈은 Arduino C++ 코드 생성에서 아직 지원되지 않습니다`); continue; }
    try { f(n, C); } catch (e) { warn(n, '코드 생성 오류: ' + e.message); }
  }

  // --- 프로그램 노드 ---
  const depth = { v: 0 };
  const G = {
    warn,
    helper: (k, c) => { if (!helpers.has(k)) helpers.set(k, c); },
    meta: d => metas.get(d.id) || {},
    useSerial: () => { usedSerial.on = true; },
    ledPin: () => { if (!pinDecls.has('led')) { pinDecls.set('led', true); setupLines.push('pinMode(LED_BUILTIN, OUTPUT);'); } },
    analog: (read, unit) => unit === 'volt' ? `(${read} * 5.0 / 1023.0)` : unit === 'raw' ? read : `(${read} * 100L / 1023)`,
    var(n) {
      const v = pyIdent(n.st.name || 'count');
      if (!vars.has(v)) vars.set(v, 'float');
      return v;
    },
    expr(n, port) {
      const src = into.get(n.id + ':' + port);
      const spec = NODES[n.type].ins.find(p => p.n === port);
      if (src) {
        const [sid, sp] = splitTerm(src);
        const sn = byId.get(sid);
        const f = sn && CPP_EXPR[sn.type];
        if (!f) {
          if (sn && NODES[sn.type] && NODES[sn.type].expr) warn(sn, `${NODES[sn.type].label} 노드는 Arduino C++ 코드 생성에서 지원되지 않습니다`);
          return cppLit(spec ? spec.t : 'any', n.st[port] ?? spec?.def);
        }
        if (depth.v > 60) { warn(n, '데이터 연결이 순환합니다'); return '0'; }
        depth.v++;
        try {
          const e = f(sn, G, sp);
          return /^[\w.]+(\(.*\))?$/.test(e) && !/\s/.test(e) ? e : `(${e})`;
        } finally { depth.v--; }
      }
      return cppLit(spec ? spec.t : 'any', n.st[port] ?? spec?.def);
    },
    dev(n) {
      const src = into.get(n.id + ':dev');
      const id = src ? splitTerm(src)[0] : n.st.dev;
      const d = id && byId.get(id);
      const spec = NODES[n.type].ins.find(p => p.k === 'dev');
      if (!d || !spec.types.includes(d.type)) { warn(n, `${spec.types.map(t => DEVICES[t].label).join('/')} 모듈을 연결하세요`); return null; }
      return d;
    },
    pin(n) {
      const src = into.get(n.id + ':pin');
      let g = null;
      if (src) {
        const [sid, sp] = splitTerm(src);
        const sn = byId.get(sid);
        const pp = sn && BOARDS[sn.type] && BOARDS[sn.type].pins[sp];
        if (pp && pp.gpio != null) g = pp.gpio;
        else { warn(n, '보드의 입출력 핀에 연결하세요'); return null; }
      } else {
        const v = n.st.pin;
        if (v === undefined || v === '' || v === null) { warn(n, '핀을 선택하거나 보드 핀에 연결하세요'); return null; }
        g = +v;
      }
      return g;
    },
    pinVar(n, mode, needPwm) {
      const g = G.pin(n);
      if (g == null) return null;
      if (needPwm && !AVR_PWM_PINS.includes(g)) warn(n, `${code(g)}은 PWM 핀이 아닙니다 (D3, D5, D6, D9, D10, D11)`);
      if (mode === 'INPUT' || mode === 'INPUT_PULLUP' || mode === 'OUTPUT') {
        const key = `${g}:${mode}`;
        if (!pinDecls.has(key)) { pinDecls.set(key, true); setupLines.push(`pinMode(${code(g)}, ${mode});`); }
      } else if (g < 14) warn(n, `${code(g)}은 아날로그 입력 핀이 아닙니다 (A0~A5)`);
      return code(g);
    },
    chain(n, port) {
      const lines = [];
      const seen = new Set();
      let t = (from.get(n.id + ':' + port) || [])[0];
      while (t) {
        const [tid] = splitTerm(t);
        const tn = byId.get(tid);
        if (!tn || !NODES[tn.type]) break;
        if (seen.has(tid) || depth.v > 40) { warn(tn, '실행 흐름이 순환합니다'); break; }
        seen.add(tid);
        const f = CPP_STMT[tn.type];
        depth.v++;
        try {
          if (f) lines.push(...f(tn, G));
          else if (NODES[tn.type].stmt) warn(tn, `${NODES[tn.type].label} 노드는 Arduino C++ 코드 생성에서 지원되지 않습니다`);
        } finally { depth.v--; }
        t = (from.get(tid + ':out') || [])[0];
      }
      return lines;
    },
  };

  const byPos = (a, b) => a.y - b.y || a.x - b.x;
  const evs = t => graph.nodes.filter(n => n.type === t).sort(byPos);
  const handlers = [], polls = [], attach = [];
  for (const n of evs('ev_timer')) {
    const p = Math.max(1, parseInt(n.st.period) || 1000);
    const body = G.chain(n, 'out');
    globals.push(`unsigned long tPrev_${n.id} = 0;`);
    handlers.push([`void onTimer_${n.id}() {`, ...cppInd(body), '}', '']);
    polls.push(`if (millis() - tPrev_${n.id} >= ${p}UL) {`, `  tPrev_${n.id} = millis();`, `  onTimer_${n.id}();`, '}');
  }
  for (const n of evs('ev_pin')) {
    const g = G.pin(n);
    if (g == null) continue;
    const mode = n.st.pull === 'PULL_UP' ? 'INPUT_PULLUP' : 'INPUT';
    const key = `${g}:${mode}`;
    if (!pinDecls.has(key)) { pinDecls.set(key, true); setupLines.push(`pinMode(${code(g)}, ${mode});`); }
    const edge = n.st.edge || 'FALLING';
    const body = G.chain(n, 'out');
    handlers.push([`void onPin_${n.id}() {`, ...cppInd(body), '}', '']);
    if (g === 2 || g === 3) attach.push(`attachInterrupt(digitalPinToInterrupt(${code(g)}), onPin_${n.id}, ${edge === 'BOTH' ? 'CHANGE' : edge});`);
    else {
      warn(n, `${code(g)}은 외부 인터럽트 핀이 아닙니다 (Uno/Nano는 D2, D3만 지원) — 메인 루프에서 확인하는 코드로 생성합니다`);
      globals.push(`int prevPin_${n.id} = ${edge === 'RISING' ? 'LOW' : 'HIGH'};`);
      polls.push(`int v_${n.id} = digitalRead(${code(g)});`,
        `if (v_${n.id} != prevPin_${n.id}${edge === 'BOTH' ? '' : ` && v_${n.id} == ${edge === 'RISING' ? 'HIGH' : 'LOW'}`}) onPin_${n.id}();`,
        `prevPin_${n.id} = v_${n.id};`);
    }
  }
  for (const n of evs('ev_button')) {
    const d = G.dev(n);
    if (!d) continue;
    const body = G.chain(n, 'out');
    handlers.push([`void onPress_${n.id}() {`, ...cppInd(body), '}', '']);
    globals.push(`int prevBtn_${n.id} = HIGH;`);
    polls.push(`int b_${n.id} = digitalRead(${d.name});`,
      `if (b_${n.id} == LOW && prevBtn_${n.id} == HIGH) { onPress_${n.id}(); delay(30); }`,
      `prevBtn_${n.id} = b_${n.id};`);
  }
  const startCode = [];
  for (const n of evs('ev_start')) startCode.push(...G.chain(n, 'out'));
  const loopNodes = evs('ev_loop');
  if (loopNodes.length > 1) warn(loopNodes[1], '무한 반복 노드는 하나만 사용할 수 있습니다 (첫 번째만 실행)');
  const loopBody = loopNodes.length ? G.chain(loopNodes[0], 'out') : [];
  const loopDelay = loopNodes.length ? (parseInt(loopNodes[0].st.delay ?? 10) || 0) : 0;

  // 변수 타입 추정: 문자열이 들어가면 String
  for (const n of graph.nodes.filter(x => x.type === 'var_set')) {
    const v = pyIdent(n.st.name || 'count');
    const src = into.get(n.id + ':value');
    const sn = src && byId.get(splitTerm(src)[0]);
    const isStr = sn ? ['str', 'join', 'format', 'm_rtc', 'm_uart_recv'].includes(sn.type)
      : typeof n.st.value === 'string' && n.st.value.trim() !== '' && isNaN(Number(n.st.value));
    if (isStr && vars.has(v)) vars.set(v, 'String');
  }

  // --- 조립 ---
  const out = [];
  out.push(`// picoBuilder 자동 생성 코드 (Arduino C++ / ${bd.label})`);
  out.push('// Arduino IDE에 붙여넣고 보드와 포트를 선택해 업로드하세요.');
  if (libs.size) out.push(`// 필요한 라이브러리: ${[...libs].join(', ')}`);
  out.push('');
  [...incs].sort().forEach(h => out.push(`#include <${h}>`));
  if (incs.size) out.push('');
  if (globals.length) out.push(...globals, '');
  if (vars.size) { out.push('// ---- 변수 ----'); vars.forEach((t, v) => out.push(`${t} ${v} = ${t === 'String' ? '""' : '0'};`)); out.push(''); }
  if (helpers.size) out.push('// ---- 도우미 함수 ----', ...[...helpers.values()].flatMap(h => [h, '']));
  if (handlers.length) out.push('// ---- 이벤트 ----', ...handlers.flat());
  out.push('void setup() {');
  if (usedSerial.on) out.push('  Serial.begin(9600);');
  out.push(...cppInd(setupLines));
  out.push(...cppInd(attach));
  if (startCode.length) out.push('', ...cppInd(startCode));
  out.push('}', '');
  out.push('void loop() {');
  out.push(...cppInd(loopBody));
  out.push(...cppInd(polls));
  if (loopDelay > 0) out.push(`  delay(${loopDelay});`);
  if (!loopBody.length && !polls.length && !loopDelay) out.push('  // "무한 반복" 이벤트 노드에 동작 노드를 연결하세요');
  out.push('}', '');
  return { code: out.join('\n'), libs: [...libs], warnings };
}
