// 보드 정의: Raspberry Pi Pico, BBC micro:bit V2
'use strict';

// ---------- micro:bit V2 엣지 커넥터 (앞면 기준 왼쪽 → 오른쪽) ----------
const MB_EDGE = ['3', '0', '4', '5', '6', '7', '1', '8', '9', '10', '11', '12', '2', '13', '14', '15', '16', '3V', '3V', '3V', '19', '20', 'GND', 'GND', 'GND'];
const MB_BIG = new Set([1, 6, 12, 18, 23]);
const MB_FUNCS = {
  0: ['아날로그 입력', '터치', 'music 기본 출력'], 1: ['아날로그 입력', '터치'], 2: ['아날로그 입력', '터치'],
  3: ['아날로그 입력', 'LED 화면 공유'], 4: ['아날로그 입력', 'LED 화면 공유'], 5: ['버튼 A'],
  6: ['LED 화면 공유'], 7: ['LED 화면 공유'], 8: ['디지털'], 9: ['LED 화면 공유'], 10: ['아날로그 입력', 'LED 화면 공유'],
  11: ['버튼 B'], 12: ['예약(접근성)'], 13: ['SPI SCK'], 14: ['SPI MISO'], 15: ['SPI MOSI'], 16: ['디지털'],
  19: ['I2C SCL'], 20: ['I2C SDA'],
};
const MB_PINS = (() => {
  const pins = {};
  let n3 = 0, ng = 0;
  MB_EDGE.forEach((name, i) => {
    let key, p;
    if (name === '3V') { key = ['3V_L', '3V', '3V_R'][n3++]; p = { name: '3V', type: 'power', v: 3.3, gpio: null, funcs: [] }; }
    else if (name === 'GND') { key = ['GND_L', 'GND', 'GND_R'][ng++]; p = { name: 'GND', type: 'gnd', v: 0, gpio: null, funcs: [] }; }
    else { key = 'P' + name; p = { name: 'P' + name, type: 'gpio', gpio: +name, funcs: ['디지털 입출력', 'PWM(write_analog)', ...MB_FUNCS[+name]] }; }
    pins[key] = { ...p, num: key, idx: i, big: MB_BIG.has(i) };
  });
  return pins;
})();
const MB_GPIOS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20];
const MB_DISPLAY_PINS = [3, 4, 6, 7, 9, 10];

