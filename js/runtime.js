// Pyodide 기반 MicroPython 시뮬레이터 런타임
'use strict';

const PYODIDE_URL = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

class Runtime {
  constructor(app) {
    this.app = app;
    this.py = null;
    this.loading = null;
    this.running = false;
  }

  load() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      this.app.setStatus('Python 엔진 로딩 중…', 'busy');
      if (!window.loadPyodide) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = PYODIDE_URL + 'pyodide.js';
          s.onload = res; s.onerror = () => rej(new Error('Pyodide 스크립트를 불러오지 못했습니다 (인터넷 연결 확인)'));
          document.head.appendChild(s);
        });
      }
      const py = await loadPyodide({ indexURL: PYODIDE_URL });
      py.setStdout({ batched: s => this.app.log(s) });
      py.setStderr({ batched: s => this.app.log(s, 'err') });
      py.setStdin({ stdin: () => { const r = window.prompt('input() 입력:'); return r == null ? '' : r + '\n'; } });
      for (const [dir, mods] of [['/pblib', { ...PY_SIM, ...PY_DRIVERS }], ['/pbpico', PY_PICO], ['/pbmb', PY_MB]]) {
        py.FS.mkdirTree(dir);
        for (const [name, src] of Object.entries(mods)) py.FS.writeFile(`${dir}/${name}.py`, src);
      }
      py.registerJsModule('pbhw', makeHwApi(this.app.sim));
      py.runPython("import sys\nsys.path.insert(0, '/pblib')\nimport _pbrt, time_patch");
      this.py = py;
      this.app.setStatus('Python 준비됨', 'ok');
      return py;
    })().catch(e => { this.loading = null; this.app.setStatus('Python 로딩 실패', 'err'); throw e; });
    return this.loading;
  }

  async run(code) {
    if (this.running) await this.stop();
    let py;
    try { py = await this.load(); } catch (e) { this.app.log(String(e.message || e), 'err'); return; }
    const sim = this.app.sim;
    sim.start();
    this.running = true;
    this.app.onRunState('running');
    this.app.log(`▶ 시뮬레이션 시작 (main.py · ${BOARDS[this.app.boardType()].label})`, 'info');
    let result = 'error';
    try {
      py.globals.set('__pb_src', code);
      py.globals.set('__pb_board', this.app.boardType());
      result = await py.runPythonAsync('await _pbrt.run(__pb_src, __pb_board)');
    } catch (e) {
      this.app.log(String(e.message || e), 'err');
    }
    if (!this.running) return;
    const api = sim;
    const bg = api.timers.size > 0 || Object.values(api.gp).some(s => s.irq);
    if (result === 'done' && bg && !sim.stopFlag) {
      this.app.log('main.py 종료 — 타이머/인터럽트가 계속 동작 중입니다 (■ 정지로 종료)', 'info');
      this.app.onRunState('background');
      return;
    }
    this.finish(result);
  }

  finish(result) {
    this.running = false;
    const sim = this.app.sim;
    for (const t of sim.timers.values()) { clearInterval(t); clearTimeout(t); }
    sim.timers.clear();
    sim.running = false;
    if (result === 'stopped') this.app.log('■ 사용자에 의해 중지됨 (KeyboardInterrupt)', 'info');
    else if (result === 'done') this.app.log('✔ 프로그램 종료', 'info');
    this.app.onRunState('idle');
  }

  async stop() {
    const sim = this.app.sim;
    sim.stopFlag = true;
    Sound.allOff();
    if (this.running) {
      // 실행 중인 코루틴이 KeyboardInterrupt로 빠져나올 시간을 줌
      await new Promise(r => setTimeout(r, 80));
    }
    const was = this.running;
    this.running = false;
    sim.stop();
    if (was) this.app.log('■ 시뮬레이션 정지', 'info');
    this.app.onRunState('idle');
  }
}
