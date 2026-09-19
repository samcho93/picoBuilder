// 하드웨어 모듈(IO, 센서, I2C/SPI/UART 상용 모듈) 정의
// 각 모듈: 핀(role), 설정코드(setup), 시각화(view/render), 시뮬레이션(outputs/onEdge/i2c/spi/uart)
'use strict';

// 5x7 폰트 (ASCII 0x20~0x7E, 열 단위, LSB=위)
const FONT5x7_HEX =
  '0000000000' + '00005f0000' + '0007000700' + '147f147f14' + '242a7f2a12' + '2313086462' + '3649552250' + '0005030000' +
  '001c224100' + '0041221c00' + '082a1c2a08' + '08083e0808' + '0050300000' + '0808080808' + '0060600000' + '2010080402' +
  '3e5149453e' + '00427f4000' + '4261514946' + '2141454b31' + '1814127f10' + '2745454539' + '3c4a494930' + '0171090503' +
  '3649494936' + '064949291e' + '0036360000' + '0056360000' + '0008142241' + '1414141414' + '4122140800' + '0201510906' +
  '3249794141' + '7e1111117e' + '7f49494936' + '3e41414122' + '7f4141221c' + '7f49494941' + '7f09090101' + '3e41415132' +
  '7f0808087f' + '00417f4100' + '2040413f01' + '7f08142241' + '7f40404040' + '7f0204027f' + '7f0408107f' + '3e4141413e' +
  '7f09090906' + '3e4151215e' + '7f09192946' + '4649494931' + '01017f0101' + '3f4040403f' + '1f2040201f' + '7f2018207f' +
  '6314081463' + '0304780403' + '6151494543' + '00007f4141' + '0204081020' + '41417f0000' + '0402010204' + '4040404040' +
  '0001020400' + '2054545478' + '7f48444438' + '3844444420' + '384444487f' + '3854545418' + '087e090102' + '081454543c' +
  '7f08040478' + '00447d4000' + '2040443d00' + '007f102844' + '00417f4000' + '7c04180478' + '7c08040478' + '3844444438' +
  '7c14141408' + '081414187c' + '7c08040408' + '4854545420' + '043f444020' + '3c4040207c' + '1c2040201c' + '3c4030403c' +
  '4428102844' + '0c5050503c' + '4464544c44' + '0008364100' + '00007f0000' + '0041360800' + '0201020402';
const FONT5x7 = (() => { const a = []; for (let i = 0; i < FONT5x7_HEX.length; i += 2) a.push(parseInt(FONT5x7_HEX.substr(i, 2), 16)); return a; })();

const DEV_CATS = [
  ['io', '기본 입출력', '#4a9eff'],
  ['sensor', '센서', '#98c379'],
  ['i2c', 'I2C 모듈', '#c678dd'],
  ['spi', 'SPI 모듈', '#e06c75'],
  ['uart', 'UART 모듈', '#56b6c2'],
];

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const bcd = v => ((Math.floor(v / 10) << 4) | (v % 10)) & 255;
const unbcd = v => (v >> 4) * 10 + (v & 15);
const hexs = v => '0x' + v.toString(16).toUpperCase().padStart(2, '0');

// ---------- 공통 헬퍼 ----------
function analogDivider(ctx, frac) {
  const vcc = ctx.v('VCC'), gnd = ctx.v('GND');
  if (vcc == null || gnd == null) return null;
  return gnd + (vcc - gnd) * clamp(frac, 0, 1);
}

// 버튼/스위치 setup (한쪽은 GPIO, 다른 쪽은 GND 또는 3V3)
function switchSetup(node, C) {
  const gA = C.gpio('A'), gB = C.gpio('B');
  const g = gA ?? gB;
  if (g == null) return C.warn('A 또는 B 핀을 GPIO에 연결하세요');
  const other = gA != null ? 'B' : 'A';
  const k = C.kind(other);
  if (k === '3v3' || k === '5v') {
    C.meta.activeLow = false;
    return [`${node.name} = Pin(${g}, Pin.IN, Pin.PULL_DOWN)  # 누르면 1`];
  }
  if (k !== 'gnd') C.warn(`${other} 핀을 GND 또는 3V3에 연결하세요`);
  C.meta.activeLow = true;
  return [`${node.name} = Pin(${g}, Pin.IN, Pin.PULL_UP)  # 누르면 0`];
}

function adcSetup(node, C, pin, suffix = '') {
  const g = C.gpio(pin);
  if (g == null) return C.warn(`${pin} 핀을 ADC 핀(GP26~28)에 연결하세요`);
  if (HW.adcChannel(g) == null) return C.warn(`GP${g}는 ADC를 지원하지 않습니다 (GP26~28 사용)`);
  return [`${node.name}${suffix} = ADC(Pin(${g}))`];
}

function digitalSetup(node, C, pin, mode, suffix = '') {
  const g = C.gpio(pin);
  if (g == null) return C.warn(`${pin} 핀을 GPIO에 연결하세요`);
  return [`${node.name}${suffix} = Pin(${g}, ${mode})`];
}

// ---------- 오디오(부저) ----------
const Sound = {
  ctx: null, osc: new Map(), muted: false,
  set(id, freq, on) {
    if (this.muted) on = false;
    let o = this.osc.get(id);
    if (!on) { if (o) { o.g.gain.value = 0; } return; }
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (!o) {
        const osc = this.ctx.createOscillator(), g = this.ctx.createGain();
        osc.type = 'square'; g.gain.value = 0; osc.connect(g); g.connect(this.ctx.destination); osc.start();
        o = { osc, g }; this.osc.set(id, o);
      }
      o.osc.frequency.value = clamp(freq, 20, 20000);
      o.g.gain.value = 0.04;
    } catch (e) { /* 오디오 미지원 */ }
  },
  allOff() { for (const o of this.osc.values()) o.g.gain.value = 0; },
};