const BOARDS = {
  pico: {
    type: 'pico', id: 'pico', label: 'Raspberry Pi Pico', short: 'Pico', icon: '🍓',
    pins: PICO_PINS,
    gpios: GPIO_LIST,
    pinLabel: g => 'GP' + g,
    gpioKey: g => GPIO_TO_PIN[g] ? String(GPIO_TO_PIN[g]) : null,
    pinTitle: p => `핀 ${p.num} · ${p.name}`,
    usbVendor: 0x2E8A,
    desc: 'RP2040 · 264KB RAM · 2MB Flash · GPIO 26개 (3.3V 로직). 핀에 마우스를 올리면 대체 기능(I2C/SPI/UART/ADC/PWM)이 표시됩니다.',
    html() {
      const rows = [];
      for (let i = 0; i < 20; i++) {
        const L = PICO_PINS[i + 1], R = PICO_PINS[40 - i];
        const tip = p => esc(`핀 ${p.num} · ${p.name}${p.gpio != null ? ' (GPIO' + p.gpio + ')' : ''}\n${p.funcs.length ? p.funcs.join(', ') : (PICO_DESC[p.name] || '')}`);
        rows.push(`<div class="prow">
          <i class="port k-pin t-${L.type}" data-t="pico:${L.num}" data-s="-1" title="${tip(L)}"></i>
          <span class="plbl t-${L.type}" data-g="${L.gpio ?? ''}"><small>${L.num}</small>${L.name}</span>
          <span class="pmid"></span>
          <span class="plbl r t-${R.type}" data-g="${R.gpio ?? ''}">${R.name}<small>${R.num}</small></span>
          <i class="port k-pin t-${R.type}" data-t="pico:${R.num}" data-s="1" title="${tip(R)}"></i>
        </div>`);
      }
      return `<div class="nhead" style="--c:#1b7f3b"><span class="ico">🍓</span><span class="ttl">Raspberry Pi Pico</span><b class="nm">RP2040</b></div>
        <div class="pico-board"><div class="usb"></div>
          <div class="pico-center"><div class="obled" title="내장 LED (GP25)"></div><span class="ledlbl">LED GP25</span>
            <div class="rp2040">RP2040</div><div class="bootsel" data-hold="boot" title="BOOTSEL 버튼 (rp2.bootsel_button())">BOOTSEL</div><div class="flash">W25Q16</div></div>
          <div class="prows">${rows.join('')}</div>
        </div>`;
    },
    render(n, sim) { renderBoardPins(n, sim, 25); },
  },

  microbit: {
    type: 'microbit', id: 'mb', label: 'BBC micro:bit V2', short: 'micro:bit', icon: '🟦',
    pins: MB_PINS,
    gpios: MB_GPIOS,
    pinLabel: g => 'P' + g,
    gpioKey: g => MB_GPIOS.includes(g) ? 'P' + g : null,
    pinTitle: p => `엣지 커넥터 ${p.name}`,
    usbVendor: 0x0D28,
    desc: 'nRF52833 · 128KB RAM · 5x5 LED, 버튼 A/B, 터치 로고, 가속도/나침반, 마이크, 스피커, 온도·빛 센서 내장. 엣지 커넥터 25핀(3.3V 로직). 사용하려면 MicroPython 펌웨어(python.microbit.org)가 필요합니다.',
    controls: [
      { k: 'tx', type: 'range', label: '기울기X', min: -90, max: 90, unit: '°' },
      { k: 'ty', type: 'range', label: '기울기Y', min: -90, max: 90, unit: '°' },
      { k: 'temp', type: 'range', label: '온도', min: -10, max: 50, unit: '°C' },
      { k: 'light', type: 'range', label: '빛', min: 0, max: 255 },
      { k: 'sound', type: 'range', label: '소리', min: 0, max: 255 },
      { k: 'heading', type: 'range', label: '나침반', min: 0, max: 359, unit: '°' },
    ],
    init: () => ({ tx: 0, ty: 0, temp: 22, light: 120, sound: 30, heading: 0, btnA: false, btnB: false, logo: false }),
    html(n, ed) {
      const edge = MB_EDGE.map((nm, i) => {
        const key = Object.values(MB_PINS).find(p => p.idx === i).num;
        const p = MB_PINS[key];
        const tip = esc(`${p.name}\n${p.funcs.join(', ')}`);
        return `<div class="ep${p.big ? ' big' : ''} t-${p.type}"><span>${nm}</span><i class="port k-pin t-${p.type}" data-t="mb:${key}" data-s="d" title="${tip}"></i></div>`;
      }).join('');
      const ctls = this.controls.map(c => ed.controlHTML(n, c)).join('');
      return `<div class="nhead" style="--c:#2c7be5"><span class="ico">🟦</span><span class="ttl">BBC micro:bit V2</span><b class="nm">nRF52833</b></div>
        <div class="mb-board">
          <div class="mb-face">
            <div class="mb-logo" data-hold="logo" title="터치 로고 (pin_logo)">◉</div>
            <div class="mb-row">
              <button class="mb-btn" data-hold="btnA" data-press="A" title="버튼 A (P5)">A</button>
              <div class="mb-leds">${'<i></i>'.repeat(25)}</div>
              <button class="mb-btn" data-hold="btnB" data-press="B" title="버튼 B (P11)">B</button>
            </div>
            <div class="mb-extra"><button class="mini" data-shake>🤚 흔들기</button><span class="mb-spk" title="스피커">🔈</span></div>
            <div class="mb-ctls">${ctls}</div>
          </div>
          <div class="mb-edge">${edge}</div>
        </div>`;
    },
    mount(n, el, app) {
      el.querySelectorAll('[data-press]').forEach(b => b.addEventListener('pointerdown', () => {
        n.rt.presses = n.rt.presses || { A: 0, B: 0 };
        n.rt.presses[b.dataset.press]++;
      }));
      const sh = el.querySelector('[data-shake]');
      sh.addEventListener('pointerdown', e => e.stopPropagation());
      sh.addEventListener('click', () => { n.rt.shakeUntil = performance.now() + 600; });
    },
    // 버튼 A/B: 보드 풀업 저항, 누르면 GND
    outputs(n) {
      return {
        P5: n.st.btnA ? { v: 0 } : { v: 3.3, weak: true },
        P11: n.st.btnB ? { v: 0 } : { v: 3.3, weak: true },
      };
    },
    accel(n) {
      const r = Math.PI / 180, s = n.st;
      if (n.rt.shakeUntil && performance.now() < n.rt.shakeUntil) return [((Math.random() - 0.5) * 4000) | 0, ((Math.random() - 0.5) * 4000) | 0, ((Math.random() - 0.5) * 4000) | 0];
      return [Math.round(Math.sin(s.tx * r) * 1024), Math.round(Math.sin(s.ty * r) * 1024), Math.round(-Math.cos(s.tx * r) * Math.cos(s.ty * r) * 1024)];
    },
    render(n, sim) {
      const el = n.el;
      if (!n._leds || !n._leds[0].isConnected) n._leds = [...el.querySelectorAll('.mb-leds i')];
      const disp = sim.running ? (n.rt.display || '') : '';
      if (n._dk !== disp) {
        n._dk = disp;
        n._leds.forEach((d, i) => {
          const b = +(disp[i] || 0);
          d.style.opacity = b ? 0.25 + b / 12 : '';
          d.classList.toggle('on', b > 0);
        });
      }
      el.querySelectorAll('.mb-btn').forEach(b => b.classList.toggle('on', !!n.st[b.dataset.hold]));
      el.querySelector('.mb-logo').classList.toggle('on', !!n.st.logo);
      const tone = sim.running && n.rt.tone > 0;
      Sound.set('mb-speaker', n.rt.tone || 0, tone);
      el.querySelector('.mb-spk').classList.toggle('on', tone);
    },
    stop(n) { Sound.set('mb-speaker', 0, false); n.rt.display = ''; n.rt.tone = 0; },
  },
};

