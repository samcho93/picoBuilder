// 회로 시뮬레이션 엔진: 네트(전기적 연결) 계산, GPIO 상태, 버스(I2C/SPI/UART) 라우팅
'use strict';

const VLOGIC = 3.3;

class Sim {
  constructor(app) {
    this.app = app;
    this.running = false;
    this.stopFlag = false;
    this.topoDirty = true;
    this.nets = [];
    this.netOf = new Map();
    this.nv = [];
    this.prevLevel = new Map();
    this.events = [];
    this.timers = new Map();
    this.dispatcher = null;
    this.stepping = false;
    this.stepAgain = false;
    this.shortNets = new Set();
    this.resetGpio();
  }

  get circuit() { return this.app.circuit; }

  resetGpio() {
    this.gp = {};
    for (let g = 0; g <= 39; g++) this.gp[g] = { mode: null, val: 0, pull: null, pwm: null, irq: 0 };
  }

  // ---------- 실행 제어 ----------
  start() {
    this.resetGpio();
    this.events = [];
    this.stopFlag = false;
    this.running = true;
    this.t0 = performance.now();
    for (const n of this.circuit.nodes) {
      const d = DEVICES[n.type];
      n.rt = {};
      if (d && d.reset) d.reset(n);
    }
    this.startMs = performance.now();
    this.topoDirty = true;
    this.step();
  }

  stop() {
    this.stopFlag = true;
    this.running = false;
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
    this.events = [];
    this.dispatcher = null;
    this.resetGpio();
    for (const n of this.circuit.nodes) {
      const d = DEVICES[n.type] || BOARDS[n.type];
      if (d && d.stop) d.stop(n);
    }
    this.step();
  }

  // ---------- 토폴로지 ----------
  invalidate() { this.topoDirty = true; }

