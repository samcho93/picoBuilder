// Web Serial API로 실제 Raspberry Pi Pico(MicroPython)와 연동: REPL, 파일 업로드, 실행
'use strict';

class PicoSerial {
  constructor(app) {
    this.app = app;
    this.port = null;
    this.reader = null;
    this.buf = '';
    this.quiet = false;
    this.busy = false;
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }

  get supported() { return 'serial' in navigator; }
  get connected() { return !!this.port; }

  async connect() {
    if (!this.supported) throw new Error('이 브라우저는 Web Serial을 지원하지 않습니다. Chrome 또는 Edge를 사용하세요.');
    // Pico(0x2E8A), micro:bit(0x0D28), ESP32 USB-UART: CP210x(0x10C4), CH340(0x1A86), FTDI(0x0403), ESP32-S3 내장(0x303A)
    const ESP_VIDS = [0x10C4, 0x1A86, 0x0403, 0x303A];
    const port = await navigator.serial.requestPort({ filters: [0x2E8A, 0x0D28, ...ESP_VIDS].map(v => ({ usbVendorId: v })) }).catch(async e => {
      if (e.name === 'NotFoundError') throw new Error('포트 선택이 취소되었습니다');
      throw e;
    });
    await port.open({ baudRate: 115200 });
    const vid = (port.getInfo ? port.getInfo() : {}).usbVendorId;
    if (ESP_VIDS.includes(vid)) {
      // ESP32 자동 리셋 회로: DTR/RTS를 해제해야 EN/IO0이 풀려 정상 부팅 상태가 됨
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (e) { }
      await new Promise(r => setTimeout(r, 200));
    }
    this.port = port;
    this.writer = port.writable.getWriter();
    this.readLoop();
    navigator.serial.addEventListener('disconnect', this._onDisc = e => { if (e.target === this.port) this.cleanup('보드 연결이 끊어졌습니다'); });
    const info = port.getInfo ? port.getInfo() : {};
    this.boardHint = info.usbVendorId === 0x0D28 ? 'microbit' : info.usbVendorId === 0x2E8A ? 'pico' : ESP_VIDS.includes(info.usbVendorId) ? 'esp32' : null;
    this.app.serialLog(`\n[${this.boardHint ? BOARDS[this.boardHint].short : '보드'} 연결됨]\n`, 'info');
    this.app.onSerialState(true);
  }