// 양쪽 핀 라벨에 GPIO 상태(HIGH/LOW/PWM/입력) 표시 + 보드 LED
function renderBoardPins(n, sim, ledGpio) {
  if (!n._lbl || !n._lbl[0] || !n._lbl[0].isConnected) n._lbl = [...n.el.querySelectorAll('.plbl[data-g]')].filter(x => x.dataset.g !== '');
  for (const l of n._lbl) {
    const st = sim.gp[+l.dataset.g];
    const cls = !sim.running || !st.mode ? '' : st.pwm ? 'pwm' : st.mode === 'out' ? (st.val ? 'hi' : 'lo') : 'in';
    if (l._c !== cls) { l.classList.remove('hi', 'lo', 'pwm', 'in'); if (cls) l.classList.add(cls); l._c = cls; }
  }
  const led = n._led && n._led.isConnected ? n._led : (n._led = n.el.querySelector('.obled'));
  const st = sim.gp[ledGpio];
  const on = st.mode === 'out' && (st.pwm ? st.pwm.duty > 0 : st.val === 1);
  if (led && led._on !== on) { led.classList.toggle('on', on); led._on = on; }
}

// ---------- ESP32-DevKitC V4 (38핀, USB 아래쪽 기준 위→아래) ----------
const ESP_LEFT = [['3V3', 'power'], ['EN', 'ctrl'], ['VP', 36], ['VN', 39], ['IO34', 34], ['IO35', 35], ['IO32', 32], ['IO33', 33], ['IO25', 25], ['IO26', 26],
  ['IO27', 27], ['IO14', 14], ['IO12', 12], ['GND', 'gnd'], ['IO13', 13], ['SD2', 'flash'], ['SD3', 'flash'], ['CMD', 'flash'], ['5V', 'power5']];
const ESP_RIGHT = [['GND', 'gnd'], ['IO23', 23], ['IO22', 22], ['TX0', 1], ['RX0', 3], ['IO21', 21], ['GND', 'gnd'], ['IO19', 19], ['IO18', 18], ['IO5', 5],
  ['IO17', 17], ['IO16', 16], ['IO4', 4], ['IO0', 0], ['IO2', 2], ['IO15', 15], ['SD1', 'flash'], ['SD0', 'flash'], ['CLK', 'flash']];