  rebuild() {
    const parent = new Map();
    const find = t => {
      let r = t;
      while (parent.get(r) !== r) r = parent.get(r);
      let c = t;
      while (parent.get(c) !== r) { const nx = parent.get(c); parent.set(c, r); c = nx; }
      return r;
    };
    const union = (a, b) => {
      if (!parent.has(a) || !parent.has(b)) return;
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    for (const n of this.circuit.nodes) {
      for (const p of nodePins(n)) { const t = n.id + ':' + p.n; parent.set(t, t); }
    }
    for (const w of this.circuit.wires) union(w.a, w.b);
    for (const n of this.circuit.nodes) {
      const d = DEVICES[n.type];
      if (d && d.closed) for (const [a, b] of d.closed(n)) union(n.id + ':' + a, n.id + ':' + b);
    }
    this.nodeById = new Map(this.circuit.nodes.map(n => [n.id, n]));
    const idx = new Map();
    this.nets = [];
    this.netOf = new Map();
    for (const t of parent.keys()) {
      const r = find(t);
      if (!idx.has(r)) { idx.set(r, this.nets.length); this.nets.push({ terms: [], pico: [], gpios: [], dev: [] }); }
      const ni = idx.get(r);
      const net = this.nets[ni];
      this.netOf.set(t, ni);
      net.terms.push(t);
      const [nid, pin] = splitTerm(t);
      const bn = this.nodeById.get(nid);
      if (bn && BOARDS[bn.type]) {
        const pp = BOARDS[bn.type].pins[pin];
        net.pico.push(pp);
        if (pp.gpio !== null) net.gpios.push(pp.gpio);
      } else net.dev.push({ nid, pin });
    }
    this.topoDirty = false;
  }

  netIndex(term) {
    if (this.topoDirty) this.rebuild();
    const i = this.netOf.get(term);
    return i === undefined ? -1 : i;
  }
  board() { return this.circuit.nodes.find(n => BOARDS[n.type]); }
  gpioNet(g) {
    const b = this.board();
    const key = b && BOARDS[b.type].gpioKey(g);
    return key ? this.netIndex(b.id + ':' + key) : -1;
  }

  // ---------- 전압 계산 ----------
  evaluate() {
    if (this.topoDirty) this.rebuild();
    const N = this.nets.length;
    let devDrv = new Map();
    let nv = new Array(N);
    for (let pass = 0; pass < 3; pass++) {
      const out = new Array(N);
      for (let i = 0; i < N; i++) {
        const net = this.nets[i];
        const strong = [], weak = [];
        for (const p of net.pico) {
          if (p.type === 'gnd') strong.push({ v: 0 });
          else if (p.type === 'power' || p.type === 'power5') strong.push({ v: p.v });
        }
        for (const g of net.gpios) {
          const st = this.gp[g];
          if (st.mode === 'out') {
            if (st.pwm) strong.push({ v: VLOGIC * st.pwm.duty / 65535, pwm: st.pwm });
            else strong.push({ v: st.val ? VLOGIC : 0 });
          } else if (st.mode === 'od') {
            if (!st.val) strong.push({ v: 0 });
            else if (st.pull === 'up') weak.push({ v: VLOGIC });
          } else if (st.pull === 'up') weak.push({ v: VLOGIC });
          else if (st.pull === 'down') weak.push({ v: 0 });
        }
        const dd = devDrv.get(i);
        if (dd) for (const d of dd) (d.weak ? weak : strong).push(d);
        let v = null, pwm = null, short = false;
        if (strong.length) {
          let mn = Infinity, mx = -Infinity;
          for (const s of strong) { mn = Math.min(mn, s.v); mx = Math.max(mx, s.v); if (s.pwm) pwm = s.pwm; }
          if (mx - mn > 0.9 && strong.length > 1) { short = true; v = mn; }
          else v = strong.length > 1 && !pwm ? mx : strong[0].v;
          if (pwm && strong.length > 1) pwm = null;
          if (pwm) v = strong.find(s => s.pwm).v;
        } else if (weak.length) {
          v = weak.reduce((a, s) => a + s.v, 0) / weak.length;
        }
        out[i] = { v, pwm, short };
      }
      nv = out;
      this.nv = nv;
      if (pass < 2) {
        devDrv = new Map();
        for (const n of this.circuit.nodes) {
          const d = DEVICES[n.type] || BOARDS[n.type];
          if (!d || !d.outputs) continue;
          const drv = d.outputs(n, this.ctx(n));
          if (!drv) continue;
          for (const pin in drv) {
            const x = drv[pin];
            if (x == null) continue;
            const ni = this.netOf.get(n.id + ':' + pin);
            if (ni === undefined) continue;
            if (!devDrv.has(ni)) devDrv.set(ni, []);
            devDrv.get(ni).push(typeof x === 'number' ? { v: x } : x);
          }
        }
      }
    }
    this.shortNets = new Set();
    nv.forEach((x, i) => { if (x.short) this.shortNets.add(i); });
    return nv;
  }

  netV(i) { return i < 0 || !this.nv[i] ? null : this.nv[i].v; }
  netLevel(i) {
    if (i < 0 || !this.nv[i]) return null;
    const x = this.nv[i];
    if (x.pwm && x.pwm.freq > 0) {
      const per = 1000 / x.pwm.freq;
      return (performance.now() % per) < per * x.pwm.duty / 65535 ? 1 : 0;
    }
    if (x.v == null) return null;
    return x.v >= 1.65 ? 1 : 0;
  }
  termV(t) { return this.netV(this.netIndex(t)); }
  termLevel(t) { return this.netLevel(this.netIndex(t)); }

  // 장치 시뮬레이션용 컨텍스트
  ctx(node) {
    const sim = this;
    const T = pin => node.id + ':' + pin;
    return {
      sim,
      v: pin => sim.netV(sim.netOf.get(T(pin)) ?? -1),
      d: pin => sim.netLevel(sim.netOf.get(T(pin)) ?? -1),
      pwm: pin => { const i = sim.netOf.get(T(pin)); return i === undefined || !sim.nv[i] ? null : sim.nv[i].pwm; },
      wired: pin => { const i = sim.netOf.get(T(pin)); return i !== undefined && sim.nets[i] && sim.nets[i].terms.length > 1; },
      powered: () => sim.powered(node),
      now: () => performance.now(),
    };
  }

  powered(node) {
    const d = DEVICES[node.type];
    if (!d) return false;
    for (const p of nodePins(node)) {
      if (p.role !== 'vcc' && p.role !== 'gnd') continue;
      const v = this.termV(node.id + ':' + p.n);
      if (p.role === 'vcc' && (v == null || v < 2.7)) return false;
      if (p.role === 'gnd' && v !== 0) return false;
    }
    return true;
  }

  // 변화 감지(엣지) -> 장치 onEdge, GPIO IRQ
  step() {
    if (this.stepping) { this.stepAgain = true; return; }
    this.stepping = true;
    try {
      let guard = 0;
      do {
        this.stepAgain = false;
        this.evaluate();
        this.detectEdges();
      } while (this.stepAgain && ++guard < 5);
    } finally { this.stepping = false; }
  }

  detectEdges() {
    for (const n of this.circuit.nodes) {
      const d = DEVICES[n.type];
      if (!d || !d.onEdge) continue;
      const ctx = this.ctx(n);
      for (const p of nodePins(n)) {
        const t = n.id + ':' + p.n;
        const lv = this.termLevel(t);
        const prev = this.prevLevel.get(t);
        this.prevLevel.set(t, lv);
        if (prev !== undefined && prev !== lv && lv !== null) d.onEdge(n, p.n, lv, ctx);
      }
    }
    for (let g = 0; g <= 39; g++) {
      const st = this.gp[g];
      const key = 'gpio' + g;
      let lv;
      if (g === 25 && this.board()?.type === 'pico') lv = st.mode === 'out' ? st.val : 0;
      else {
        const ni = this.gpioNet(g);
        lv = ni < 0 ? 0 : (this.netLevel(ni) ?? (st.pull === 'up' ? 1 : 0));
      }
      const prev = this.prevLevel.get(key);
      this.prevLevel.set(key, lv);
      if (this.running && st.irq && prev !== undefined && prev !== lv) {
        const flag = lv ? 8 : 4;
        if (st.irq & flag) this.queue('irq', g, flag);
      }
    }
  }

  queue(kind, id, arg) {
    if (!this.running) return;
    this.events.push([kind, id, arg]);
    if (!this.flushPending) {
      this.flushPending = true;
      setTimeout(() => this.flush(), 0);
    }
  }
  flush() {
    this.flushPending = false;
    const ev = this.events; this.events = [];
    if (!this.running || !this.dispatcher) return;
    for (const [k, id, a] of ev) {
      try { this.dispatcher(k, id, a); } catch (e) { this.app.log(String(e), 'err'); }
    }
  }

  // ---------- 장치 검색 ----------
  devicesOnNet(ni, filter) {
    if (ni < 0) return [];
    const res = [];
    for (const { nid, pin } of this.nets[ni].dev) {
      const node = this.nodeById.get(nid);
      if (node && (!filter || filter(node, pin))) res.push({ node, pin });
    }
    return res;
  }

  i2cDevices(sda, scl) {
    const ns = this.gpioNet(sda), nc = this.gpioNet(scl);
    if (ns < 0 || nc < 0) return [];
    this.evaluate();
    return this.circuit.nodes.filter(n => {
      const d = DEVICES[n.type];
      if (!d || !d.i2c) return false;
      return this.netIndex(n.id + ':SDA') === ns && this.netIndex(n.id + ':SCL') === nc && this.powered(n);
    });
  }
}

function splitTerm(t) { const i = t.indexOf(':'); return [t.slice(0, i), t.slice(i + 1)]; }

function nodePins(node) {
  if (BOARDS[node.type]) return Object.values(BOARDS[node.type].pins).map(p => ({ n: String(p.num), role: p.type }));
  const d = DEVICES[node.type];
  return d ? d.pins : [];
}

const s2b = s => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
const b2s = b => { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 255); return s; };