  async readLoop() {
    while (this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          const s = this.dec.decode(value, { stream: true });
          this.buf += s;
          if (this.buf.length > 200000) this.buf = this.buf.slice(-100000);
          if (!this.quiet) this.app.serialLog(s.replace(/\x04/g, ''));
        }
      } catch (e) {
        break;
      } finally {
        try { this.reader.releaseLock(); } catch (e) { }
      }
    }
  }

  async disconnect() {
    try { if (this.reader) await this.reader.cancel(); } catch (e) { }
    try { this.writer.releaseLock(); } catch (e) { }
    try { await this.port.close(); } catch (e) { }
    this.cleanup('보드 연결 해제');
  }

  cleanup(msg) {
    this.port = null; this.reader = null; this.writer = null;
    this.app.serialLog(`\n[${msg}]\n`, 'info');
    this.app.onSerialState(false);
  }

  async write(s) {
    if (!this.port) throw new Error('보드가 연결되지 않았습니다');
    await this.writer.write(typeof s === 'string' ? this.enc.encode(s) : s);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async waitFor(str, timeout = 5000, from = 0) {
    const t0 = Date.now();
    for (;;) {
      const i = this.buf.indexOf(str, from);
      if (i >= 0) return i;
      if (Date.now() - t0 > timeout) throw new Error(`보드 응답 시간 초과 (${JSON.stringify(str)})`);
      await this.sleep(10);
    }
  }

  async interrupt() { await this.write('\r\x03\x03'); }

  async enterRaw() {
    await this.write('\r\x03\x03');
    await this.sleep(150);
    this.buf = '';
    await this.write('\r\x01');
    await this.waitFor('raw REPL; CTRL-B to exit\r\n>', 3000);
    this.buf = '';
  }

  async exitRaw() { await this.write('\r\x02'); }

  // raw REPL에서 코드 실행 후 (stdout, stderr) 반환
  async exec(code, timeout = 10000) {
    this.buf = '';
    const data = this.enc.encode(code);
    for (let i = 0; i < data.length; i += 256) {
      await this.write(data.slice(i, i + 256));
      await this.sleep(8);
    }
    await this.write('\x04');
    await this.waitFor('OK', 3000);
    const e1 = await this.waitFor('\x04', timeout, 2);
    const e2 = await this.waitFor('\x04', timeout, e1 + 1);
    const out = this.buf.slice(2, e1), err = this.buf.slice(e1 + 1, e2);
    if (err.trim()) throw new Error(err.trim());
    return out;
  }

  // binascii가 없는 보드(micro:bit)도 지원하도록 bytes 리터럴로 전송
  async writeFile(path, content) {
    const bytes = this.enc.encode(content);
    await this.exec(`f=open('${path}','wb')\nw=f.write`);
    for (let i = 0; i < bytes.length; i += 180) {
      const chunk = bytes.slice(i, i + 180);
      let lit = '';
      chunk.forEach(b => { lit += (b >= 32 && b < 127 && b !== 39 && b !== 92) ? String.fromCharCode(b) : '\\x' + b.toString(16).padStart(2, '0'); });
      await this.exec(`w(b'${lit}')`);
    }
    await this.exec('f.close()');
  }

  libPath(board, l) { return board === 'microbit' ? `${l}.py` : `/lib/${l}.py`; }

  async putLibs(board, libs, progress) {
    if (!libs.length) return;
    if (board !== 'microbit') await this.exec("import os\ntry:\n    os.mkdir('/lib')\nexcept OSError:\n    pass");
    for (const l of libs) {
      progress(`라이브러리 업로드: ${this.libPath(board, l)}`);
      await this.writeFile(this.libPath(board, l), PY_DRIVERS[l]);
    }
  }

  async checkBoard(board, progress) {
    const ver = (await this.exec('import sys\nprint(sys.implementation.name, sys.version, sys.platform)')).trim();
    progress('보드: ' + ver);
    const actual = /microbit|nrf/i.test(ver) ? 'microbit' : /esp32/i.test(ver) ? 'esp32' : /rp2/i.test(ver) ? 'pico' : null;
    if (actual && actual !== board) progress(`⚠ 프로젝트는 ${BOARDS[board].short}용인데 연결된 보드는 ${BOARDS[actual].short}입니다`);
  }

  async guard(fn) {
    if (this.busy) throw new Error('다른 작업이 진행 중입니다');
    if (!this.port) throw new Error('먼저 "연결"을 눌러 보드를 연결하세요');
    this.busy = true;
    this.quiet = true;
    try { return await fn(); } finally { this.quiet = false; this.busy = false; }
  }

  // main.py + 필요한 라이브러리를 업로드하고 재부팅(실행)
  async upload(code, libs, progress, board = 'pico') {
    return this.guard(async () => {
      progress('보드 연결 준비 (raw REPL)…');
      await this.enterRaw().catch(() => { throw new Error('MicroPython REPL에 응답이 없습니다. 보드에 MicroPython 펌웨어가 설치되어 있는지 확인하세요' + (board === 'microbit' ? ' (python.microbit.org 에서 설치)' : '')); });
      await this.checkBoard(board, progress);
      await this.putLibs(board, libs, progress);
      progress('main.py 업로드…');
      await this.writeFile(board === 'microbit' ? 'main.py' : '/main.py', code);
      progress('업로드 완료 → 소프트 리셋하여 main.py 실행');
      this.quiet = false;
      await this.exitRaw();
      await this.sleep(100);
      await this.write('\x04');
    });
  }

  // 파일로 저장하지 않고 즉시 실행
  async runOnce(code, libs, progress, board = 'pico') {
    return this.guard(async () => {
      progress('raw REPL 진입…');
      await this.enterRaw();
      await this.putLibs(board, libs, progress);
      progress('코드 실행 중… (■ 버튼으로 중지)');
      this.quiet = false;
      const data = this.enc.encode(code);
      for (let i = 0; i < data.length; i += 256) { await this.write(data.slice(i, i + 256)); await this.sleep(8); }
      await this.write('\x04');
    });
  }

  async stopProgram() {
    await this.write('\r\x03\x03');
    await this.sleep(100);
    await this.exitRaw();
  }

  async listFiles(board = 'pico') {
    return this.guard(async () => {
      await this.enterRaw();
      if (board === 'microbit') {
        const o = await this.exec("import os\nfor n in os.listdir():\n    print(n, os.size(n))");
        await this.exitRaw();
        return o;
      }
      const out = await this.exec("import os\ndef _w(p):\n    for n in os.listdir(p):\n        f=(p.rstrip('/')+'/'+n)\n        try:\n            st=os.stat(f)\n        except OSError:\n            continue\n        if st[0]&0x4000:\n            print(f+'/')\n            _w(f)\n        else:\n            print(f, st[6])\n_w('/')");
      await this.exitRaw();
      return out;
    });
  }
}