const ESP_FUNCS = {
  0: ['ADC2_1', 'TOUCH1', '스트래핑(BOOT 버튼)'], 1: ['UART0 TX (USB REPL)'], 2: ['ADC2_2', 'TOUCH2', '스트래핑', '보드 LED(일반적)'], 3: ['UART0 RX (USB REPL)'],
  4: ['ADC2_0', 'TOUCH0'], 5: ['VSPI CS', '스트래핑'], 12: ['ADC2_5', 'TOUCH5', 'HSPI MISO', '스트래핑(부팅 시 LOW)'], 13: ['ADC2_4', 'TOUCH4', 'HSPI MOSI'],
  14: ['ADC2_6', 'TOUCH6', 'HSPI SCK'], 15: ['ADC2_3', 'TOUCH3', 'HSPI CS', '스트래핑'], 16: ['UART2 RX'], 17: ['UART2 TX'], 18: ['VSPI SCK'], 19: ['VSPI MISO'],
  21: ['I2C SDA(관례)'], 22: ['I2C SCL(관례)'], 23: ['VSPI MOSI'], 25: ['ADC2_8', 'DAC1'], 26: ['ADC2_9', 'DAC2'], 27: ['ADC2_7', 'TOUCH7'],
  32: ['ADC1_4', 'TOUCH9'], 33: ['ADC1_5', 'TOUCH8'], 34: ['ADC1_6', '입력 전용'], 35: ['ADC1_7', '입력 전용'], 36: ['ADC1_0', '입력 전용'], 39: ['ADC1_3', '입력 전용'],
};
const ESP_ADC = [32, 33, 34, 35, 36, 39, 0, 2, 4, 12, 13, 14, 15, 25, 26, 27];
const ESP_TOUCH = [0, 2, 4, 12, 13, 14, 15, 27, 32, 33];
const ESP_PINS = (() => {
  const pins = {};
  const mk = (side, list) => list.forEach(([name, t], i) => {
    const key = side + (i + 1);
    const p = { num: key, name, side, gpio: null, funcs: [], type: 'gpio' };
    if (typeof t === 'number') { p.gpio = t; p.funcs = [...(t < 34 ? ['디지털 입출력', 'PWM'] : ['디지털 입력']), ...(ESP_FUNCS[t] || [])]; }
    else if (t === 'gnd') { p.type = 'gnd'; p.v = 0; }
    else if (t === 'power') { p.type = 'power'; p.v = 3.3; }
    else if (t === 'power5') { p.type = 'power5'; p.v = 5.0; }
    else { p.type = 'ctrl'; p.funcs = [t === 'flash' ? '내장 SPI 플래시 연결 — 사용 금지' : 'EN(리셋, LOW = 리셋)']; }
    pins[key] = p;
  });
  mk('L', ESP_LEFT); mk('R', ESP_RIGHT);
  return pins;
})();
const ESP_GPIO_KEY = {};
Object.values(ESP_PINS).forEach(p => { if (p.gpio != null) ESP_GPIO_KEY[p.gpio] = p.num; });
const ESP_GPIOS = Object.keys(ESP_GPIO_KEY).map(Number).sort((a, b) => a - b);

