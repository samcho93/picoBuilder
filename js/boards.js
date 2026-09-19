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
            <div class="rp2040">RP2040</div><div class="bootsel">BOOTSEL</div><div class="flash">W25Q16</div></div>
          <div class="prows">${rows.join('')}</div>
        </div>`;
    },
    render(n, sim) {
      if (!n._lbl || !n._lbl[0] || !n._lbl[0].isConnected) n._lbl = [...n.el.querySelectorAll('.plbl[data-g]')].filter(x => x.dataset.g !== '');
      for (const l of n._lbl) {
        const st = sim.gp[+l.dataset.g];
        const cls = !sim.running || !st.mode ? '' : st.pwm ? 'pwm' : st.mode === 'out' ? (st.val ? 'hi' : 'lo') : 'in';
        if (l._c !== cls) { l.classList.remove('hi', 'lo', 'pwm', 'in'); if (cls) l.classList.add(cls); l._c = cls; }
      }
      const led = n._led && n._led.isConnected ? n._led : (n._led = n.el.querySelector('.obled'));
      const on = sim.gp[25].mode === 'out' && sim.gp[25].val === 1;
      if (led && led._on !== on) { led.classList.toggle('on', on); led._on = on; }
    },
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

const boardDef = n => n && BOARDS[n.type];
