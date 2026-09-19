// picoBuilder 메인 애플리케이션
'use strict';

const STORE_KEY = 'picoBuilder.autosave.v1';

class App {
  constructor() {
    this.circuit = { nodes: [], wires: [], seq: 1 };
    this.codeMode = 'auto';
    this.undo = []; this.redo = [];
    this.sim = new Sim(this);
    this.runtime = new Runtime(this);
    this.serial = new PicoSerial(this);
    this.lastGen = { code: '', libs: [], warnings: [] };
  }

  init() {
    this.editor = new Editor(this, document.getElementById('canvas'));
    this.initCode();
    this.initPalette();
    this.initUI();
    this.initSplitters();
    let loaded = false;
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) { this.load(JSON.parse(s), { keepView: true }); loaded = true; }
    } catch (e) { console.warn(e); }
    if (!loaded) this.load(EXAMPLES[1].build());
    this.pushHistory(true);
    requestAnimationFrame(() => this.editor.fit());
    this.loop();
    // Python 엔진은 미리 백그라운드 로딩
    setTimeout(() => this.runtime.load().catch(() => { }), 1500);
  }

  // ---------- 보드 ----------
  boardNode() { return this.circuit.nodes.find(n => BOARDS[n.type]); }
  boardType() { const b = this.boardNode(); return b ? b.type : 'pico'; }

  switchBoard(type) {
    const cur = this.boardNode();
    if (cur && cur.type === type) return;
    const x = cur ? cur.x : 430, y = cur ? cur.y : 40;
    if (cur) {
      const lost = this.circuit.wires.filter(w => splitTerm(w.a)[0] === cur.id || splitTerm(w.b)[0] === cur.id).length;
      if (lost && !confirm(`보드를 ${BOARDS[type].label}(으)로 바꾸면 보드 핀에 연결된 배선 ${lost}개가 삭제됩니다. 계속할까요?`)) {
        document.getElementById('boardSel').value = cur.type;
        return;
      }
      this.circuit.wires = this.circuit.wires.filter(w => splitTerm(w.a)[0] !== cur.id && splitTerm(w.b)[0] !== cur.id);
      if (cur.el) cur.el.remove();
      this.circuit.nodes = this.circuit.nodes.filter(n => n !== cur);
    }
    const bd = BOARDS[type];
    for (const n of this.circuit.nodes) if (NODES[n.type] && n.st.pin !== undefined && n.st.pin !== '' && !bd.gpios.includes(+n.st.pin)) n.st.pin = '';
    this.circuit.nodes.unshift({ id: bd.id, type, name: bd.id, x, y, st: bd.init ? bd.init() : {}, rt: {} });
    if (this.runtime.running) this.runtime.stop();
    this.afterBoardChange();
    this.editor.renderAll();
    this.sim.invalidate();
    this.changed({});
    this.toast(`보드 변경: ${bd.label}`, 'ok');
  }

  afterBoardChange() {
    const t = this.boardType();
    document.getElementById('boardSel').value = t;
    document.body.dataset.board = t;
    this.filterPalette();
  }

  // ---------- 프로젝트 ----------
  serialize() {
    return {
      version: 1,
      name: document.getElementById('projName').value,
      circuit: {
        seq: this.circuit.seq,
        nodes: this.circuit.nodes.map(n => ({ id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, flip: n.flip || undefined, st: n.st })),
        wires: this.circuit.wires.map(w => ({ ...w })),
      },
      codeMode: this.codeMode,
      code: this.codeMode === 'manual' ? this.cm.getValue() : undefined,
      view: { ...this.editor.view },
    };
  }

  load(p, opt = {}) {
    if (this.runtime.running) this.runtime.stop();
    const c = JSON.parse(JSON.stringify(p.circuit || { nodes: [], wires: [] }));
    if (!c.nodes.some(n => BOARDS[n.type])) {
      const bt = p.board && BOARDS[p.board] ? p.board : this.boardType();
      c.nodes.unshift({ id: BOARDS[bt].id, type: bt, name: BOARDS[bt].id, x: 430, y: 40, st: {} });
    }
    for (const n of c.nodes) {
      n.st = n.st || {};
      const d = DEVICES[n.type] || BOARDS[n.type];
      if (d && d.init) n.st = { ...d.init(), ...n.st };
      if (n.type === 'button') n.st.pressed = false;
      if (BOARDS[n.type]) Object.assign(n.st, { btnA: false, btnB: false, logo: false, boot: false });
      n.rt = {};
    }
    this.circuit = c;
    this.afterBoardChange();
    this.circuit.seq = c.seq || c.nodes.length + 1;
    document.getElementById('projName').value = p.name || '새 프로젝트';
    this.editor.sel = null;
    this.sim.invalidate();
    this.editor.renderAll();
    for (const w of c.wires) if (!w.color && this.editor.wireKind(w) === 'hw') w.color = this.editor.autoColor(w.a, w.b);
    if (p.view && opt.keepView) { this.editor.view = p.view; this.editor.applyView(); }
    else requestAnimationFrame(() => this.editor.fit());
    this.setCodeMode(p.codeMode === 'manual' ? 'manual' : 'auto');
    if (this.codeMode === 'manual') { this.settingCode = true; this.cm.setValue(p.code || ''); this.settingCode = false; }
    this.regen(true);
    this.showProps();
    requestAnimationFrame(() => this.editor.drawWires());
  }

  newProject() {
    this.load({ name: '새 프로젝트', board: this.boardType(), circuit: { nodes: [], wires: [] } });
    const e = this.editor;
    e.addNode('ev_start', 790, 60);
    e.addNode('ev_loop', 790, 180);
    e.select(null);
    this.pushHistory(true);
  }

  changed({ code = true, history = true } = {}) {
    if (history) this.pushHistory();
    clearTimeout(this._save);
    this._save = setTimeout(() => this.autosave(), 400);
    if (code) { clearTimeout(this._gen); this._gen = setTimeout(() => this.regen(), 120); }
    this.showPropsSoon();
  }

  autosave() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.serialize())); } catch (e) { }
  }

  pushHistory(reset) {
    const s = JSON.stringify(this.serialize().circuit);
    if (reset) { this.undo = [s]; this.redo = []; return; }
    if (this.undo[this.undo.length - 1] === s) return;
    this.undo.push(s);
    if (this.undo.length > 80) this.undo.shift();
    this.redo = [];
  }
  undoRedo(dir) {
    let target;
    if (dir < 0) {
      if (this.undo.length < 2) return;
      this.redo.push(this.undo.pop());
      target = this.undo[this.undo.length - 1];
    } else {
      if (!this.redo.length) return;
      target = this.redo.pop();
      this.undo.push(target);
    }
    const p = this.serialize();
    p.circuit = JSON.parse(target);
    const view = { ...this.editor.view };
    this.load(p, { keepView: true });
    this.editor.view = view; this.editor.applyView();
    this.autosave();
  }

  // ---------- 코드 ----------
  initCode() {
    this.cm = CodeMirror.fromTextArea(document.getElementById('code'), {
      mode: 'python', theme: 'material-darker', lineNumbers: true, indentUnit: 4, tabSize: 4,
      matchBrackets: true, styleActiveLine: true, indentWithTabs: false,
      extraKeys: { Tab: cm => cm.execCommand(cm.somethingSelected() ? 'indentMore' : 'insertSoftTab'), 'Shift-Tab': 'indentLess' },
    });
    this.cm.on('change', () => {
      if (this.settingCode) return;
      if (this.codeMode !== 'manual') this.setCodeMode('manual');
      clearTimeout(this._save);
      this._save = setTimeout(() => this.autosave(), 600);
      this.updateLibBar();
    });
  }

  setCodeMode(m) {
    this.codeMode = m;
    const b = document.getElementById('codeMode');
    b.className = 'badge ' + m;
    b.textContent = m === 'auto' ? '노드 → 코드 자동 생성' : '✎ 직접 편집 중 (노드 동기화 해제)';
  }

  regen(force) {
    let res;
    try { res = generateCode(this.circuit, this.sim); }
    catch (e) { console.error(e); res = { code: '# 코드 생성 오류: ' + e.message, libs: [], warnings: [{ msg: e.message }] }; }
    this.lastGen = res;
    if (this.codeMode === 'auto') {
      const cur = this.cm.getValue();
      if (cur !== res.code) {
        const sc = this.cm.getScrollInfo();
        this.settingCode = true;
        this.cm.setValue(res.code);
        this.settingCode = false;
        this.cm.scrollTo(sc.left, sc.top);
      }
    }
    this.showWarnings(res.warnings);
    this.updateLibBar();
  }

  currentCode() { return this.cm.getValue(); }

  neededLibs(code = this.currentCode()) {
    const mb = this.boardType() === 'microbit';
    const libs = Object.keys(PY_DRIVERS).filter(l => (mb || (l !== 'framebuf' && l !== 'mbcompat')) && new RegExp(`^\\s*(from\\s+${l}\\s+import|import\\s+${l}\\b)`, 'm').test(code));
    if (mb && (libs.includes('ssd1306') || libs.includes('max7219')) && !libs.includes('framebuf')) libs.unshift('framebuf');
    return libs;
  }

  updateLibBar() {
    const libs = this.neededLibs();
    const mb = this.boardType() === 'microbit';
    document.getElementById('libBar').innerHTML = libs.length
      ? `업로드 시 함께 전송되는 드라이버: ${libs.map(l => `<code>${mb ? '' : '/lib/'}${l}.py</code>`).join(' ')}`
      : 'MicroPython 내장 모듈만 사용합니다.';
  }

  showWarnings(ws) {
    const box = document.getElementById('warnBox');
    box.hidden = !ws.length;
    document.getElementById('warnCount').textContent = ws.length;
    document.getElementById('warnList').innerHTML = ws.map(w => `<div data-id="${w.node || ''}">• ${esc(w.msg)}</div>`).join('');
  }

  // ---------- 팔레트 ----------
  initPalette() {
    const list = document.getElementById('palList');
    const groups = [
      ['하드웨어 모듈', DEV_CATS, t => DEVICES[t].cat, DEVICES],
      ['프로그램 노드', PROG_CATS, t => NODES[t].cat, NODES],
    ];
    let html = '';
    for (const [gname, cats, catOf, defs] of groups) {
      html += `<div class="palgrp">${gname}</div>`;
      for (const [cid, cname, color] of cats) {
        const types = Object.keys(defs).filter(t => catOf(t) === cid);
        if (!types.length) continue;
        html += `<div class="palcat" data-cat="${cid}"><span class="arr">▼</span><span class="sw" style="background:${color}"></span>${cname}<span class="cnt">${types.length}</span></div><div class="palitems">`;
        for (const t of types) {
          const d = defs[t];
          html += `<div class="palitem" draggable="true" data-type="${t}" data-boards="${(d.boards || []).join(',')}" style="--c:${color}" title="${esc(d.desc || '')}"><span class="pi">${d.icon || '▸'}</span>${esc(d.label)}</div>`;
        }
        html += '</div>';
      }
    }
    list.innerHTML = html;
    list.querySelectorAll('.palcat').forEach(c => c.addEventListener('click', () => {
      c.classList.toggle('closed');
      c.querySelector('.arr').textContent = c.classList.contains('closed') ? '▶' : '▼';
    }));
    list.querySelectorAll('.palitem').forEach(it => {
      it.addEventListener('dragstart', e => { e.dataTransfer.setData('text/pb-type', it.dataset.type); e.dataTransfer.effectAllowed = 'copy'; });
      it.addEventListener('click', () => {
        const r = this.editor.el.getBoundingClientRect();
        const p = this.editor.toWorld(r.left + r.width * 0.55 + Math.random() * 40, r.top + r.height * 0.35 + Math.random() * 40);
        this.editor.addNode(it.dataset.type, p.x, p.y);
      });
    });
    document.getElementById('palSearch').addEventListener('input', () => this.filterPalette());
  }

  filterPalette() {
    const list = document.getElementById('palList');
    const q = document.getElementById('palSearch').value.trim().toLowerCase();
    const bt = this.boardType();
    list.querySelectorAll('.palitem').forEach(it => {
      const d = DEVICES[it.dataset.type] || NODES[it.dataset.type];
      const okBoard = !it.dataset.boards || it.dataset.boards.split(',').includes(bt);
      const hit = okBoard && (!q || (d.label + ' ' + (d.desc || '') + ' ' + it.dataset.type).toLowerCase().includes(q));
      it.style.display = hit ? '' : 'none';
    });
    list.querySelectorAll('.palcat').forEach(c => {
      const items = c.nextElementSibling;
      const any = [...items.children].some(x => x.style.display !== 'none');
      c.style.display = any ? '' : 'none';
      c.querySelector('.cnt').textContent = [...items.children].filter(x => x.style.display !== 'none').length;
      if (q) c.classList.remove('closed');
    });
  }

  // ---------- 속성 패널 ----------
  showPropsSoon() { clearTimeout(this._pp); this._pp = setTimeout(() => this.showProps(), 150); }

  termLabel(t) {
    const [id, p] = splitTerm(t);
    const n = this.editor.node(id);
    if (!n) return t;
    if (BOARDS[n.type]) { const bd = BOARDS[n.type], pp = bd.pins[p]; return pp ? `${bd.short} ${pp.name}${n.type === 'pico' ? `(핀${pp.num})` : ''}` : t; }
    if (DEVICES[n.type]) return p === '@' ? `${n.name} ◆` : `${n.name}.${p}`;
    const nd = NODES[n.type];
    const port = [...nd.ins, ...nd.outs].find(x => x.n === p);
    return `${nd.label}.${port ? port.label || p : p}`;
  }

  showProps() {
    const el = document.getElementById('props');
    const sel = this.editor.sel;
    const ws = this.lastGen.warnings || [];
    if (!sel) {
      const devs = this.circuit.nodes.filter(n => DEVICES[n.type]);
      const progs = this.circuit.nodes.filter(n => NODES[n.type]);
      el.innerHTML = `<h3>📋 프로젝트 요약</h3><p class="desc">노드나 와이어를 선택하면 상세 속성이 표시됩니다.</p>
        <table><tr><th>하드웨어 모듈</th><td>${devs.length}개</td></tr><tr><th>프로그램 노드</th><td>${progs.length}개</td></tr>
        <tr><th>와이어</th><td>${this.circuit.wires.length}개</td></tr><tr><th>경고</th><td class="${ws.length ? 'pw' : ''}">${ws.length}개</td></tr></table>
        ${devs.length ? `<table><tr><th>모듈</th><th>종류</th></tr>${devs.map(n => `<tr><td><code>${esc(n.name)}</code></td><td>${esc(DEVICES[n.type].label)}</td></tr>`).join('')}</table>` : ''}`;
      return;
    }
    if (sel.kind === 'wire') {
      const w = this.circuit.wires[sel.i];
      if (!w) { el.innerHTML = ''; return; }
      const kind = this.editor.wireKind(w);
      const kname = { hw: '전기 배선', pinref: '핀 참조', devref: '모듈 참조', exec: '실행 흐름', data: '데이터' }[kind];
      el.innerHTML = `<h3>〰 와이어</h3><p class="desc">${kname}</p>
        <table><tr><th>시작</th><td>${esc(this.termLabel(w.a))}</td></tr><tr><th>끝</th><td>${esc(this.termLabel(w.b))}</td></tr></table>
        ${kind === 'hw' ? `<div class="row"><span>색상</span><input type="color" id="wcolor" value="${w.color || '#f4b400'}"></div>` : ''}
        <button id="wdel">🗑 와이어 삭제 (Delete)</button>`;
      const c = document.getElementById('wcolor');
      if (c) c.addEventListener('input', () => { w.color = c.value; this.editor.drawWires(); this.changed({ code: false }); });
      document.getElementById('wdel').onclick = () => this.editor.removeWire(sel.i);
      return;
    }
    const n = this.editor.node(sel.id);
    if (!n) { el.innerHTML = ''; return; }
    const myWarn = ws.filter(w => w.node === n.id).map(w => `<div class="pw">⚠ ${esc(w.msg)}</div>`).join('');
    const sim = this.sim;
    sim.evaluate();
    const netTerms = t => { const i = sim.netIndex(t); return i < 0 ? [] : sim.nets[i].terms.filter(x => x !== t); };
    const refs = id => this.circuit.wires.filter(w => w.a === id + ':@').map(w => this.termLabel(w.b));
    if (BOARDS[n.type]) {
      const bd = BOARDS[n.type];
      const rows = Object.values(bd.pins).map(p => {
        const t = n.id + ':' + p.num;
        const conn = netTerms(t).concat(this.circuit.wires.filter(w => w.a === t && this.editor.wireKind(w) === 'pinref').map(w => w.b));
        if (!conn.length) return '';
        return `<tr><td>${n.type === 'pico' ? p.num : ''}</td><td><b>${p.name}</b></td><td>${conn.map(x => `<span class="tag">${esc(this.termLabel(x))}</span>`).join('')}</td></tr>`;
      }).join('');
      el.innerHTML = `<h3><span class="sw" style="background:${{ pico: '#1b7f3b', microbit: '#2c7be5', esp32: '#c0392b', rp2040zero: '#2e9e57' }[n.type]}"></span>${bd.icon} ${bd.label}</h3>
        <p class="desc">${esc(bd.desc)}</p>
        <table><tr><th>핀</th><th>이름</th><th>연결</th></tr>${rows || '<tr><td colspan=3>연결된 핀이 없습니다</td></tr>'}</table>`;
      return;
    }
    const d = DEVICES[n.type];
    if (d) {
      const rows = d.pins.map(p => {
        const t = n.id + ':' + p.n;
        const conn = netTerms(t);
        const v = sim.termV(t);
        return `<tr><td><b>${esc(p.n)}</b></td><td>${conn.length ? conn.map(x => `<span class="tag">${esc(this.termLabel(x))}</span>`).join('') : '<span class="pw">미연결</span>'}</td><td>${v == null ? '-' : v.toFixed(2) + 'V'}</td></tr>`;
      }).join('');
      const addr = d.i2c ? `<tr><th>I2C 주소</th><td>${hexs(d.i2c.addr(n))}</td></tr>` : '';
      const powered = sim.powered(n);
      el.innerHTML = `<h3><span class="sw" style="background:${catColor(d.cat)}"></span>${d.icon} ${esc(d.label)}</h3><p class="desc">${esc(d.desc || '')}</p>
        <div class="row"><span>변수 이름</span><input type="text" id="pname" value="${esc(n.name)}" spellcheck="false"></div>
        <table>${addr}<tr><th>전원</th><td class="${powered ? '' : 'pw'}">${powered ? '✔ 공급됨' : '✖ VCC/GND 연결 필요'}</td></tr>
        <tr><th>참조 노드</th><td>${refs(n.id).map(x => `<span class="tag">${esc(x)}</span>`).join('') || '-'}</td></tr></table>
        <table><tr><th>핀</th><th>연결</th><th>전압</th></tr>${rows}</table>${myWarn}`;
      const inp = document.getElementById('pname');
      inp.addEventListener('keydown', e => e.stopPropagation());
      inp.addEventListener('change', () => {
        const v = inp.value.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) { this.toast('변수 이름은 영문자/숫자/_ 만 사용할 수 있습니다', 'warn'); inp.value = n.name; return; }
        if (this.circuit.nodes.some(m => m !== n && m.name === v)) { this.toast('이미 사용 중인 이름입니다', 'warn'); inp.value = n.name; return; }
        n.name = v;
        this.editor.mountNode(n); this.editor.refreshConn(); this.editor.fillDevSelects(); this.editor.drawWires();
        this.changed({});
      });
      return;
    }
    const nd = NODES[n.type];
    if (nd) {
      const ports = [...nd.ins.map(p => ['입력', p]), ...nd.outs.map(p => ['출력', p])].map(([k, p]) => {
        const kind = { exec: '▶ 실행', data: '● ' + p.t, pin: '핀', dev: '◆ 모듈' }[p.k];
        return `<tr><td>${k}</td><td>${esc(p.label || p.n)}</td><td>${kind}</td></tr>`;
      }).join('');
      el.innerHTML = `<h3><span class="sw" style="background:${catColor(nd.cat)}"></span>${esc(nd.label)}</h3><p class="desc">${esc(nd.desc || '')}</p>
        <table><tr><th></th><th>포트</th><th>종류</th></tr>${ports}</table>${myWarn}
        <p class="desc">입력 포트를 연결하지 않으면 노드 안의 입력값이 사용됩니다.</p>`;
    }
  }

  // ---------- 콘솔 ----------
  log(s, cls) {
    const el = document.getElementById('simLog');
    for (const line of String(s).split('\n')) {
      const d = document.createElement('div');
      if (cls) d.className = cls;
      d.textContent = line;
      el.appendChild(d);
    }
    while (el.childElementCount > 1500) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
    if (cls === 'err') this.switchTab('btabs', 'sim');
  }
  serialLog(s, cls) {
    const el = document.getElementById('serialLog');
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = s.replace(/\r/g, '');
    el.appendChild(span);
    while (el.childElementCount > 3000) el.firstChild.remove();
    el.scrollTop = el.scrollHeight;
  }
  toast(msg, type = '') {
    const t = document.createElement('div');
    t.className = type; t.textContent = msg;
    document.getElementById('toast').appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  setStatus(s, cls = '') { const el = document.getElementById('status'); el.textContent = s; el.className = 'status ' + cls; }

  switchTab(group, tab) {
    const g = document.getElementById(group);
    g.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const pane = g.parentElement;
    pane.querySelectorAll(':scope > .tabpane').forEach(p => p.classList.toggle('on', p.id === 'tab-' + tab));
    if (tab === 'code') setTimeout(() => this.cm.refresh(), 0);
  }

  onRunState(s) {
    document.getElementById('btnRun').disabled = s !== 'idle';
    document.getElementById('btnStop').disabled = s === 'idle';
    if (s === 'running') this.setStatus('● 시뮬레이션 실행 중', 'run');
    else if (s === 'background') this.setStatus('● 백그라운드 실행 (타이머/IRQ)', 'run');
    else this.setStatus(this.runtime.py ? 'Python 준비됨' : '준비', this.runtime.py ? 'ok' : '');
  }
  onSerialState(on) {
    document.getElementById('btnConnect').textContent = on ? '⏏ 연결 해제' : '🔌 연결';
    ['btnUpload', 'btnRunPico', 'btnStopPico'].forEach(id => document.getElementById(id).disabled = !on);
    if (on) this.switchTab('btabs', 'serial');
  }

  // ---------- 파일 ----------
  async saveFile(name, text, desc, ext, mime) {
    if (window.showSaveFilePicker) {
      try {
        const h = await showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime]: [ext] } }] });
        const w = await h.createWritable();
        await w.write(text); await w.close();
        this.toast(`저장됨: ${h.name}`, 'ok');
        return;
      } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.toast(`다운로드: ${name}`, 'ok');
  }
  saveProject() {
    const p = this.serialize();
    p.code = this.cm.getValue();
    const name = (p.name || 'project').replace(/[\\/:*?"<>|]/g, '_');
    this.autosave();
    this.saveFile(name + '.pbproj.json', JSON.stringify(p, null, 1), 'picoBuilder 프로젝트', '.json', 'application/json');
  }
  savePy() { this.saveFile('main.py', this.cm.getValue(), 'Python 파일', '.py', 'text/x-python'); }
  openFile(onlyPy) {
    const inp = document.getElementById('fileInput');
    inp.accept = onlyPy ? '.py' : '.json,.py';
    inp.value = '';
    inp.onchange = async () => {
      const f = inp.files[0];
      if (!f) return;
      const text = await f.text();
      if (f.name.endsWith('.py')) {
        this.setCodeMode('manual');
        this.cm.setValue(text);
        this.switchTab('rtabs', 'code');
        this.toast(`${f.name} 열기 완료 (직접 편집 모드)`, 'ok');
      } else {
        try { this.load(JSON.parse(text)); this.pushHistory(true); this.autosave(); this.toast(`${f.name} 열기 완료`, 'ok'); }
        catch (e) { this.toast('프로젝트 파일을 읽을 수 없습니다: ' + e.message, 'err'); }
      }
    };
    inp.click();
  }

  // ---------- 실행 ----------
  async runSim() {
    if (this.codeMode === 'auto') this.regen();
    const code = this.currentCode();
    this.switchTab('btabs', 'sim');
    await this.runtime.run(code);
  }

  async picoAction(kind) {
    const code = this.currentCode();
    const libs = this.neededLibs(code);
    const prog = m => { this.serialLog(`[${m}]\n`, 'info'); this.setStatus(m, 'busy'); };
    this.switchTab('btabs', 'serial');
    try {
      const bt = this.boardType(), bn = BOARDS[bt].short;
      const fam = b => b === 'rp2040zero' ? 'pico' : b;
      if (this.serial.boardHint && fam(this.serial.boardHint) !== fam(bt)) prog(`⚠ 연결된 보드(${BOARDS[this.serial.boardHint].short})와 프로젝트 보드(${bn})가 다릅니다`);
      if (kind === 'upload') await this.serial.upload(code, libs, prog, bt);
      else await this.serial.runOnce(code, libs, prog, bt);
      this.setStatus(kind === 'upload' ? `✔ ${bn} 업로드 완료` : `▶ ${bn} 실행 중`, 'ok');
      if (kind === 'upload') this.toast(`${bn}에 main.py 업로드 완료 — 보드가 재시작되며 실행됩니다`, 'ok');
    } catch (e) {
      this.serialLog(`\n[오류] ${e.message}\n`, 'info');
      this.setStatus('Pico 작업 실패', 'err');
      this.toast(e.message, 'err');
      try { await this.serial.exitRaw(); } catch (e2) { }
    }
  }

  // ---------- UI 바인딩 ----------
  initUI() {
    const $ = id => document.getElementById(id);
    $('btnNew').onclick = () => { if (confirm('새 프로젝트를 만들까요? (현재 작업은 자동 저장본이 덮어써집니다)')) this.newProject(); };
    $('boardSel').onchange = e => this.switchBoard(e.target.value);
    $('btnOpen').onclick = () => this.openFile(false);
    $('btnSave').onclick = () => this.saveProject();
    $('btnSavePy').onclick = () => this.savePy();
    $('btnOpenPy').onclick = () => this.openFile(true);
    $('btnCopy').onclick = () => navigator.clipboard.writeText(this.cm.getValue()).then(() => this.toast('코드를 복사했습니다', 'ok'));
    $('btnRegen').onclick = () => {
      if (this.codeMode === 'manual' && !confirm('직접 수정한 코드를 버리고 노드에서 다시 생성할까요?')) return;
      this.setCodeMode('auto'); this.regen(true); this.autosave();
    };
    $('btnRun').onclick = () => this.runSim();
    $('btnStop').onclick = () => this.runtime.stop();
    $('btnMute').onclick = () => { Sound.muted = !Sound.muted; if (Sound.muted) Sound.allOff(); $('btnMute').textContent = Sound.muted ? '🔇' : '🔊'; };
    $('btnConnect').onclick = async () => {
      try {
        if (this.serial.connected) await this.serial.disconnect();
        else await this.serial.connect();
      } catch (e) { this.toast(e.message, 'err'); }
    };
    $('btnUpload').onclick = () => this.picoAction('upload');
    $('btnRunPico').onclick = () => this.picoAction('run');
    $('btnStopPico').onclick = () => this.serial.stopProgram().catch(e => this.toast(e.message, 'err'));
    $('btnCtrlC').onclick = () => this.serial.write('\x03').catch(e => this.toast(e.message, 'err'));
    $('btnCtrlD').onclick = () => this.serial.write('\x04').catch(e => this.toast(e.message, 'err'));
    $('btnLs').onclick = async () => {
      try { const out = await this.serial.listFiles(this.boardType()); this.serialLog('\n[보드 파일 목록]\n' + out + '\n', 'info'); }
      catch (e) { this.toast(e.message, 'err'); }
    };
    $('serialForm').onsubmit = e => {
      e.preventDefault();
      const v = $('serialInput').value;
      this.serial.write(v + '\r').catch(er => this.toast(er.message, 'err'));
      $('serialInput').value = '';
    };
    $('btnClear').onclick = () => {
      if ($('tab-sim').classList.contains('on')) $('simLog').innerHTML = ''; else $('serialLog').innerHTML = '';
    };
    $('btnHelp').onclick = () => $('help').hidden = false;
    $('helpClose').onclick = () => $('help').hidden = true;
    $('help').onclick = e => { if (e.target.id === 'help') $('help').hidden = true; };
    $('projName').addEventListener('change', () => this.autosave());
    $('projName').addEventListener('keydown', e => e.stopPropagation());
    $('zIn').onclick = () => this.editor.zoomBy(1.2);
    $('zOut').onclick = () => this.editor.zoomBy(1 / 1.2);
    $('zFit').onclick = () => this.editor.fit();
    $('warnBox').querySelector('.whead').onclick = () => $('warnBox').classList.toggle('open');
    $('warnList').onclick = e => { const id = e.target.dataset.id; if (id) { this.editor.select({ kind: 'node', id }); this.switchTab('rtabs', 'props'); } };

    document.querySelectorAll('.tabs').forEach(t => t.addEventListener('click', e => {
      const b = e.target.closest('[data-tab]');
      if (b) this.switchTab(t.id, b.dataset.tab);
    }));

    const dd = $('btnEx').parentElement;
    // 예제 메뉴: 보드별 탭 + 스크롤 목록 (현재 보드 탭이 기본)
    const exBoard = x => x.board || (/^Ⓜ/.test(x.name) ? 'microbit' : /^Ⓔ/.test(x.name) ? 'esp32' : /^Ⓩ/.test(x.name) ? 'rp2040zero' : 'pico');
    const renderEx = bt => {
      $('exMenu').innerHTML = `<div class="extabs">${Object.values(BOARDS).map(b => `<button data-exb="${b.type}" class="${b.type === bt ? 'on' : ''}">${b.icon} ${esc(b.short)} <em>${EXAMPLES.filter(x => exBoard(x) === b.type).length}</em></button>`).join('')}</div>
        <div class="exlist">${EXAMPLES.map((x, i) => exBoard(x) === bt ? `<div data-i="${i}">${esc(x.name)}<small>${esc(x.desc)}</small></div>` : '').join('')}</div>`;
    };
    $('btnEx').onclick = e => { e.stopPropagation(); if (!dd.classList.contains('open')) renderEx(this.boardType()); dd.classList.toggle('open'); };
    $('exMenu').onclick = e => {
      e.stopPropagation();
      const tab = e.target.closest('[data-exb]');
      if (tab) { renderEx(tab.dataset.exb); return; }
      const it = e.target.closest('[data-i]');
      if (!it) return;
      dd.classList.remove('open');
      this.load(EXAMPLES[+it.dataset.i].build());
      this.pushHistory(true);
      this.autosave();
      this.toast(`예제 불러옴: ${EXAMPLES[+it.dataset.i].name}`, 'ok');
    };
    document.addEventListener('click', () => dd.classList.remove('open'));

    if (!this.serial.supported) {
      $('btnConnect').title = '이 브라우저는 Web Serial을 지원하지 않습니다 (Chrome/Edge 필요)';
    }

    document.addEventListener('keydown', e => {
      const inField = e.target.closest && e.target.closest('input,textarea,select,.CodeMirror');
      if (e.key === 'F5') { e.preventDefault(); if (e.shiftKey) this.runtime.stop(); else this.runSim(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); this.saveProject(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); this.openFile(false); return; }
      if (inField) return;
      if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); $('btnNew').click(); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undoRedo(e.shiftKey ? 1 : -1); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); this.undoRedo(1); return; }
      if (e.ctrlKey && e.key.toLowerCase() === 'd') { e.preventDefault(); this.editor.duplicate(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.editor.deleteSelection(); }
      if (e.key === 'Escape') this.editor.select(null);
    });
    window.addEventListener('resize', () => { this.editor.drawWires(); this.cm.refresh(); });
    window.addEventListener('beforeunload', () => this.autosave());
  }

  initSplitters() {
    const root = document.documentElement;
    const drag = (el, fn) => el.addEventListener('pointerdown', e => {
      el.setPointerCapture(e.pointerId); el.classList.add('drag');
      const mv = ev => { fn(ev); this.cm.refresh(); };
      const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.classList.remove('drag'); this.editor.drawWires(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
    });
    drag(document.getElementById('splitR'), ev => root.style.setProperty('--right-w', clamp(window.innerWidth - ev.clientX, 280, window.innerWidth - 500) + 'px'));
    drag(document.getElementById('splitB'), ev => root.style.setProperty('--bottom-h', clamp(window.innerHeight - ev.clientY, 60, window.innerHeight - 200) + 'px'));
  }

  // ---------- 렌더 루프 ----------
  loop() {
    const frame = () => {
      try { this.frame(); } catch (e) { console.error(e); }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    // 시뮬레이션 시간 진행(장치 tick)은 화면 갱신과 독립적으로 동작
    setInterval(() => {
      const sim = this.sim;
      if (!sim.running) return;
      sim.step();
      const now = performance.now();
      for (const n of this.circuit.nodes) {
        const d = DEVICES[n.type];
        if (d && d.tick) d.tick(n, sim.ctx(n), now);
      }
    }, 20);
  }

  frame() {
    const sim = this.sim;
    if (sim.running) sim.step(); else sim.evaluate();
    for (const n of this.circuit.nodes) {
      if (!n.el) continue;
      const d = DEVICES[n.type];
      if (!d) continue;
      const ctx = sim.ctx(n);
      const hasPower = d.pins.some(p => p.role === 'vcc');
      n.el.classList.toggle('unpowered', hasPower && !sim.powered(n));
      if (d.render) {
        const v = n._view || (n._view = n.el.querySelector('.dview'));
        if (!v.isConnected) n._view = n.el.querySelector('.dview');
        d.render(n, ctx, n._view);
      }
    }
    // 보드 상태 (핀 표시, 내장 LED/화면 등)
    const bn = this.boardNode();
    if (bn && bn.el) BOARDS[bn.type].render(bn, sim);
    this.editor.renderLive();
    const sb = document.getElementById('shortBanner');
    const sh = sim.shortNets.size > 0;
    if (sb.hidden === sh) sb.hidden = !sh;
  }
}

const APP = new App();
window.addEventListener('DOMContentLoaded', () => APP.init());