BOARDS.esp32 = {
  type: 'esp32', id: 'esp', label: 'ESP32 DevKitC', short: 'ESP32', icon: '📡',
  pins: ESP_PINS,
  gpios: ESP_GPIOS,
  pinLabel: g => 'GPIO' + g,
  gpioKey: g => ESP_GPIO_KEY[g] || null,
  desc: 'ESP32-WROOM-32 · 듀얼코어 240MHz · 520KB SRAM · WiFi/Bluetooth · 3.3V 로직. GPIO34~39는 입력 전용(풀업 없음), SD0~3/CLK/CMD(GPIO6~11)는 플래시용이라 사용할 수 없습니다. I2C/SPI/UART는 아무 핀에나 배정할 수 있습니다.',
  controls: [{ k: 'temp', type: 'range', label: '칩 온도', min: 20, max: 80, unit: '°C' }],
  init: () => ({ temp: 45, boot: false }),
  html(n, ed) {
    const rows = [];
    const tip = p => esc(`${p.name}${p.gpio != null ? ' (GPIO' + p.gpio + ')' : ''}\n${p.funcs.join(', ')}`);
    const lbl = p => p.gpio != null && !/^IO\d/.test(p.name) ? `${p.name}<small class="g">${p.gpio}</small>` : p.name;
    for (let i = 1; i <= 19; i++) {
      const L = ESP_PINS['L' + i], R = ESP_PINS['R' + i];
      rows.push(`<div class="prow">
        <i class="port k-pin t-${L.type}" data-t="esp:${L.num}" data-s="-1" title="${tip(L)}"></i>
        <span class="plbl t-${L.type}" data-g="${L.gpio ?? ''}">${lbl(L)}</span>
        <span class="pmid"></span>
        <span class="plbl r t-${R.type}" data-g="${R.gpio ?? ''}">${lbl(R)}</span>
        <i class="port k-pin t-${R.type}" data-t="esp:${R.num}" data-s="1" title="${tip(R)}"></i>
      </div>`);
    }
    const ctls = this.controls.map(c => ed.controlHTML(n, c)).join('');
    return `<div class="nhead" style="--c:#c0392b"><span class="ico">📡</span><span class="ttl">ESP32 DevKitC</span><b class="nm">WROOM-32</b></div>
      <div class="esp-board">
        <div class="esp-center">
          <div class="esp-mod"><div class="ant"></div><div class="can">ESP32<br><small>WROOM-32</small></div></div>
          <div class="esp-wifi" title="WiFi 상태">📶</div>
          <div class="obled blue" title="보드 LED (GPIO2)"></div><span class="ledlbl">LED IO2</span>
          <div class="esp-btns"><button class="mini" data-hold="boot" title="BOOT 버튼 (GPIO0 → GND)">BOOT</button><span class="mini en">EN</span></div>
          <div class="usb bottom"></div>
        </div>
        <div class="prows">${rows.join('')}</div>
        <div class="esp-ctls">${ctls}</div>
      </div>`;
  },
  outputs(n) { return { R14: n.st.boot ? { v: 0 } : { v: 3.3, weak: true } }; },
  render(n, sim) {
    renderBoardPins(n, sim, 2);
    const w = n.el.querySelector('.esp-wifi');
    const on = sim.running && n.rt.wifi === 'connected';
    w.classList.toggle('on', on);
    w.classList.toggle('busy', sim.running && n.rt.wifi === 'connecting');
    const b = n.el.querySelector('[data-hold=boot]');
    b.classList.toggle('on', !!n.st.boot);
  },
  stop(n) { n.rt.wifi = ''; },
};

// ---------- Waveshare RP2040-Zero (USB-C 위쪽 기준) ----------
// 왼쪽(위→아래): 5V GND 3V3 GP29 GP28 GP27 GP26 GP15 GP14 / 오른쪽: GP0~GP8 / 아래쪽(왼→오): GP13~GP9
// 뒷면 납땜 패드: GND GP25~GP17 / GP16 = 내장 WS2812 RGB LED(DIN)
const ZERO_LEFT = ['5V', 'GND', '3V3', 29, 28, 27, 26, 15, 14];
const ZERO_RIGHT = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const ZERO_BOTTOM = [13, 12, 11, 10, 9];
const ZERO_BACK = ['GND', 25, 24, 23, 22, 21, 20, 19, 18, 17];
const ZERO_PINS = (() => {
  const pins = {};
  const mk = (pre, list) => list.forEach((v, i) => {
    const key = pre + (i + 1);
    const p = { num: key, gpio: null, funcs: [], type: 'gpio' };
    if (typeof v === 'number') { p.gpio = v; p.name = 'GP' + v; p.funcs = gpioFunctions(v); if (pre === 'U') p.funcs = ['뒷면 납땜 패드', ...p.funcs]; }
    else if (v === 'GND') { p.name = 'GND'; p.type = 'gnd'; p.v = 0; }
    else if (v === '3V3') { p.name = '3V3'; p.type = 'power'; p.v = 3.3; }
    else { p.name = '5V'; p.type = 'power5'; p.v = 5.0; }
    pins[key] = p;
  });
  mk('L', ZERO_LEFT); mk('R', ZERO_RIGHT); mk('B', ZERO_BOTTOM); mk('U', ZERO_BACK);
  return pins;
})();
const ZERO_GPIO_KEY = {};
Object.values(ZERO_PINS).forEach(p => { if (p.gpio != null) ZERO_GPIO_KEY[p.gpio] = p.num; });
const ZERO_GPIOS = Object.keys(ZERO_GPIO_KEY).map(Number).sort((a, b) => a - b);