// ---------- Python(pbhw) 브리지 ----------
function makeHwApi(sim) {
  const now = () => performance.now();
  const garble = s => b2s(s2b(s).map(x => (x * 37 + 11) & 255));
  const api = {
    now_ms: () => now(),
    now_us: () => now() * 1000,
    is_stopped: () => sim.stopFlag,
    set_dispatcher: fn => { sim.dispatcher = (k, id, a) => fn(k, id, a); },
    log: (s) => sim.app.log(String(s), 'warn'),

    pin_init(g, mode, pull) {
      const st = sim.gp[g];
      if (mode !== null && mode !== undefined && mode >= 0) st.mode = ['in', 'out', 'od', 'alt'][mode] || 'in';
      if (pull !== null && pull !== undefined && pull >= 0) st.pull = pull === 1 ? 'up' : pull === 2 ? 'down' : null;
      if (st.mode === 'in' && st.pwm) st.pwm = null;
      sim.step();
    },
    pin_write(g, v) {
      const st = sim.gp[g];
      st.val = v ? 1 : 0;
      if (!st.mode || st.mode === 'in') {
        // MicroPython: 입력 모드에서 value() 쓰기는 출력 래치만 설정
      }
      st.pwm = null;
      sim.step();
    },
    pin_read(g) {
      const st = sim.gp[g];
      if (g === 25 && sim.board()?.type === 'pico') return st.val;
      sim.step();
      const ni = sim.gpioNet(g);
      const lv = ni < 0 ? null : sim.netLevel(ni);
      if (lv === null) return st.pull === 'up' ? 1 : 0;
      return lv;
    },
    pin_irq(g, trig) { sim.gp[g].irq = trig; sim.step(); },
    pwm_set(g, freq, duty) {
      const st = sim.gp[g];
      st.mode = 'out';
      st.pwm = { freq, duty: Math.max(0, Math.min(65535, duty)) };
      sim.step();
    },
    pwm_off(g) { const st = sim.gp[g]; st.pwm = null; st.val = 0; sim.step(); },

    adc_read(ch) {
      if (ch === 4) {
        const T = 24 + Math.random() * 1.5;
        return Math.round((0.706 - (T - 27) * 0.001721) / 3.3 * 65535);
      }
      if (ch === 3) return Math.round(5.0 / 3 / 3.3 * 65535);
      sim.step();
      const ni = sim.gpioNet(26 + ch);
      const v = sim.netV(ni);
      if (v == null) return Math.round(300 + Math.random() * 1500);
      const noise = (Math.random() - 0.5) * 60;
      return Math.max(0, Math.min(65535, Math.round(v / 3.3 * 65535 + noise)));
    },

    adc_pin(g) {
      sim.step();
      const v = sim.netV(sim.gpioNet(g));
      if (v == null) return Math.round(300 + Math.random() * 1500);
      return Math.max(0, Math.min(65535, Math.round(v / 3.3 * 65535 + (Math.random() - 0.5) * 60)));
    },

    // ---- micro:bit 전용 ----
    mb_display(s) { const b = sim.board(); if (b) b.rt.display = String(s); },
    mb_presses(k, reset) {
      const b = sim.board(); if (!b) return 0;
      const p = b.rt.presses = b.rt.presses || { A: 0, B: 0 };
      const v = p[k] || 0;
      if (reset) p[k] = 0;
      return v;
    },
    mb_state() {
      const b = sim.board(); if (!b || b.type !== 'microbit') return [0, 0, -1024, 20, 0, 0, 0, 0];
      const a = BOARDS.microbit.accel(b), s = b.st;
      return [a[0], a[1], a[2], s.temp, s.light, s.sound, s.heading, s.logo ? 1 : 0];
    },
    mb_tone(g, f) {
      const b = sim.board();
      if (f > 0) api.pwm_set(g, f, 32768); else api.pwm_off(g);
      if (b) b.rt.tone = f > 0 ? f : 0;
    },
    mb_touched(g) { sim.step(); const ni = sim.gpioNet(g); return ni >= 0 && sim.netV(ni) === 0 && sim.nets[ni].terms.length > 1; },
    run_ms: () => performance.now() - (sim.startMs || 0),
    board_type: () => (sim.board() || { type: 'pico' }).type,

    // ---- ESP32 전용 ----
    esp_wifi(s) { const b = sim.board(); if (b) b.rt.wifi = String(s); },
    esp_temp() { const b = sim.board(); return b && b.st.temp != null ? b.st.temp : 45; },

    // I2C
    i2c_scan(sda, scl) {
      const devs = sim.i2cDevices(sda, scl);
      const addrs = [...new Set(devs.map(n => DEVICES[n.type].i2c.addr(n)))].sort((a, b) => a - b);
      return b2s(addrs);
    },
    i2c_write(sda, scl, addr, data) {
      const devs = sim.i2cDevices(sda, scl).filter(n => DEVICES[n.type].i2c.addr(n) === addr);
      if (!devs.length) return -1;
      const bytes = s2b(data);
      for (const n of devs) DEVICES[n.type].i2c.write(n, bytes);
      return bytes.length;
    },
    i2c_read(sda, scl, addr, len) {
      const devs = sim.i2cDevices(sda, scl).filter(n => DEVICES[n.type].i2c.addr(n) === addr);
      if (!devs.length) return null;
      const r = DEVICES[devs[0].type].i2c.read(devs[0], len);
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = r && i < r.length ? r[i] : 0xFF;
      return b2s(out);
    },

    // SPI
    spi_xfer(sck, mosi, miso, data) {
      sim.evaluate();
      const nSck = sim.gpioNet(sck), nMosi = mosi == null ? -1 : sim.gpioNet(mosi), nMiso = miso == null ? -1 : sim.gpioNet(miso);
      const devs = sim.circuit.nodes.filter(n => {
        const d = DEVICES[n.type];
        if (!d || !d.spi) return false;
        const m = d.spi;
        if (sim.netIndex(n.id + ':' + m.sck) !== nSck || nSck < 0) return false;
        if (sim.netIndex(n.id + ':' + m.mosi) !== nMosi || nMosi < 0) return false;
        if (sim.termLevel(n.id + ':' + m.cs) !== 0) return false;
        return sim.powered(n);
      });
      const inb = s2b(data);
      const out = new Uint8Array(inb.length);
      for (let i = 0; i < inb.length; i++) {
        let r = 0;
        for (const n of devs) {
          const d = DEVICES[n.type];
          const o = d.spi.byte(n, inb[i]);
          if (d.spi.miso && nMiso >= 0 && sim.netIndex(n.id + ':' + d.spi.miso) === nMiso) r |= (o || 0);
        }
        out[i] = r;
      }
      return b2s(out);
    },

    // UART
    uart_write(tx, baud, data) {
      const ni = sim.gpioNet(tx);
      if (ni < 0) return;
      for (const n of sim.circuit.nodes) {
        const d = DEVICES[n.type];
        if (!d || !d.uart || sim.netIndex(n.id + ':' + d.uart.rx) !== ni || !sim.powered(n)) continue;
        const ok = d.uart.baud(n) === baud;
        d.uart.receive(n, ok ? data : garble(data));
      }
    },
    uart_read(rx, baud) {
      const ni = sim.gpioNet(rx);
      if (ni < 0) return '';
      let s = '';
      for (const n of sim.circuit.nodes) {
        const d = DEVICES[n.type];
        if (!d || !d.uart || sim.netIndex(n.id + ':' + d.uart.tx) !== ni || !sim.powered(n)) continue;
        const q = (n.rt && n.rt.txq) || '';
        if (!q) continue;
        n.rt.txq = '';
        s += d.uart.baud(n) === baud ? q : garble(q);
      }
      return s;
    },

    neopixel_write(g, data) {
      sim.evaluate();
      const ni = sim.gpioNet(g);
      for (const { node } of sim.devicesOnNet(ni, (n, p) => n.type === 'neopixel' && p === 'DIN')) {
        if (sim.powered(node)) node.rt.pixels = s2b(data);
      }
    },

    dht_read(g) {
      sim.evaluate();
      const ni = sim.gpioNet(g);
      const f = sim.devicesOnNet(ni, (n, p) => (n.type === 'dht11' || n.type === 'dht22') && p === 'DATA' && sim.powered(n));
      if (!f.length) return null;
      const st = f[0].node.st;
      return [st.temp, st.hum, f[0].node.type === 'dht11' ? 11 : 22];
    },
    ow_scan(g) {
      sim.evaluate();
      const ni = sim.gpioNet(g);
      return sim.devicesOnNet(ni, (n, p) => n.type === 'ds18b20' && p === 'DQ' && sim.powered(n)).map(x => x.node.st.rom).join(',');
    },
    ds_temp(g, rom) {
      const n = sim.circuit.nodes.find(x => x.type === 'ds18b20' && x.st.rom === rom);
      return n ? n.st.temp : null;
    },
    pulse_us(g, level, timeout) {
      sim.evaluate();
      const ni = sim.gpioNet(g);
      for (const { node, pin } of sim.devicesOnNet(ni)) {
        const d = DEVICES[node.type];
        if (d.pulse && sim.powered(node)) {
          const r = d.pulse(node, pin, level);
          if (r != null) return r > timeout ? -1 : r;
        }
      }
      return -2;
    },

    timer_start(id, period, periodic) {
      api.timer_stop(id);
      const ms = Math.max(1, period);
      if (periodic) sim.timers.set(id, setInterval(() => sim.queue('timer', id, 0), ms));
      else sim.timers.set(id, setTimeout(() => { sim.timers.delete(id); sim.queue('timer', id, 0); }, ms));
    },
    timer_stop(id) {
      const t = sim.timers.get(id);
      if (t !== undefined) { clearInterval(t); clearTimeout(t); sim.timers.delete(id); }
    },
    has_background: () => sim.timers.size > 0 || Object.values(sim.gp).some(s => s.irq),
  };
  return api;
}