// ---------- OLED SSD1306 에뮬레이터 ----------
const SSD_ARGS = { 0x20: 1, 0x21: 2, 0x22: 2, 0x81: 1, 0xA8: 1, 0xD3: 1, 0xD5: 1, 0xD9: 1, 0xDA: 1, 0xDB: 1, 0x8D: 1, 0xAD: 1, 0x26: 6, 0x27: 6, 0x29: 5, 0x2A: 5, 0xA3: 2 };
function ssdReset(rt) {
  Object.assign(rt, { ram: new Uint8Array(1024), col: 0, page: 0, c0: 0, c1: 127, p0: 0, p1: 7, mode: 2, on: false, inv: false, seg: false, com: false, pend: null, args: [], dirty: true, allOn: false });
}
function ssdCmd(rt, c) {
  if (rt.pend !== null) {
    rt.args.push(c);
    if (rt.args.length < SSD_ARGS[rt.pend]) return;
    const a = rt.args, p = rt.pend; rt.pend = null;
    if (p === 0x21) { rt.c0 = a[0] & 127; rt.c1 = a[1] & 127; rt.col = rt.c0; }
    else if (p === 0x22) { rt.p0 = a[0] & 7; rt.p1 = a[1] & 7; rt.page = rt.p0; }
    else if (p === 0x20) rt.mode = a[0] & 3;
    rt.dirty = true;
    return;
  }
  if (SSD_ARGS[c]) { rt.pend = c; rt.args = []; return; }
  if (c === 0xAE) rt.on = false; else if (c === 0xAF) rt.on = true;
  else if (c === 0xA6) rt.inv = false; else if (c === 0xA7) rt.inv = true;
  else if (c === 0xA0) rt.seg = false; else if (c === 0xA1) rt.seg = true;
  else if (c === 0xC0) rt.com = false; else if (c === 0xC8) rt.com = true;
  else if (c === 0xA4) rt.allOn = false; else if (c === 0xA5) rt.allOn = true;
  else if (c >= 0xB0 && c <= 0xB7) rt.page = c & 7;
  else if (c <= 0x0F) rt.col = (rt.col & 0xF0) | c;
  else if (c >= 0x10 && c <= 0x1F) rt.col = (rt.col & 0x0F) | ((c & 0x0F) << 4);
  rt.dirty = true;
}
function ssdData(rt, b) {
  rt.ram[rt.page * 128 + rt.col] = b;
  if (rt.mode === 0) {
    rt.col++;
    if (rt.col > rt.c1) { rt.col = rt.c0; rt.page++; if (rt.page > rt.p1) rt.page = rt.p0; }
  } else if (rt.mode === 1) {
    rt.page++;
    if (rt.page > rt.p1) { rt.page = rt.p0; rt.col++; if (rt.col > rt.c1) rt.col = rt.c0; }
  } else rt.col = (rt.col + 1) & 127;
  rt.dirty = true;
}
function ssdWrite(rt, bytes) {
  let i = 0;
  while (i < bytes.length) {
    const ctrl = bytes[i++];
    const isData = ctrl & 0x40;
    if (ctrl & 0x80) { if (i < bytes.length) { const b = bytes[i++]; isData ? ssdData(rt, b) : ssdCmd(rt, b); } }
    else { for (; i < bytes.length; i++) isData ? ssdData(rt, bytes[i]) : ssdCmd(rt, bytes[i]); }
  }
}

// ---------- LCD1602 (HD44780 + PCF8574) 에뮬레이터 ----------
function lcdReset(rt) {
  Object.assign(rt, { dd: new Uint8Array(128).fill(32), cg: new Uint8Array(64), addr: 0, cga: 0, cgMode: false, mode8: true, hi: null, last: 0, bl: 0, disp: false, cursor: false, dirty: true });
}
function lcdExec(rt, c) {
  if (c === 0x01) { rt.dd.fill(32); rt.addr = 0; rt.cgMode = false; }
  else if ((c & 0xFE) === 0x02) { rt.addr = 0; rt.cgMode = false; }
  else if ((c & 0xF8) === 0x08) { rt.disp = !!(c & 4); rt.cursor = !!(c & 2); }
  else if ((c & 0xE0) === 0x20) { if (!(c & 0x10)) rt.mode8 = false; }
  else if (c & 0x80) { rt.addr = c & 0x7F; rt.cgMode = false; }
  else if ((c & 0xC0) === 0x40) { rt.cga = c & 0x3F; rt.cgMode = true; }
  rt.dirty = true;
}
function lcdWrite(rt, bytes) {
  for (const b of bytes) {
    const prev = rt.last; rt.last = b;
    if (((b & 8) ? 1 : 0) !== rt.bl) { rt.bl = (b & 8) ? 1 : 0; rt.dirty = true; }
    if ((prev & 4) && !(b & 4)) {
      const rs = b & 1, nib = b >> 4;
      if (rt.mode8) { if (!rs) lcdExec(rt, nib << 4); continue; }
      if (rt.hi === null) { rt.hi = nib; continue; }
      const v = (rt.hi << 4) | nib; rt.hi = null;
      if (rs) {
        if (rt.cgMode) rt.cg[rt.cga++ & 63] = v;
        else { rt.dd[rt.addr] = v; rt.addr = (rt.addr + 1) & 0x7F; }
        rt.dirty = true;
      } else lcdExec(rt, v);
    }
  }
}

// ---------- NMEA ----------
function nmeaCk(s) { let c = 0; for (const ch of s) c ^= ch.charCodeAt(0); return c.toString(16).toUpperCase().padStart(2, '0'); }
function nmeaCoord(v, isLat) {
  const a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
  return (isLat ? String(d).padStart(2, '0') : String(d).padStart(3, '0')) + m.toFixed(4).padStart(7, '0');
}
function gpsSentences(st) {
  const t = new Date();
  const p2 = x => String(x).padStart(2, '0');
  const hms = p2(t.getUTCHours()) + p2(t.getUTCMinutes()) + p2(t.getUTCSeconds()) + '.00';
  const dmy = p2(t.getUTCDate()) + p2(t.getUTCMonth() + 1) + p2(t.getUTCFullYear() % 100);
  const lat = nmeaCoord(st.lat, true), ns = st.lat >= 0 ? 'N' : 'S';
  const lon = nmeaCoord(st.lon, false), ew = st.lon >= 0 ? 'E' : 'W';
  const fix = st.fix;
  const rmc = `GPRMC,${hms},${fix ? 'A' : 'V'},${fix ? lat : ''},${fix ? ns : ''},${fix ? lon : ''},${fix ? ew : ''},0.0,0.0,${dmy},,,${fix ? 'A' : 'N'}`;
  const gga = `GPGGA,${hms},${fix ? lat : ''},${fix ? ns : ''},${fix ? lon : ''},${fix ? ew : ''},${fix ? 1 : 0},${fix ? String(st.sats).padStart(2, '0') : '00'},1.0,${fix ? st.alt.toFixed(1) : ''},M,20.0,M,,`;
  return `$${rmc}*${nmeaCk(rmc)}\r\n$${gga}*${nmeaCk(gga)}\r\n`;
}

