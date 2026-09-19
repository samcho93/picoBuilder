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
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x2E8A }] }).catch(async e => {
      if (e.name === 'NotFoundError') throw new Error('포트 선택이 취소되었습니다');
      throw e;
    });
    await port.open({ baudRate: 115200 });
    this.port = port;
    this.writer = port.writable.getWriter();
    this.readLoop();
    navigator.serial.addEventListener('disconnect', this._onDisc = e => { if (e.target === this.port) this.cleanup('Pico 연결이 끊어졌습니다'); });
    this.app.serialLog('\n[Pico 연결됨]\n', 'info');
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
    this.cleanup('Pico 연결 해제');
  }

  cleanup(msg) {
    this.port = null; this.reader = null; this.writer = null;
    this.app.serialLog(`\n[${msg}]\n`, 'info');
    this.app.onSerialState(false);
  }

  async write(s) {
    if (!this.port) throw new Error('Pico가 연결되지 않았습니다');
    await this.writer.write(typeof s === 'string' ? this.enc.encode(s) : s);
  }

  sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async waitFor(str, timeout = 5000, from = 0) {
    const t0 = Date.now();
    for (;;) {
      const i = this.buf.indexOf(str, from);
      if (i >= 0) return i;
      if (Date.now() - t0 > timeout) throw new Error(`Pico 응답 시간 초과 (${JSON.stringify(str)})`);
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

  async writeFile(path, content) {
    const bytes = this.enc.encode(content);
    await this.exec(`import binascii\nf=open('${path}','wb')\nw=f.write\na=binascii.a2b_base64`);
    for (let i = 0; i < bytes.length; i += 600) {
      const chunk = bytes.slice(i, i + 600);
      let bin = ''; chunk.forEach(b => bin += String.fromCharCode(b));
      await this.exec(`w(a('${btoa(bin)}'))`);
    }
    await this.exec('f.close()');
  }

  async guard(fn) {
    if (this.busy) throw new Error('다른 작업이 진행 중입니다');
    if (!this.port) throw new Error('먼저 "Pico 연결"을 눌러 보드를 연결하세요');
    this.busy = true;
    this.quiet = true;
    try { return await fn(); } finally { this.quiet = false; this.busy = false; }
  }

  // main.py + 필요한 라이브러리를 업로드하고 재부팅(실행)
  async upload(code, libs, progress) {
    return this.guard(async () => {
      progress('Pico 연결 준비 (raw REPL)…');
      await this.enterRaw();
      const ver = await this.exec('import sys\nprint(sys.implementation.name, sys.version)');
      progress('보드: ' + ver.trim());
      if (libs.length) {
        await this.exec("import os\ntry:\n    os.mkdir('/lib')\nexcept OSError:\n    pass");
        for (const l of libs) {
          progress(`라이브러리 업로드: /lib/${l}.py`);
          await this.writeFile(`/lib/${l}.py`, PY_DRIVERS[l]);
        }
      }
      progress('main.py 업로드…');
      await this.writeFile('/main.py', code);
      progress('업로드 완료 → 소프트 리셋하여 main.py 실행');
      this.quiet = false;
      await this.exitRaw();
      await this.sleep(100);
      await this.write('\x04');
    });
  }

  // 파일로 저장하지 않고 즉시 실행
  async runOnce(code, libs, progress) {
    return this.guard(async () => {
      progress('raw REPL 진입…');
      await this.enterRaw();
      if (libs.length) {
        await this.exec("import os\ntry:\n    os.mkdir('/lib')\nexcept OSError:\n    pass");
        for (const l of libs) { progress(`라이브러리 업로드: /lib/${l}.py`); await this.writeFile(`/lib/${l}.py`, PY_DRIVERS[l]); }
      }
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

  async listFiles() {
    return this.guard(async () => {
      await this.enterRaw();
      const out = await this.exec("import os\ndef _w(p):\n    for n in os.listdir(p):\n        f=(p.rstrip('/')+'/'+n)\n        try:\n            st=os.stat(f)\n        except OSError:\n            continue\n        if st[0]&0x4000:\n            print(f+'/')\n            _w(f)\n        else:\n            print(f, st[6])\n_w('/')");
      await this.exitRaw();
      return out;
    });
  }
}