BOARDS.rp2040zero = {
  type: 'rp2040zero', id: 'zero', label: 'Waveshare RP2040-Zero', short: 'RP2040-Zero', icon: '🟩',
  pins: ZERO_PINS,
  gpios: ZERO_GPIOS,
  pinLabel: g => 'GP' + g,
  gpioKey: g => ZERO_GPIO_KEY[g] || null,
  rgbGpio: 16,
  desc: 'RP2040 · 264KB SRAM · 2MB Flash · USB-C · 초소형(23.5x18mm). 헤더로 20개 GPIO(GP0~15, GP26~29), 뒷면 납땜 패드로 GP17~25를 사용합니다. GP16은 내장 WS2812 RGB LED에 연결되어 있고 일반 LED는 없습니다. GP29는 ADC3으로 사용 가능합니다. MicroPython은 Pico(RP2040)용 펌웨어를 사용합니다.',
  init: () => ({ boot: false }),
  html(n) {
    const tip = p => esc(`${p.name}${p.gpio != null ? ' (GPIO' + p.gpio + ')' : ''}\n${p.funcs.join(', ')}`);
    const side = (pre, list, dir) => list.map((_, i) => {
      const p = ZERO_PINS[pre + (i + 1)];
      const port = `<i class="port k-pin t-${p.type}" data-t="zero:${p.num}" data-s="${dir}" title="${tip(p)}"></i>`;
      const lbl = `<span class="plbl t-${p.type}${dir > 0 ? ' r' : ''}" data-g="${p.gpio ?? ''}">${p.name}</span>`;
      return `<div class="zrow">${dir < 0 ? port + lbl : lbl + port}</div>`;
    }).join('');
    const down = (pre, list) => list.map((_, i) => {
      const p = ZERO_PINS[pre + (i + 1)];
      return `<div class="zep t-${p.type}"><span class="plbl t-${p.type}" data-g="${p.gpio ?? ''}">${p.gpio != null ? p.gpio : p.name}</span><i class="port k-pin t-${p.type}" data-t="zero:${p.num}" data-s="d" title="${tip(p)}"></i></div>`;
    }).join('');
    return `<div class="nhead" style="--c:#2e9e57"><span class="ico">🟩</span><span class="ttl">RP2040-Zero</span><b class="nm">Waveshare</b></div>
      <div class="zero-board">
        <div class="zero-main">
          <div class="zcol">${side('L', ZERO_LEFT, -1)}</div>
          <div class="zcenter">
            <div class="usbc"></div>
            <div class="zbtns"><span class="zbtn" data-hold="boot" title="BOOT 버튼 (rp2.bootsel_button())">BOOT</span><span class="zbtn rst" title="RESET">RESET</span></div>
            <div class="zrgb" title="내장 WS2812 RGB LED (GP16)"></div><span class="ledlbl">RGB GP16</span>
            <div class="rp2040 sm">RP2040</div>
          </div>
          <div class="zcol r">${side('R', ZERO_RIGHT, 1)}</div>
        </div>
        <div class="zbottom">${down('B', ZERO_BOTTOM)}</div>
        <div class="zback"><div class="zbacklbl">뒷면 납땜 패드</div><div class="zbackpins">${down('U', ZERO_BACK)}</div></div>
      </div>`;
  },
  render(n, sim) {
    renderBoardPins(n, sim, 16);
    const el = n._rgb && n._rgb.isConnected ? n._rgb : (n._rgb = n.el.querySelector('.zrgb'));
    const px = sim.running ? n.rt.rgb : null;
    const key = px ? Array.from(px.slice(0, 3)).join(',') : '';
    if (el && el._k !== key) {
      el._k = key;
      const g = px ? px[0] : 0, r = px ? px[1] : 0, b = px ? px[2] : 0, m = Math.max(r, g, b);
      const k = m ? 255 / m : 0, sc = Math.min(1, 0.35 + m / 120);
      const c = `rgb(${r * k * sc | 0},${g * k * sc | 0},${b * k * sc | 0})`;
      el.style.background = m ? c : '';
      el.style.boxShadow = m ? `0 0 ${6 + m / 12}px 2px ${c}` : '';
    }
    const bt = n.el.querySelector('.zbtn[data-hold]');
    if (bt) bt.classList.toggle('on', !!n.st.boot);
  },
  stop(n) { n.rt.rgb = null; },
};

const boardDef = n => n && BOARDS[n.type];