// ================= 모듈 정의 =================
const DEVICES = {};

// ---- LED ----
DEVICES.led = {
  label: 'LED', cat: 'io', icon: '💡', prefix: 'led', desc: '저항 내장 LED 모듈 (+: 애노드, -: 캐소드)',
  pins: [{ n: '+', role: 'io' }, { n: '-', role: 'io' }],
  controls: [{ k: 'color', type: 'select', label: '색', opts: [['red', '빨강'], ['green', '초록'], ['blue', '파랑'], ['yellow', '노랑'], ['white', '흰색']] }],
  init: () => ({ color: 'red' }),
  view: () => `<div class="v-led"><div class="bulb"></div></div>`,
  render(n, ctx, el) {
    const vp = ctx.v('+'), vm = ctx.v('-');
    const b = vp == null || vm == null ? 0 : clamp((vp - vm) / 3.3, 0, 1);
    const col = { red: '#ff3b30', green: '#34c759', blue: '#2f7bff', yellow: '#ffd60a', white: '#f5f5f5' }[n.st.color] || '#f33';
    const bulb = el.querySelector('.bulb');
    bulb.style.background = col;
    bulb.style.opacity = 0.25 + 0.75 * b;
    bulb.style.boxShadow = b > 0.02 ? `0 0 ${4 + 22 * b}px ${4 * b}px ${col}` : 'none';
  },
  setup(n, C) {
    const gp = C.gpio('+'), gm = C.gpio('-');
    if (gp != null) {
      if (C.kind('-') !== 'gnd') C.warn('- 핀을 GND에 연결하세요');
      C.meta.inv = false;
      return [`${n.name} = Pin(${gp}, Pin.OUT)`];
    }
    if (gm != null) { C.meta.inv = true; return [`${n.name} = Pin(${gm}, Pin.OUT)  # 싱크 방식: 0=켜짐`]; }
    return C.warn('+ 핀을 GPIO에 연결하세요');
  },
};

// ---- RGB LED ----
DEVICES.rgb = {
  label: 'RGB LED', cat: 'io', icon: '🌈', prefix: 'rgb', desc: '공통 캐소드 RGB LED 모듈 (KY-016)',
  pins: [{ n: 'R', role: 'io' }, { n: 'G', role: 'io' }, { n: 'B', role: 'io' }, { n: '-', role: 'gnd' }],
  view: () => `<div class="v-led"><div class="bulb"></div></div>`,
  render(n, ctx, el) {
    const c = p => { const v = ctx.v(p), g = ctx.v('-'); return v == null || g == null ? 0 : clamp((v - g) / 3.3, 0, 1); };
    const r = c('R'), g = c('G'), b = c('B'), m = Math.max(r, g, b);
    const bulb = el.querySelector('.bulb');
    bulb.style.background = m > 0.02 ? `rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})` : '#ddd';
    bulb.style.opacity = 0.3 + 0.7 * m;
    bulb.style.boxShadow = m > 0.02 ? `0 0 ${6 + 20 * m}px rgb(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0})` : 'none';
  },
  setup(n, C) {
    const out = [];
    for (const p of ['R', 'G', 'B']) {
      const g = C.gpio(p);
      if (g == null) { C.warn(`${p} 핀을 GPIO에 연결하세요`); continue; }
      out.push(`${n.name}_${p.toLowerCase()} = PWM(Pin(${g}))`, `${n.name}_${p.toLowerCase()}.freq(1000)`);
    }
    return out;
  },
};

// ---- 푸시 버튼 ----
DEVICES.button = {
  label: '푸시 버튼', cat: 'io', icon: '🔘', prefix: 'btn', desc: '택트 스위치 (누르는 동안 A-B 연결). 한쪽은 GPIO, 다른쪽은 GND 권장',
  pins: [{ n: 'A', role: 'io' }, { n: 'B', role: 'io' }],
  init: () => ({ pressed: false }),
  view: () => `<button class="v-btn" data-hold="pressed"></button>`,
  render(n, ctx, el) { el.querySelector('.v-btn').classList.toggle('on', !!n.st.pressed); },
  closed: n => n.st.pressed ? [['A', 'B']] : [],
  setup: switchSetup,
};

// ---- 토글 스위치 ----
DEVICES.switch = {
  label: '슬라이드 스위치', cat: 'io', icon: '🎚', prefix: 'sw', desc: '토글 스위치 (ON일 때 A-B 연결)',
  pins: [{ n: 'A', role: 'io' }, { n: 'B', role: 'io' }],
  init: () => ({ on: false }),
  view: () => `<div class="v-toggle" data-toggle="on"><span></span></div>`,
  render(n, ctx, el) { el.querySelector('.v-toggle').classList.toggle('on', !!n.st.on); },
  closed: n => n.st.on ? [['A', 'B']] : [],
  setup: switchSetup,
};

// ---- 가변저항 ----
DEVICES.pot = {
  label: '가변저항', cat: 'io', icon: '🎛', prefix: 'pot', desc: '10kΩ 포텐셔미터: OUT = VCC × 위치',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'OUT', role: 'io' }, { n: 'GND', role: 'gnd' }],
  controls: [{ k: 'pos', type: 'range', label: '위치', min: 0, max: 100, unit: '%' }],
  init: () => ({ pos: 50 }),
  outputs: (n, ctx) => ({ OUT: analogDivider(ctx, n.st.pos / 100) }),
  setup: (n, C) => adcSetup(n, C, 'OUT'),
};

// ---- 조이스틱 ----
DEVICES.joystick = {
  label: '조이스틱', cat: 'io', icon: '🕹', prefix: 'joy', desc: 'KY-023 아날로그 조이스틱 (SW는 누르면 GND)',
  pins: [{ n: 'GND', role: 'gnd' }, { n: 'VCC', role: 'vcc' }, { n: 'VRx', role: 'io' }, { n: 'VRy', role: 'io' }, { n: 'SW', role: 'io' }],
  init: () => ({ x: 0, y: 0, pressed: false }),
  view: () => `<div class="v-joy"><div class="pad"><div class="knob"></div></div><button class="v-btn sm" data-hold="pressed"></button></div>`,
  mount(n, el, app) {
    const pad = el.querySelector('.pad'), knob = el.querySelector('.knob');
    const move = e => {
      const r = pad.getBoundingClientRect();
      n.st.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
      n.st.y = clamp(((e.clientY - r.top) / r.height) * 2 - 1, -1, 1);
      app.sim.step();
    };
    pad.addEventListener('pointerdown', e => {
      e.stopPropagation(); pad.setPointerCapture(e.pointerId); move(e);
      const up = () => { n.st.x = 0; n.st.y = 0; app.sim.step(); pad.removeEventListener('pointermove', move); pad.removeEventListener('pointerup', up); };
      pad.addEventListener('pointermove', move); pad.addEventListener('pointerup', up);
    });
  },
  render(n, ctx, el) {
    const k = el.querySelector('.knob');
    k.style.transform = `translate(${n.st.x * 22}px, ${n.st.y * 22}px)`;
    el.querySelector('.v-btn').classList.toggle('on', !!n.st.pressed);
  },
  outputs: (n, ctx) => ({
    VRx: analogDivider(ctx, (n.st.x + 1) / 2), VRy: analogDivider(ctx, (n.st.y + 1) / 2),
    SW: n.st.pressed && ctx.v('GND') === 0 ? { v: 0 } : null,
  }),
  setup(n, C) {
    return [...adcSetup(n, C, 'VRx', '_x'), ...adcSetup(n, C, 'VRy', '_y'), ...digitalSetup(n, C, 'SW', 'Pin.IN, Pin.PULL_UP', '_sw')];
  },
};

// ---- 부저 ----
DEVICES.buzzer = {
  label: '패시브 부저', cat: 'io', icon: '🔊', prefix: 'buzzer', desc: 'PWM 주파수로 소리를 내는 패시브 부저',
  pins: [{ n: '+', role: 'io' }, { n: '-', role: 'gnd' }],
  view: () => `<div class="v-buzz"><div class="disc"></div><span class="f"></span></div>`,
  render(n, ctx, el) {
    const pwm = ctx.pwm('+');
    const on = !!(pwm && pwm.duty > 0 && pwm.freq >= 20 && ctx.v('-') === 0 && ctx.sim.running);
    Sound.set(n.id, pwm ? pwm.freq : 0, on);
    el.querySelector('.disc').classList.toggle('on', on);
    el.querySelector('.f').textContent = on ? `${Math.round(pwm.freq)} Hz` : '';
  },
  stop: n => Sound.set(n.id, 0, false),
  setup(n, C) {
    const g = C.gpio('+');
    if (g == null) return C.warn('+ 핀을 GPIO에 연결하세요');
    return [`${n.name} = PWM(Pin(${g}))`, `${n.name}.duty_u16(0)`];
  },
};

// ---- 서보 ----
DEVICES.servo = {
  label: '서보 SG90', cat: 'io', icon: '⚙', prefix: 'servo', desc: 'SG90 서보: 50Hz, 0.5~2.5ms 펄스 = 0~180°',
  pins: [{ n: 'GND', role: 'gnd' }, { n: 'VCC', role: 'vcc' }, { n: 'SIG', role: 'io' }],
  view: () => `<svg class="v-servo" viewBox="0 0 80 60"><rect x="8" y="18" width="64" height="30" rx="3" fill="#2b5bb8"/><circle cx="28" cy="33" r="9" fill="#ddd"/><g class="horn"><rect x="25" y="4" width="6" height="30" rx="3" fill="#fff" stroke="#999"/></g><text x="60" y="38" font-size="9" fill="#fff" text-anchor="middle" class="ang">90°</text></svg>`,
  render(n, ctx, el) {
    const pwm = ctx.pwm('SIG');
    if (pwm && pwm.freq > 0 && ctx.powered()) {
      const ms = pwm.duty / 65535 * 1000 / pwm.freq;
      n.rt.angle = clamp((ms - 0.5) / 2.0 * 180, 0, 180);
    }
    const a = n.rt.angle ?? 90;
    el.querySelector('.horn').setAttribute('transform', `rotate(${a - 90} 28 33)`);
    el.querySelector('.ang').textContent = Math.round(a) + '°';
  },
  setup(n, C) {
    const g = C.gpio('SIG');
    if (g == null) return C.warn('SIG 핀을 GPIO에 연결하세요');
    return [`${n.name} = PWM(Pin(${g}))`, `${n.name}.freq(50)`];
  },
};

// ---- 릴레이 ----
DEVICES.relay = {
  label: '릴레이 모듈', cat: 'io', icon: '🔌', prefix: 'relay', desc: '1채널 릴레이 (IN=HIGH 동작)',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'IN', role: 'io' }],
  view: () => `<div class="v-relay"><div class="box">RELAY</div><div class="lamp">💡</div></div>`,
  render(n, ctx, el) {
    const on = ctx.powered() && ctx.d('IN') === 1;
    el.querySelector('.v-relay').classList.toggle('on', on);
  },
  setup: (n, C) => digitalSetup(n, C, 'IN', 'Pin.OUT'),
};

// ---- PIR ----
DEVICES.pir = {
  label: 'PIR 인체감지', cat: 'sensor', icon: '🚶', prefix: 'pir', desc: 'HC-SR501: 움직임 감지 시 OUT=HIGH',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'OUT', role: 'io' }, { n: 'GND', role: 'gnd' }],
  init: () => ({ motion: false }),
  view: () => `<div class="v-pir"><div class="dome"></div><button class="mini" data-toggle="motion">움직임</button></div>`,
  render(n, ctx, el) {
    el.querySelector('.dome').classList.toggle('on', !!n.st.motion && ctx.powered());
    el.querySelector('.mini').classList.toggle('on', !!n.st.motion);
  },
  outputs: (n, ctx) => ctx.powered() ? { OUT: n.st.motion ? 3.3 : 0 } : null,
  setup: (n, C) => digitalSetup(n, C, 'OUT', 'Pin.IN'),
};

// ---- 조도센서 ----
DEVICES.ldr = {
  label: '조도센서(LDR)', cat: 'sensor', icon: '☀', prefix: 'ldr', desc: '포토레지스터 모듈: 밝을수록 AO 전압 증가',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'AO', role: 'io' }],
  controls: [{ k: 'light', type: 'range', label: '밝기', min: 0, max: 100, unit: '%' }],
  init: () => ({ light: 60 }),
  outputs: (n, ctx) => ({ AO: analogDivider(ctx, n.st.light / 100) }),
  setup: (n, C) => adcSetup(n, C, 'AO'),
};

// ---- DHT11 / DHT22 ----
for (const [type, label, prefix] of [['dht11', 'DHT11 온습도', 'dht'], ['dht22', 'DHT22 온습도', 'dht']]) {
  DEVICES[type] = {
    label, cat: 'sensor', icon: '🌡', prefix, desc: `${label.split(' ')[0]} 1-Wire 방식 온습도 센서 (dht 모듈)`,
    pins: [{ n: 'VCC', role: 'vcc' }, { n: 'DATA', role: 'io' }, { n: 'GND', role: 'gnd' }],
    controls: [{ k: 'temp', type: 'range', label: '온도', min: -20, max: 60, unit: '°C' }, { k: 'hum', type: 'range', label: '습도', min: 0, max: 100, unit: '%' }],
    init: () => ({ temp: 24, hum: 55 }),
    setup(n, C) {
      const g = C.gpio('DATA');
      if (g == null) return C.warn('DATA 핀을 GPIO에 연결하세요');
      C.imp('import dht');
      return [`${n.name} = dht.${type.toUpperCase()}(Pin(${g}))`];
    },
  };
}

// ---- DS18B20 ----
DEVICES.ds18b20 = {
  label: 'DS18B20 온도', cat: 'sensor', icon: '🌡', prefix: 'ds', desc: '1-Wire 디지털 온도센서',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'DQ', role: 'io' }, { n: 'GND', role: 'gnd' }],
  controls: [{ k: 'temp', type: 'range', label: '온도', min: -30, max: 100, step: 0.5, unit: '°C' }],
  init: () => ({ temp: 22.5, rom: '28' + Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('') + '5a' }),
  setup(n, C) {
    const g = C.gpio('DQ');
    if (g == null) return C.warn('DQ 핀을 GPIO에 연결하세요');
    C.imp('import onewire, ds18x20');
    return [`${n.name} = ds18x20.DS18X20(onewire.OneWire(Pin(${g})))`, `${n.name}_roms = ${n.name}.scan()`];
  },
};

// ---- HC-SR04 ----
DEVICES.hcsr04 = {
  label: '초음파 HC-SR04', cat: 'sensor', icon: '📡', prefix: 'sonar', desc: '초음파 거리센서: TRIG 10us 펄스 → ECHO 펄스폭(us)/58 = cm',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'TRIG', role: 'io' }, { n: 'ECHO', role: 'io' }, { n: 'GND', role: 'gnd' }],
  controls: [{ k: 'dist', type: 'range', label: '거리', min: 2, max: 400, unit: 'cm' }],
  init: () => ({ dist: 50 }),
  view: () => `<div class="v-sonar"><i></i><i></i></div>`,
  onEdge(n, pin, lv, ctx) { if (pin === 'TRIG' && lv === 0 && ctx.powered()) n.rt.trig = ctx.now(); },
  outputs(n, ctx) {
    if (!ctx.powered()) return null;
    const t = n.rt.trig;
    if (t == null) return { ECHO: 0 };
    const s = t + 0.25, e = s + n.st.dist * 0.0583, now = ctx.now();
    return { ECHO: now >= s && now < e ? 3.3 : 0 };
  },
  pulse(n, pin, level) { return pin === 'ECHO' && level === 1 ? Math.round(n.st.dist * 58.3) : null; },
  setup(n, C) {
    return [...digitalSetup(n, C, 'TRIG', 'Pin.OUT', '_trig'), ...digitalSetup(n, C, 'ECHO', 'Pin.IN', '_echo')];
  },
};

// ---- NeoPixel ----
DEVICES.neopixel = {
  label: 'WS2812 네오픽셀', cat: 'io', icon: '✨', prefix: 'np', desc: 'WS2812B RGB LED 스트립 (neopixel 모듈)',
  pins: [{ n: 'DIN', role: 'io' }, { n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }],
  controls: [{ k: 'count', type: 'select', label: '개수', opts: [['8', '8'], ['12', '12'], ['16', '16']], rebuild: true }],
  init: () => ({ count: '8' }),
  view: n => `<div class="v-np">${Array.from({ length: +n.st.count }, () => '<i></i>').join('')}</div>`,
  render(n, ctx, el) {
    const px = n.rt.pixels, on = ctx.powered();
    const is = el.querySelectorAll('.v-np i');
    is.forEach((d, i) => {
      if (!on || !px || px.length < i * 3 + 3) { d.style.background = '#222'; d.style.boxShadow = 'none'; return; }
      const g = px[i * 3], r = px[i * 3 + 1], b = px[i * 3 + 2];
      const m = Math.max(r, g, b);
      const k = m ? 255 / m : 0, sc = Math.min(1, 0.35 + m / 120);
      const c = `rgb(${r * k * sc | 0},${g * k * sc | 0},${b * k * sc | 0})`;
      d.style.background = m ? c : '#222';
      d.style.boxShadow = m ? `0 0 ${3 + m / 20}px ${c}` : 'none';
    });
  },
  setup(n, C) {
    const g = C.gpio('DIN');
    if (g == null) return C.warn('DIN 핀을 GPIO에 연결하세요');
    C.imp('import neopixel');
    return [`${n.name} = neopixel.NeoPixel(Pin(${g}), ${n.st.count})`];
  },
};

// ---------- I2C 공통 ----------
function i2cSetup(ctor, lib) {
  return function (n, C) {
    const bus = C.i2c();
    if (!bus) return [];
    if (lib) C.lib(lib[0], lib[1]);
    return [`${n.name} = ${ctor(n, bus, C)}`];
  };
}
const I2C_PINS = order => order.map(p => ({ n: p, role: p === 'VCC' || p === 'VIN' ? 'vcc' : p === 'GND' ? 'gnd' : 'io' }));

// ---- SSD1306 OLED ----
DEVICES.oled = {
  label: 'OLED SSD1306', cat: 'i2c', icon: '🖥', prefix: 'oled', desc: '0.96" 128x64 I2C OLED (ssd1306 드라이버)',
  pins: I2C_PINS(['GND', 'VCC', 'SCL', 'SDA']),
  controls: [{ k: 'addr', type: 'select', label: '주소', opts: [['60', '0x3C'], ['61', '0x3D']] }],
  init: () => ({ addr: '60' }),
  reset: n => ssdReset(n.rt),
  view: () => `<canvas class="v-oled" width="128" height="64"></canvas>`,
  render(n, ctx, el) {
    const rt = n.rt, on = ctx.powered() && rt.ram;
    const key = on ? 'on' : 'off';
    if (!rt.dirty && n._rk === key) return;
    n._rk = key; rt.dirty = false;
    const cv = el.querySelector('canvas'), g = cv.getContext('2d');
    const img = g.createImageData(128, 64);
    if (on && rt.on) {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
        const sx = rt.seg ? x : 127 - x, sy = rt.com ? y : 63 - y;
        let bit = rt.allOn ? 1 : (rt.ram[(sy >> 3) * 128 + sx] >> (sy & 7)) & 1;
        if (rt.inv) bit ^= 1;
        const i = (y * 128 + x) * 4;
        if (bit) { img.data[i] = 120; img.data[i + 1] = 220; img.data[i + 2] = 255; }
        img.data[i + 3] = 255;
      }
    } else for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
    g.putImageData(img, 0, 0);
  },
  i2c: {
    addr: n => +n.st.addr,
    write(n, b) { if (!n.rt.ram) ssdReset(n.rt); ssdWrite(n.rt, b); },
    read: () => [0x43],
  },
  setup: i2cSetup((n, bus) => `SSD1306_I2C(128, 64, ${bus}, addr=${hexs(+n.st.addr)})`, ['ssd1306', 'from ssd1306 import SSD1306_I2C']),
};

// ---- LCD1602 I2C ----
DEVICES.lcd = {
  label: 'LCD1602 I2C', cat: 'i2c', icon: '📟', prefix: 'lcd', desc: '16x2 문자 LCD + PCF8574 I2C 백팩',
  pins: I2C_PINS(['GND', 'VCC', 'SDA', 'SCL']),
  controls: [{ k: 'addr', type: 'select', label: '주소', opts: [['39', '0x27'], ['63', '0x3F']] }],
  init: () => ({ addr: '39' }),
  reset: n => lcdReset(n.rt),
  view: () => `<canvas class="v-lcd" width="196" height="44"></canvas>`,
  render(n, ctx, el) {
    const rt = n.rt, on = ctx.powered() && rt.dd;
    const key = on ? 'on' : 'off';
    if (!rt.dirty && n._rk === key) return;
    n._rk = key; rt.dirty = false;
    const g = el.querySelector('canvas').getContext('2d');
    const bl = on && rt.bl;
    g.fillStyle = bl ? '#3d7df5' : '#1a2a55'; g.fillRect(0, 0, 196, 44);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 16; c++) {
      const x0 = 3 + c * 12, y0 = 4 + r * 20;
      g.fillStyle = bl ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
      g.fillRect(x0, y0, 11, 16);
      if (!on || !rt.disp) continue;
      const code = rt.dd[r * 0x40 + c];
      g.fillStyle = bl ? '#eef4ff' : '#7a8ab5';
      for (let row = 0; row < 8; row++) for (let col = 0; col < 5; col++) {
        let on1 = 0;
        if (code < 8) on1 = (rt.cg[(code & 7) * 8 + row] >> (4 - col)) & 1;
        else if (code >= 32 && code < 127) on1 = row < 7 ? (FONT5x7[(code - 32) * 5 + col] >> row) & 1 : 0;
        else if (code === 0xFF) on1 = 1;
        if (on1) g.fillRect(x0 + col * 2 + 1, y0 + row * 2, 1.7, 1.7);
      }
    }
  },
  i2c: { addr: n => +n.st.addr, write(n, b) { if (!n.rt.dd) lcdReset(n.rt); lcdWrite(n.rt, b); }, read: n => [n.rt.last || 0] },
  setup: i2cSetup((n, bus) => `I2cLcd(${bus}, ${hexs(+n.st.addr)}, 2, 16)`, ['i2c_lcd', 'from i2c_lcd import I2cLcd']),
};

// ---- AHT20 ----
function crc8(bytes) {
  let c = 0xFF;
  for (const b of bytes) { c ^= b; for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ 0x31) & 255 : (c << 1) & 255; }
  return c;
}
DEVICES.aht20 = {
  label: 'AHT20 온습도', cat: 'i2c', icon: '💧', prefix: 'aht', desc: 'AHT20 I2C 온습도 센서 (0x38)',
  pins: I2C_PINS(['VIN', 'GND', 'SCL', 'SDA']),
  controls: [{ k: 'temp', type: 'range', label: '온도', min: -20, max: 80, step: 0.1, unit: '°C' }, { k: 'hum', type: 'range', label: '습도', min: 0, max: 100, step: 0.1, unit: '%' }],
  init: () => ({ temp: 23.5, hum: 45 }),
  i2c: {
    addr: () => 0x38,
    write(n, b) { if (b[0] === 0xAC) n.rt.meas = performance.now(); },
    read(n, len) {
      const busy = n.rt.meas != null && performance.now() - n.rt.meas < 75;
      const st = 0x18 | (busy ? 0x80 : 0);
      if (len <= 1) return [st];
      const H = Math.round(clamp(n.st.hum, 0, 100) / 100 * 1048575), T = Math.round((clamp(n.st.temp, -50, 150) + 50) / 200 * 1048575);
      const d = [st, (H >> 12) & 255, (H >> 4) & 255, ((H & 15) << 4) | ((T >> 16) & 15), (T >> 8) & 255, T & 255];
      d.push(crc8(d));
      return d;
    },
  },
  setup: i2cSetup((n, bus) => `AHT20(${bus})`, ['aht20', 'from aht20 import AHT20']),
};

// ---- MPU6050 ----
DEVICES.mpu6050 = {
  label: 'MPU6050 6축', cat: 'i2c', icon: '🧭', prefix: 'mpu', desc: 'GY-521 가속도/자이로 (0x68, AD0=HIGH→0x69)',
  pins: [...I2C_PINS(['VCC', 'GND', 'SCL', 'SDA']), { n: 'AD0', role: 'io' }],
  controls: [
    { k: 'tx', type: 'range', label: '기울기X', min: -90, max: 90, unit: '°' },
    { k: 'ty', type: 'range', label: '기울기Y', min: -90, max: 90, unit: '°' },
    { k: 'gz', type: 'range', label: '회전Z', min: -250, max: 250, unit: '°/s' },
  ],
  init: () => ({ tx: 0, ty: 0, gz: 0 }),
  reset(n) { n.rt.regs = new Uint8Array(128); n.rt.regs[0x6B] = 0x40; n.rt.regs[0x75] = 0x68; n.rt.ptr = 0; },
  i2c: {
    addr: n => 0x68 + (APP.sim.termLevel(n.id + ':AD0') === 1 ? 1 : 0),
    write(n, b) {
      if (!n.rt.regs) DEVICES.mpu6050.reset(n);
      n.rt.ptr = b[0] & 127;
      for (let i = 1; i < b.length; i++) n.rt.regs[(n.rt.ptr++) & 127] = b[i];
    },
    read(n, len) {
      if (!n.rt.regs) DEVICES.mpu6050.reset(n);
      const R = n.rt.regs, s = n.st, rad = Math.PI / 180;
      const sleep = R[0x6B] & 0x40;
      const w16 = (a, v) => { v = Math.round(clamp(v, -32768, 32767)) & 0xFFFF; R[a] = v >> 8; R[a + 1] = v & 255; };
      const nz = () => (Math.random() - 0.5) * 60;
      const aS = 16384 >> ((R[0x1C] >> 3) & 3), gS = 131 / (1 << ((R[0x1B] >> 3) & 3));
      const ax = Math.sin(s.ty * rad), ay = -Math.sin(s.tx * rad), az = Math.cos(s.tx * rad) * Math.cos(s.ty * rad);
      w16(0x3B, sleep ? 0 : ax * aS + nz()); w16(0x3D, sleep ? 0 : ay * aS + nz()); w16(0x3F, sleep ? 0 : az * aS + nz());
      w16(0x41, sleep ? 0 : (25 - 36.53) * 340);
      w16(0x43, sleep ? 0 : nz() / 4); w16(0x45, sleep ? 0 : nz() / 4); w16(0x47, sleep ? 0 : s.gz * gS);
      const out = [];
      for (let i = 0; i < len; i++) out.push(R[(n.rt.ptr++) & 127]);
      return out;
    },
  },
  setup: i2cSetup((n, bus, C) => `MPU6050(${bus}${C.kind('AD0') === '3v3' ? ', 0x69' : ''})`, ['mpu6050', 'from mpu6050 import MPU6050']),
};

// ---- BH1750 ----
DEVICES.bh1750 = {
  label: 'BH1750 조도', cat: 'i2c', icon: '🔆', prefix: 'lux', desc: 'GY-302 디지털 조도센서 (0x23, ADDR=HIGH→0x5C)',
  pins: [...I2C_PINS(['VCC', 'GND', 'SCL', 'SDA']), { n: 'ADDR', role: 'io' }],
  controls: [{ k: 'lux', type: 'range', label: '조도', min: 0, max: 2000, unit: 'lx' }],
  init: () => ({ lux: 350 }),
  i2c: {
    addr: n => APP.sim.termLevel(n.id + ':ADDR') === 1 ? 0x5C : 0x23,
    write(n, b) { if (b[0] === 0x01) n.rt.on = true; else if (b[0] === 0x00) n.rt.on = false; else if (b[0] >= 0x10) n.rt.on = true; },
    read(n) { const raw = n.rt.on === false ? 0 : Math.round(clamp(n.st.lux * 1.2, 0, 65535)); return [raw >> 8, raw & 255]; },
  },
  setup: i2cSetup((n, bus, C) => `BH1750(${bus}${C.kind('ADDR') === '3v3' ? ', 0x5C' : ''})`, ['bh1750', 'from bh1750 import BH1750']),
};

// ---- DS3231 RTC ----
DEVICES.ds3231 = {
  label: 'DS3231 RTC', cat: 'i2c', icon: '⏰', prefix: 'rtc', desc: '고정밀 실시간 시계 (0x68)',
  pins: I2C_PINS(['VCC', 'GND', 'SDA', 'SCL']),
  init: () => ({ offset: 0 }),
  view: () => `<div class="v-rtc">--:--:--</div>`,
  render(n, ctx, el) {
    const d = new Date(Date.now() + (n.st.offset || 0));
    const t = ctx.powered() ? d.toTimeString().slice(0, 8) : '--:--:--';
    const e = el.querySelector('.v-rtc'); if (e.textContent !== t) e.textContent = t;
  },
  i2c: {
    addr: () => 0x68,
    write(n, b) {
      n.rt.ptr = b[0];
      if (b.length > 1 && b[0] <= 6) {
        const d = new Date(Date.now() + (n.st.offset || 0));
        const f = [d.getSeconds(), d.getMinutes(), d.getHours(), d.getDay() || 7, d.getDate(), d.getMonth() + 1, d.getFullYear() % 100];
        for (let i = 1; i < b.length && b[0] + i - 1 <= 6; i++) f[b[0] + i - 1] = unbcd(b[i] & 0x7F);
        const nd = new Date(2000 + f[6], f[5] - 1, f[4], f[2], f[1], f[0]);
        n.st.offset = nd.getTime() - Date.now();
      }
    },
    read(n, len) {
      const d = new Date(Date.now() + (n.st.offset || 0));
      const regs = [d.getSeconds(), d.getMinutes(), d.getHours(), d.getDay() || 7, d.getDate(), d.getMonth() + 1, d.getFullYear() % 100].map(bcd);
      while (regs.length < 0x11) regs.push(0);
      regs.push(25, 0);
      const out = [];
      for (let i = 0; i < len; i++) out.push(regs[((n.rt.ptr || 0) + i) % regs.length]);
      n.rt.ptr = ((n.rt.ptr || 0) + len) % regs.length;
      return out;
    },
  },
  setup: i2cSetup((n, bus) => `DS3231(${bus})`, ['ds3231', 'from ds3231 import DS3231']),
};

// ---------- SPI ----------
DEVICES.max7219 = {
  label: 'MAX7219 8x8', cat: 'spi', icon: '🔴', prefix: 'matrix', desc: 'MAX7219 8x8 도트 매트릭스 (FC-16)',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'DIN', role: 'io' }, { n: 'CS', role: 'io' }, { n: 'CLK', role: 'io' }],
  reset(n) { n.rt.rows = new Uint8Array(8); n.rt.buf = []; n.rt.shut = true; n.rt.test = false; n.rt.int = 7; },
  view: () => `<div class="v-mtx">${'<i></i>'.repeat(64)}</div>`,
  render(n, ctx, el) {
    const on = ctx.powered() && n.rt.rows;
    const key = on ? Array.from(n.rt.rows).join(',') + n.rt.shut + n.rt.test + n.rt.int : 'off';
    if (n._rk === key) return; n._rk = key;
    const is = el.querySelectorAll('.v-mtx i');
    const op = on ? 0.45 + n.rt.int / 30 : 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const lit = on && !n.rt.shut && (n.rt.test || (n.rt.rows[y] >> (7 - x)) & 1);
      const d = is[y * 8 + x];
      d.className = lit ? 'on' : '';
      d.style.opacity = lit ? op : '';
    }
  },
  spi: {
    sck: 'CLK', mosi: 'DIN', cs: 'CS',
    byte(n, b) { if (!n.rt.buf) DEVICES.max7219.reset(n); n.rt.buf.push(b); return 0; },
  },
  onEdge(n, pin, lv) {
    if (pin !== 'CS') return;
    if (!n.rt.buf) DEVICES.max7219.reset(n);
    if (lv === 0) { n.rt.buf = []; return; }
    const b = n.rt.buf;
    if (b.length < 2) return;
    const reg = b[b.length - 2] & 15, val = b[b.length - 1];
    if (reg >= 1 && reg <= 8) n.rt.rows[reg - 1] = val;
    else if (reg === 0x0C) n.rt.shut = !(val & 1);
    else if (reg === 0x0F) n.rt.test = !!(val & 1);
    else if (reg === 0x0A) n.rt.int = val & 15;
    n.rt.buf = [];
  },
  setup(n, C) {
    const bus = C.spi(); const cs = C.gpio('CS');
    if (!bus) return [];
    if (cs == null) return C.warn('CS 핀을 GPIO에 연결하세요');
    C.lib('max7219', 'from max7219 import Matrix8x8');
    return [`${n.name} = Matrix8x8(${bus}, Pin(${cs}, Pin.OUT))`];
  },
};

DEVICES.mcp3008 = {
  label: 'MCP3008 ADC', cat: 'spi', icon: '📈', prefix: 'adc', desc: '8채널 10비트 SPI ADC (CH0~3 노출)',
  pins: [{ n: 'VDD', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'CLK', role: 'io' }, { n: 'DOUT', role: 'io' }, { n: 'DIN', role: 'io' }, { n: 'CS', role: 'io' },
    { n: 'CH0', role: 'io' }, { n: 'CH1', role: 'io' }, { n: 'CH2', role: 'io' }, { n: 'CH3', role: 'io' }],
  spi: {
    sck: 'CLK', mosi: 'DIN', miso: 'DOUT', cs: 'CS',
    byte(n, b) {
      const i = n.rt.idx = (n.rt.idx ?? -1) + 1;
      if (i === 1) {
        const ch = (b >> 4) & 7;
        const v = ch < 4 ? APP.sim.termV(n.id + ':CH' + ch) : 0, vdd = APP.sim.termV(n.id + ':VDD') || 3.3;
        n.rt.val = v == null ? Math.floor(Math.random() * 40) : clamp(Math.round(v / vdd * 1023), 0, 1023);
        return (n.rt.val >> 8) & 3;
      }
      if (i === 2) return n.rt.val & 255;
      return 0;
    },
  },
  onEdge(n, pin, lv) { if (pin === 'CS' && lv === 0) n.rt.idx = -1; },
  setup(n, C) {
    const bus = C.spi(); const cs = C.gpio('CS');
    if (!bus) return [];
    if (cs == null) return C.warn('CS 핀을 GPIO에 연결하세요');
    C.lib('mcp3008', 'from mcp3008 import MCP3008');
    return [`${n.name} = MCP3008(${bus}, Pin(${cs}, Pin.OUT))`];
  },
};

// ---------- UART ----------
DEVICES.gps = {
  label: 'GPS NEO-6M', cat: 'uart', icon: '🛰', prefix: 'gps', desc: 'u-blox NEO-6M GPS (9600bps, 1초마다 NMEA 출력)',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'TX', role: 'io' }, { n: 'RX', role: 'io' }],
  controls: [
    { k: 'lat', type: 'number', label: '위도', step: 0.0001 },
    { k: 'lon', type: 'number', label: '경도', step: 0.0001 },
    { k: 'fix', type: 'check', label: '위성 수신(Fix)' },
  ],
  init: () => ({ lat: 37.5665, lon: 126.978, fix: true, sats: 8, alt: 38 }),
  tick(n, ctx, now) {
    if (!ctx.powered()) return;
    if (!n.rt.last || now - n.rt.last >= 1000) {
      n.rt.last = now;
      n.rt.txq = ((n.rt.txq || '') + gpsSentences(n.st)).slice(-2000);
    }
  },
  uart: { tx: 'TX', rx: 'RX', baud: () => 9600, receive() { } },
  setup: (n, C) => { const u = C.uart(9600); if (!u) return []; C.lib('nmea', 'from nmea import NMEA'); return [`${n.name} = NMEA(${u})`]; },
};

DEVICES.hc05 = {
  label: 'HC-05 블루투스', cat: 'uart', icon: '📶', prefix: 'bt', desc: 'HC-05 블루투스 시리얼 (9600bps). 아래 입력창 = 스마트폰',
  pins: [{ n: 'VCC', role: 'vcc' }, { n: 'GND', role: 'gnd' }, { n: 'TXD', role: 'io' }, { n: 'RXD', role: 'io' }],
  view: () => `<div class="v-bt"><div class="log"></div><form><input placeholder="폰에서 보내기"><button>▶</button></form></div>`,
  mount(n, el) {
    const f = el.querySelector('form'), inp = el.querySelector('input');
    f.addEventListener('submit', e => {
      e.preventDefault();
      if (!APP.sim.running || !APP.sim.powered(n)) { APP.log('HC-05: 시뮬레이션 실행 중이고 전원이 연결되어 있어야 합니다', 'warn'); return; }
      n.rt.txq = (n.rt.txq || '') + inp.value + '\r\n';
      n.rt.log = ((n.rt.log || '') + '📱 ' + inp.value + '\n').slice(-600);
      inp.value = '';
    });
    inp.addEventListener('pointerdown', e => e.stopPropagation());
    inp.addEventListener('keydown', e => e.stopPropagation());
  },
  render(n, ctx, el) {
    const lg = el.querySelector('.log'), t = n.rt.log || '';
    if (lg.textContent !== t) { lg.textContent = t; lg.scrollTop = 1e9; }
  },
  uart: {
    tx: 'TXD', rx: 'RXD', baud: () => 9600,
    receive(n, s) { n.rt.log = ((n.rt.log || '') + '🔵 ' + s.replace(/\r/g, '')).slice(-600); if (!s.endsWith('\n')) n.rt.log += ''; },
  },
  setup: (n, C) => { const u = C.uart(9600); if (!u) return []; return [`${n.name} = ${u}`]; },
};
