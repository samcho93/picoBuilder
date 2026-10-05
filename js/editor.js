// 노드 캔버스 에디터: Pico 보드, 하드웨어 모듈, 프로그램 노드를 포트-와이어로 연결
'use strict';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const WIRE_PALETTE = ['#f4b400', '#34a853', '#4285f4', '#ab47bc', '#00acc1', '#ff7043', '#8d6e63', '#ec407a', '#7cb342', '#26a69a'];
const catColor = cat => (DEV_CATS.find(c => c[0] === cat) || PROG_CATS.find(c => c[0] === cat) || [0, 0, '#666'])[2];

class Editor {
  constructor(app, el) {
    this.app = app;
    this.el = el;
    this.world = el.querySelector('.world');
    this.svg = el.querySelector('svg.wires');
    this.view = { x: 30, y: 20, k: 0.85 };
    this.sel = null;
    this.selNodes = new Set();
    this.ports = new Map();
    this.wireEls = [];
    this.bind();
    this.applyView();
  }

  get g() { return this.app.circuit; }
  node(id) { return this.g.nodes.find(n => n.id === id); }

  // ---------- 뷰 ----------
  applyView() {
    const v = this.view;
    this.world.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
    this.el.style.backgroundPosition = `${v.x}px ${v.y}px`;
    this.el.style.backgroundSize = `${20 * v.k}px ${20 * v.k}px`;
    const z = document.getElementById('zoomLbl');
    if (z) z.textContent = Math.round(v.k * 100) + '%';
  }
  toWorld(cx, cy) {
    const r = this.el.getBoundingClientRect();
    return { x: (cx - r.left - this.view.x) / this.view.k, y: (cy - r.top - this.view.y) / this.view.k };
  }
  zoomBy(f, cx, cy) {
    const r = this.el.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const p = this.toWorld(cx, cy);
    this.view.k = clamp(this.view.k * f, 0.2, 2.5);
    this.view.x = cx - r.left - p.x * this.view.k;
    this.view.y = cy - r.top - p.y * this.view.k;
    this.applyView();
  }
  fit() {
    const ns = this.g.nodes.filter(n => n.el);
    if (!ns.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of ns) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.el.offsetWidth); y1 = Math.max(y1, n.y + n.el.offsetHeight); }
    const r = this.el.getBoundingClientRect();
    const k = clamp(Math.min((r.width - 40) / (x1 - x0), (r.height - 40) / (y1 - y0)), 0.2, 1.2);
    this.view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k };
    this.applyView();
  }

  // ---------- 렌더 ----------
  renderAll() {
    this.world.querySelectorAll('.node').forEach(e => e.remove());
    this.ports.clear();
    for (const n of this.g.nodes) this.mountNode(n);
    this.refreshConn();
    requestAnimationFrame(() => this.drawWires());
  }

  mountNode(n) {
    if (n.el) { n.el.querySelectorAll('.port').forEach(p => this.ports.delete(p.dataset.t)); n.el.remove(); }
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = n.id;
    if (BOARDS[n.type]) { el.classList.add('board', n.type); el.innerHTML = BOARDS[n.type].html(n, this); }
    else if (DEVICES[n.type]) { el.classList.add('dev'); el.innerHTML = this.devHTML(n); }
    else if (NODES[n.type]) { el.classList.add('prog'); el.innerHTML = this.progHTML(n); }
    else { el.innerHTML = `<div class="nhead"><span class="ttl">알 수 없는 노드: ${esc(n.type)}</span><span class="hbtn del">×</span></div>`; }
    el.style.left = n.x + 'px';
    el.style.top = n.y + 'px';
    if (this.selNodes.has(n.id)) el.classList.add('selected');
    this.world.appendChild(el);
    n.el = el;
    el.querySelectorAll('.port').forEach(p => this.ports.set(p.dataset.t, p));
    this.bindNode(n, el);
    const d = DEVICES[n.type];
    if (d && d.mount) d.mount(n, el.querySelector('.dview'), this.app);
    const bd = BOARDS[n.type];
    if (bd && bd.mount) bd.mount(n, el, this.app);
    if (NODES[n.type]) this.fillDevSelects(el);
  }

  controlHTML(n, c) {
    const v = n.st[c.k];
    if (c.type === 'range') return `<label class="ctl"><span>${esc(c.label)}</span><input type="range" data-k="${c.k}" min="${c.min}" max="${c.max}" step="${c.step || 1}" value="${v}"><em>${v}${c.unit || ''}</em></label>`;
    if (c.type === 'select') return `<label class="ctl"><span>${esc(c.label)}</span><select data-k="${c.k}">${c.opts.map(([a, b]) => `<option value="${esc(a)}" ${String(v) === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>`;
    if (c.type === 'number') return `<label class="ctl"><span>${esc(c.label)}</span><input type="number" data-k="${c.k}" step="${c.step || 1}" value="${v}"></label>`;
    if (c.type === 'check') return `<label class="ctl chk"><input type="checkbox" data-k="${c.k}" ${v ? 'checked' : ''}><span>${esc(c.label)}</span></label>`;
    return '';
  }

  devHTML(n) {
    const d = DEVICES[n.type];
    const pins = d.pins.map(p => `<div class="dpin"><i class="port k-pin r-${p.role}" data-t="${n.id}:${esc(p.n)}" data-s="${n.flip ? 1 : -1}" title="${esc(n.name + '.' + p.n)}"></i><span>${esc(p.n)}</span></div>`).join('');
    const ctls = (d.controls || []).map(c => this.controlHTML(n, c)).join('');
    return `<div class="nhead" style="--c:${catColor(d.cat)}"><span class="ico">${d.icon}</span><span class="ttl">${esc(d.label)}</span><b class="nm">${esc(n.name)}</b>
        <span class="hbtn flip" title="핀 방향 전환">⇄</span><span class="hbtn del" title="삭제">×</span>
        <i class="port k-dev" data-t="${n.id}:@" data-s="1" title="모듈 참조 포트 → 프로그램 노드의 '모듈' 입력에 연결"></i></div>
      <div class="nbody dev-body${n.flip ? ' flipped' : ''}"><div class="dpins">${pins}</div>
        <div class="dview">${d.view ? d.view(n) : ''}${ctls}<div class="nopower">⚡ 전원 없음</div></div></div>`;
  }

  editorHTML(n, p) {
    const v = n.st[p.n] ?? p.def;
    if (p.k === 'pin') {
      const bd = BOARDS[this.app.boardType()];
      return `<select class="ed" data-k="pin"><option value="">핀?</option>${bd.gpios.map(g => `<option value="${g}" ${String(n.st.pin) === String(g) ? 'selected' : ''}>${bd.pinLabel(g)}</option>`).join('')}</select>`;
    }
    if (p.k === 'dev') return `<select class="ed dev-sel" data-k="dev" data-types="${p.types.join(',')}"></select>`;
    if (p.k !== 'data') return '';
    if (p.t === 'bool') return `<input class="ed" type="checkbox" data-k="${p.n}" ${v === false || v === 'False' ? '' : 'checked'}>`;
    if (p.t === 'number') return `<input class="ed num" type="number" data-k="${p.n}" value="${esc(v)}">`;
    return `<input class="ed txt" type="text" data-k="${p.n}" value="${esc(v)}">`;
  }

  progHTML(n) {
    const d = NODES[n.type];
    const rows = [];
    const len = Math.max(d.ins.length, d.outs.length);
    for (let i = 0; i < len; i++) {
      const a = d.ins[i], b = d.outs[i];
      const ain = a ? `<div class="pin-in" data-p="${a.n}"><i class="port k-${a.k} t-${a.t || ''}" data-t="${n.id}:${a.n}" data-s="-1" title="${esc(a.label || a.n)}"></i><span class="pl">${esc(a.label)}</span>${this.editorHTML(n, a)}</div>` : '<div class="pin-in"></div>';
      const bout = b ? `<div class="pin-out"><span class="pl">${esc(b.label)}</span><i class="port k-${b.k} t-${b.t || ''}" data-t="${n.id}:${b.n}" data-s="1" title="${esc(b.label || b.n)}"></i></div>` : '<div class="pin-out"></div>';
      rows.push(`<div class="prow2">${ain}${bout}</div>`);
    }
    const props = (d.props || []).map(p => {
      const v = n.st[p.k] ?? p.def;
      if (p.type === 'select') return `<label class="prop"><span>${esc(p.label)}</span><select data-k="${p.k}">${p.opts.map(([a, b]) => `<option value="${esc(a)}" ${String(v) === String(a) ? 'selected' : ''}>${esc(b)}</option>`).join('')}</select></label>`;
      return `<label class="prop"><span>${esc(p.label)}</span><input type="${p.type === 'number' ? 'number' : 'text'}" data-k="${p.k}" value="${esc(v)}"></label>`;
    }).join('');
    return `<div class="nhead" style="--c:${catColor(d.cat)}"><span class="ttl">${esc(d.label)}</span><span class="hbtn del" title="삭제">×</span></div>
      <div class="nbody prog-body">${rows.join('')}${props ? `<div class="props">${props}</div>` : ''}</div>`;
  }

  fillDevSelects(root = this.world) {
    const devs = this.g.nodes.filter(n => DEVICES[n.type]);
    root.querySelectorAll('select.dev-sel').forEach(s => {
      const types = s.dataset.types.split(',');
      const node = this.node(s.closest('.node').dataset.id);
      const cur = node.st.dev || '';
      const opts = devs.filter(d => types.includes(d.type));
      s.innerHTML = `<option value="">(선택)</option>` + opts.map(d => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
    });
  }

  // ---------- 노드 이벤트 ----------
  bindNode(n, el) {
    const head = el.querySelector('.nhead');
    head.addEventListener('pointerdown', e => {
      if (e.button !== 0 || e.target.closest('.hbtn,.port')) return;
      e.stopPropagation();
      // 선택되지 않은 블록을 잡으면 그 블록만 선택, Shift면 선택에 추가
      if (e.shiftKey) this.select({ kind: 'node', id: n.id }, true);
      else if (!this.selNodes.has(n.id)) this.select({ kind: 'node', id: n.id });
      else { this.sel = { kind: 'node', id: n.id }; this.app.showProps(); }
      // 선택된 블록 전체를 함께 이동
      const moving = [...this.selNodes].map(id => this.node(id)).filter(m => m && m.el);
      const start = moving.map(m => ({ n: m, x: m.x, y: m.y }));
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      try { head.setPointerCapture(e.pointerId); } catch (err) { }
      const mv = ev => {
        const dx = (ev.clientX - sx) / this.view.k, dy = (ev.clientY - sy) / this.view.k;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        for (const s of start) {
          s.n.x = Math.round((s.x + dx) / 5) * 5; s.n.y = Math.round((s.y + dy) / 5) * 5;
          s.n.el.style.left = s.n.x + 'px'; s.n.el.style.top = s.n.y + 'px';
        }
        this.drawWires();
      };
      const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); if (moved) this.app.changed({ code: false }); };
      head.addEventListener('pointermove', mv);
      head.addEventListener('pointerup', up);
    });
    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.port')) return;
      if (e.target.closest('input,select,button,textarea,.pad,.v-toggle')) { e.stopPropagation(); return; }
      if (e.button === 2) return;   // 오른쪽 버튼은 화면 이동 / 메뉴
      e.stopPropagation();
      if (e.shiftKey) this.select({ kind: 'node', id: n.id }, true);
      else if (!this.selNodes.has(n.id)) this.select({ kind: 'node', id: n.id });
    });
    const del = el.querySelector('.hbtn.del');
    if (del) del.addEventListener('click', e => { e.stopPropagation(); this.removeNode(n.id); });
    const flip = el.querySelector('.hbtn.flip');
    if (flip) flip.addEventListener('click', e => { e.stopPropagation(); n.flip = !n.flip; this.mountNode(n); this.refreshConn(); this.drawWires(); this.app.changed({ code: false }); });
    el.querySelectorAll('.port').forEach(p => p.addEventListener('pointerdown', e => this.startWire(e, p.dataset.t)));

    // 모듈/보드 컨트롤
    const d = DEVICES[n.type] || BOARDS[n.type];
    if (d) {
      el.querySelectorAll('.dview [data-k], .mb-ctls [data-k], .esp-ctls [data-k]').forEach(inp => {
        const c = (d.controls || []).find(x => x.k === inp.dataset.k);
        const ev = inp.type === 'range' ? 'input' : 'change';
        inp.addEventListener(ev, () => {
          let v = inp.type === 'checkbox' ? inp.checked : inp.value;
          if (inp.type === 'range' || inp.type === 'number') v = parseFloat(v) || 0;
          n.st[inp.dataset.k] = v;
          const em = inp.parentElement.querySelector('em');
          if (em) em.textContent = v + (c && c.unit || '');
          if (c && c.rebuild) { this.mountNode(n); this.refreshConn(); this.drawWires(); }
          this.app.sim.step();
          this.app.changed({ code: inp.tagName === 'SELECT', history: inp.type !== 'range' });
        });
      });
      el.querySelectorAll('[data-hold]').forEach(b => {
        const k = b.dataset.hold;
        const set = v => { if (n.st[k] === v) return; n.st[k] = v; if (d.closed) this.app.sim.invalidate(); this.app.sim.step(); };
        b.addEventListener('pointerdown', e => { e.stopPropagation(); b.setPointerCapture(e.pointerId); set(true); });
        b.addEventListener('pointerup', () => set(false));
        b.addEventListener('pointercancel', () => set(false));
      });
      el.querySelectorAll('[data-toggle]').forEach(b => {
        const k = b.dataset.toggle;
        b.addEventListener('pointerdown', e => e.stopPropagation());
        b.addEventListener('click', () => { n.st[k] = !n.st[k]; if (d.closed) this.app.sim.invalidate(); this.app.sim.step(); });
      });
    }
    // 프로그램 노드 입력값/속성
    if (NODES[n.type]) {
      el.querySelectorAll('[data-k]').forEach(inp => {
        inp.addEventListener('keydown', e => e.stopPropagation());
        inp.addEventListener('change', () => {
          let v = inp.type === 'checkbox' ? inp.checked : inp.value;
          if (inp.type === 'number') v = inp.value === '' ? '' : parseFloat(inp.value);
          n.st[inp.dataset.k] = v;
          this.app.changed({});
        });
      });
    }
  }

  // ---------- 선택 / 삭제 ----------
  // s: null | {kind:'node', id} | {kind:'wire', i} / add: Shift 선택(토글)
  select(s, add = false) {
    if (!s) { this.selNodes.clear(); this.sel = null; }
    else if (s.kind === 'node') {
      if (add) { if (this.selNodes.has(s.id)) this.selNodes.delete(s.id); else this.selNodes.add(s.id); }
      else this.selNodes = new Set([s.id]);
      this.sel = this.selNodes.has(s.id) ? s : (this.selNodes.size ? { kind: 'node', id: [...this.selNodes][0] } : null);
    } else { this.selNodes.clear(); this.sel = s; }
    this.refreshSelection();
  }
  selectAll() {
    this.selNodes = new Set(this.g.nodes.filter(n => !BOARDS[n.type]).map(n => n.id));
    this.sel = this.selNodes.size ? { kind: 'node', id: [...this.selNodes][0] } : null;
    this.refreshSelection();
  }
  markSelected() {
    for (const n of this.g.nodes) if (n.el) n.el.classList.toggle('selected', this.selNodes.has(n.id));
  }
  refreshSelection() {
    this.markSelected();
    this.drawWires();
    this.app.showProps();
    this.updateEditBar();
  }
  updateEditBar() {
    const bar = document.getElementById('editBar');
    if (!bar) return;
    const n = this.selNodes.size;
    bar.hidden = !n && !(this.sel && this.sel.kind === 'wire');
    const lbl = document.getElementById('editCount');
    if (lbl) lbl.textContent = n ? `블록 ${n}개 선택` : '와이어 1개 선택';
  }
  removeNode(id, batch) {
    const n = this.node(id);
    if (!n || BOARDS[n.type]) return;
    this.g.wires = this.g.wires.filter(w => splitTerm(w.a)[0] !== id && splitTerm(w.b)[0] !== id);
    for (const m of this.g.nodes) if (m.st && m.st.dev === id) m.st.dev = '';
    if (n.el) { n.el.querySelectorAll('.port').forEach(p => this.ports.delete(p.dataset.t)); n.el.remove(); }
    this.g.nodes = this.g.nodes.filter(x => x !== n);
    Sound.set(id, 0, false);
    this.selNodes.delete(id);
    if (this.sel && this.sel.id === id) this.sel = null;
    if (batch) return;
    this.fillDevSelects();
    this.app.sim.invalidate();
    this.refreshConn();
    this.drawWires();
    this.app.showProps();
    this.updateEditBar();
    this.app.changed({});
  }
  removeWire(i) {
    const w = this.g.wires[i];
    if (w && this.wireKind(w) === 'devref') {
      const n = this.node(splitTerm(w.b)[0]);
      if (n) { n.st.dev = ''; this.fillDevSelects(n.el); }
    }
    this.g.wires.splice(i, 1);
    this.sel = null;
    this.app.sim.invalidate();
    this.refreshConn();
    this.drawWires();
    this.app.changed({});
  }
  deleteSelection() {
    if (this.selNodes.size) {
      const ids = [...this.selNodes];
      const kept = ids.filter(id => { const n = this.node(id); return n && BOARDS[n.type]; }).length;
      for (const id of ids) this.removeNode(id, true);
      this.selNodes.clear();
      this.sel = null;
      this.fillDevSelects();
      this.app.sim.invalidate();
      this.refreshConn();
      this.drawWires();
      this.app.showProps();
      this.updateEditBar();
      this.app.changed({});
      this.app.toast(`${ids.length - kept}개 블록을 삭제했습니다${kept ? ' (보드는 삭제할 수 없습니다)' : ''}`, kept ? 'warn' : 'ok');
      return;
    }
    if (this.sel && this.sel.kind === 'wire') this.removeWire(this.sel.i);
  }

  // ---------- 복사 / 잘라내기 / 붙여넣기 ----------
  copy(cut) {
    const ids = [...this.selNodes].filter(id => { const n = this.node(id); return n && !BOARDS[n.type]; });
    if (!ids.length) { this.app.toast('복사할 블록을 먼저 선택하세요', 'warn'); return; }
    const set = new Set(ids);
    const nodes = ids.map(id => {
      const n = this.node(id);
      return { id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, flip: n.flip || undefined, st: JSON.parse(JSON.stringify(n.st || {})) };
    });
    const wires = this.g.wires.filter(w => set.has(splitTerm(w.a)[0]) && set.has(splitTerm(w.b)[0])).map(w => ({ ...w }));
    this.app.clip = { nodes, wires };
    try { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify({ picoBuilder: 'blocks', nodes, wires })); } catch (e) { }
    if (cut) { for (const id of ids) this.removeNode(id, true); this.afterBatch(); }
    this.app.toast(`블록 ${nodes.length}개를 ${cut ? '잘라냈습니다' : '복사했습니다'}`, 'ok');
  }
  afterBatch() {
    this.selNodes.clear();
    this.sel = null;
    this.fillDevSelects();
    this.app.sim.invalidate();
    this.refreshConn();
    this.drawWires();
    this.app.showProps();
    this.updateEditBar();
    this.app.changed({});
  }
  paste(at) {
    const clip = this.app.clip;
    if (!clip || !clip.nodes.length) { this.app.toast('붙여넣을 블록이 없습니다 (먼저 복사하세요)', 'warn'); return; }
    const minX = Math.min(...clip.nodes.map(n => n.x)), minY = Math.min(...clip.nodes.map(n => n.y));
    const dx = at ? at.x - minX : 28, dy = at ? at.y - minY : 28;
    const map = new Map(), made = [];
    for (const n of clip.nodes) {
      const nn = this.addNode(n.type, n.x + dx, n.y + dy, { st: JSON.parse(JSON.stringify(n.st)), flip: n.flip });
      map.set(n.id, nn.id);
      made.push(nn.id);
    }
    for (const w of clip.wires) {
      const [sa, pa] = splitTerm(w.a), [sb, pb] = splitTerm(w.b);
      if (map.has(sa) && map.has(sb)) this.connect(`${map.get(sa)}:${pa}`, `${map.get(sb)}:${pb}`);
    }
    for (const id of made) {   // 모듈 참조(드롭다운)도 새 블록으로 연결
      const n = this.node(id);
      if (n && n.st && n.st.dev && map.has(n.st.dev)) n.st.dev = map.get(n.st.dev);
    }
    this.selNodes = new Set(made);
    this.sel = made.length ? { kind: 'node', id: made[0] } : null;
    this.fillDevSelects();
    this.refreshConn();
    this.refreshSelection();
    this.app.changed({});
    this.app.toast(`블록 ${made.length}개를 붙여넣었습니다`, 'ok');
  }

  addNode(type, x, y, extra = {}) {
    const ids = new Set(this.g.nodes.map(n => n.id));
    let k = this.g.seq || 1;
    while (ids.has('n' + k)) k++;
    this.g.seq = k + 1;
    const n = { id: 'n' + k, type, x: Math.round(x / 5) * 5, y: Math.round(y / 5) * 5, st: {} };
    const d = DEVICES[type];
    if (d) {
      n.st = d.init ? d.init() : {};
      const names = new Set(this.g.nodes.map(m => m.name));
      let i = 1; while (names.has(d.prefix + i)) i++;
      n.name = d.prefix + i;
    } else if (NODES[type]) {
      for (const p of NODES[type].props || []) n.st[p.k] = p.def;
    }
    Object.assign(n, extra);
    this.g.nodes.push(n);
    this.mountNode(n);
    if (d) this.fillDevSelects();
    this.app.sim.invalidate();
    if (d && d.onAdd && !extra.st) { try { d.onAdd(n, this.app, this); } catch (e) { console.error(e); } }
    this.select({ kind: 'node', id: n.id });
    this.app.changed({});
    return n;
  }

  duplicate() {
    const before = this.app.clip;
    this.copy(false);
    this.paste(null);
    this.app.clip = before || this.app.clip;
  }

  // ---------- 포트 정보 / 연결 ----------
  portInfo(t) {
    const [id, p] = splitTerm(t);
    const n = this.node(id);
    if (!n) return null;
    if (BOARDS[n.type]) { const pp = BOARDS[n.type].pins[p]; return pp ? { hw: true, board: true, k: 'pin', dir: 'io', gpio: pp.gpio, role: pp.type, node: n } : null; }
    const d = DEVICES[n.type];
    if (d) {
      if (p === '@') return { k: 'dev', dir: 'out', devType: n.type, node: n };
      const pin = d.pins.find(x => x.n === p);
      return pin ? { hw: true, k: 'pin', dir: 'io', role: pin.role, node: n } : null;
    }
    const nd = NODES[n.type];
    if (!nd) return null;
    const i = nd.ins.find(x => x.n === p);
    if (i) return { ...i, dir: 'in', node: n };
    const o = nd.outs.find(x => x.n === p);
    return o ? { ...o, dir: 'out', node: n } : null;
  }

  canConnect(ta, tb) {
    if (!ta || !tb || ta === tb) return null;
    const A = this.portInfo(ta), B = this.portInfo(tb);
    if (!A || !B) return null;
    if (A.hw && B.hw) return { a: ta, b: tb, kind: 'hw' };
    if (A.k === 'pin' && B.k === 'pin') {
      const [src, dst, S] = A.dir === 'in' ? [tb, ta, B] : [ta, tb, A];
      if (this.portInfo(dst).dir !== 'in') return null;
      if (!(S.hw && S.board && S.gpio != null)) return { err: '프로그램의 "핀" 입력은 보드의 GPIO 핀에만 연결할 수 있습니다' };
      return { a: src, b: dst, kind: 'pinref', single: 'b' };
    }
    if (A.k !== B.k) return { err: '포트 종류가 다릅니다 (실행 ▶ / 값 ● / 핀 / 모듈 ◆)' };
    if (A.dir === B.dir) return { err: '출력 포트와 입력 포트를 연결하세요' };
    const [src, dst, S, T] = A.dir === 'out' ? [ta, tb, A, B] : [tb, ta, B, A];
    if (S.node === T.node) return { err: '같은 노드끼리는 연결할 수 없습니다' };
    if (A.k === 'exec') return { a: src, b: dst, kind: 'exec', single: 'a' };
    if (A.k === 'dev') {
      if (!T.types.includes(S.devType)) return { err: `이 입력에는 ${T.types.map(t => DEVICES[t].label).join('/')} 모듈만 연결할 수 있습니다` };
      return { a: src, b: dst, kind: 'devref', single: 'b' };
    }
    const ok = T.t === 'any' || S.t === 'any' || S.t === T.t || T.t === 'string' || (S.t === 'bool' && T.t === 'number') || (S.t === 'number' && T.t === 'bool');
    if (!ok) return { err: `타입 불일치: ${S.t} → ${T.t}` };
    return { a: src, b: dst, kind: 'data', single: 'b' };
  }

  connect(ta, tb) {
    const c = this.canConnect(ta, tb);
    if (!c) return false;
    if (c.err) { this.app.toast(c.err, 'warn'); return false; }
    if (this.g.wires.some(w => (w.a === c.a && w.b === c.b) || (w.a === c.b && w.b === c.a))) return false;
    if (c.single === 'b') this.g.wires = this.g.wires.filter(w => w.b !== c.b);
    if (c.single === 'a') this.g.wires = this.g.wires.filter(w => w.a !== c.a);
    const w = { a: c.a, b: c.b };
    if (c.kind === 'hw') w.color = this.autoColor(c.a, c.b);
    this.g.wires.push(w);
    if (c.kind === 'devref') { const n = this.node(splitTerm(c.b)[0]); if (n) n.st.dev = splitTerm(c.a)[0]; }
    this.app.sim.invalidate();
    this.refreshConn();
    this.drawWires();
    this.app.changed({});
    return true;
  }

  autoColor(a, b) {
    const roles = [a, b].map(t => this.portInfo(t)?.role);
    if (roles.includes('gnd')) return '#3a3a3a';
    if (roles.includes('power') || roles.includes('vcc')) return '#e53935';
    if (roles.includes('power5')) return '#ff7043';
    return WIRE_PALETTE[this.g.wires.length % WIRE_PALETTE.length];
  }

  wireKind(w) {
    const A = this.portInfo(w.a), B = this.portInfo(w.b);
    if (!A || !B) return 'bad';
    if (A.hw && B.hw) return 'hw';
    if (A.k === 'pin' || B.k === 'pin') return 'pinref';
    return A.k === 'exec' ? 'exec' : A.k === 'dev' ? 'devref' : 'data';
  }

  refreshConn() {
    const conn = new Set();
    for (const w of this.g.wires) { conn.add(w.a); conn.add(w.b); }
    for (const [t, el] of this.ports) {
      el.classList.toggle('conn', conn.has(t));
      const row = el.closest('.pin-in');
      if (row) row.classList.toggle('conn', conn.has(t));
    }
  }

  startWire(e, t) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const p0 = this.portCenter(t);
    if (!p0) return;
    const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    tmp.setAttribute('class', 'wire temp');
    this.svg.appendChild(tmp);
    const s0 = this.ports.get(t).dataset.s || '1';
    this.el.classList.add('wiring');
    const mv = ev => {
      const p = this.toWorld(ev.clientX, ev.clientY);
      tmp.setAttribute('d', this.curve(p0, s0, p, s0 === 'd' ? 'u' : String(-s0)));
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      this.world.querySelectorAll('.port.hover').forEach(x => x.classList.remove('hover'));
      const op = over && over.closest && over.closest('.port');
      if (op && op.dataset.t !== t) op.classList.add(this.canConnect(t, op.dataset.t)?.err ? 'bad' : 'hover');
    };
    const up = ev => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      tmp.remove();
      this.el.classList.remove('wiring');
      this.world.querySelectorAll('.port.hover,.port.bad').forEach(x => x.classList.remove('hover', 'bad'));
      const over = document.elementFromPoint(ev.clientX, ev.clientY);
      const op = over && over.closest && over.closest('.port');
      if (op) this.connect(t, op.dataset.t);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  }

  // ---------- 와이어 그리기 ----------
  portCenter(t) {
    const el = this.ports.get(t);
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return this.toWorld(r.left + r.width / 2, r.top + r.height / 2);
  }
  // 포트 방향: '1'(오른쪽) '-1'(왼쪽) 'd'(아래) 'u'(위)
  curve(a, sa, b, sb) {
    const v = s => s === 'd' ? [0, 1] : s === 'u' ? [0, -1] : [+s || 1, 0];
    const [ax, ay] = v(String(sa)), [bx, by] = v(String(sb));
    const d = Math.max(30, Math.min(160, Math.abs(b.x - a.x) * 0.5 + Math.abs(b.y - a.y) * (ay || by ? 0.5 : 0.15)));
    return `M${a.x},${a.y} C${a.x + ax * d},${a.y + ay * d} ${b.x + bx * d},${b.y + by * d} ${b.x},${b.y}`;
  }

  drawWires() {
    const NS = 'http://www.w3.org/2000/svg';
    this.svg.querySelectorAll('g.w').forEach(e => e.remove());
    this.wireEls = [];
    this.g.wires.forEach((w, i) => {
      const a = this.portCenter(w.a), b = this.portCenter(w.b);
      if (!a || !b) return;
      const kind = this.wireKind(w);
      const sa = this.ports.get(w.a).dataset.s || '1', sb = this.ports.get(w.b).dataset.s || '-1';
      const d = this.curve(a, sa, b, sb);
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'w');
      const hit = document.createElementNS(NS, 'path');
      hit.setAttribute('d', d); hit.setAttribute('class', 'hit');
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      let cls = 'wire k-' + kind;
      if (this.sel && this.sel.kind === 'wire' && this.sel.i === i) cls += ' sel';
      p.setAttribute('class', cls);
      if (kind === 'hw') p.style.stroke = w.color || '#f4b400';
      if (kind === 'data') { const S = this.portInfo(w.a); p.style.stroke = TYPE_COLORS[S && S.t] || '#9aa4b2'; }
      g.appendChild(hit); g.appendChild(p);
      hit.addEventListener('pointerdown', e => { e.stopPropagation(); this.select({ kind: 'wire', i }); });
      hit.addEventListener('dblclick', e => { e.stopPropagation(); this.removeWire(i); });
      this.svg.appendChild(g);
      this.wireEls.push({ w, p, kind });
    });
  }

  // ---------- 우클릭 편집 메뉴 ----------
  showMenu(ev) {
    const m = document.getElementById('ctxMenu');
    if (!m) return;
    this.menuAt = this.toWorld(ev.clientX, ev.clientY);
    const has = this.selNodes.size > 0;
    const clip = !!(this.app.clip && this.app.clip.nodes.length);
    m.innerHTML = [
      ['copy', '📋 복사', 'Ctrl+C', has], ['cut', '✂ 잘라내기', 'Ctrl+X', has],
      ['paste', '📌 붙여넣기', 'Ctrl+V', clip], ['dup', '⧉ 복제', 'Ctrl+D', has],
      ['del', '🗑 삭제', 'Delete', has || (this.sel && this.sel.kind === 'wire')],
      ['all', '▣ 전체 선택', 'Ctrl+A', true],
    ].map(([k, t, s, on]) => `<div data-act="${k}" class="${on ? '' : 'off'}">${t}<small>${s}</small></div>`).join('');
    m.style.left = ev.clientX + 'px';
    m.style.top = ev.clientY + 'px';
    m.hidden = false;
    m.onclick = e => {
      const it = e.target.closest('[data-act]');
      if (!it || it.classList.contains('off')) return;
      const a = it.dataset.act;
      this.hideMenu();
      if (a === 'copy') this.copy(false);
      else if (a === 'cut') this.copy(true);
      else if (a === 'paste') this.paste(this.menuAt);
      else if (a === 'dup') this.duplicate();
      else if (a === 'del') this.deleteSelection();
      else if (a === 'all') this.selectAll();
    };
  }
  hideMenu() { const m = document.getElementById('ctxMenu'); if (m) m.hidden = true; }

  // 시뮬레이션 상태 표시 (프레임마다)
  renderLive() {
    const sim = this.app.sim;
    for (const { w, p, kind } of this.wireEls) {
      if (kind !== 'hw') continue;
      const ni = sim.netOf.get(w.a);
      const short = ni !== undefined && sim.shortNets.has(ni);
      const lv = ni === undefined ? null : sim.netLevel(ni);
      p.classList.toggle('short', short);
      p.classList.toggle('hot', lv === 1);
    }
  }

  // ---------- 캔버스 이벤트 ----------
  bind() {
    const el = this.el;
    // 오른쪽(또는 가운데) 버튼 드래그 = 화면 이동, 왼쪽 드래그 = 영역 선택
    el.addEventListener('contextmenu', e => { e.preventDefault(); });
    el.addEventListener('pointerdown', e => {
      if (e.button === 2 || e.button === 1 || e.altKey) {
        const sx = e.clientX, sy = e.clientY, ox = this.view.x, oy = this.view.y;
        try { el.setPointerCapture(e.pointerId); } catch (err) { }
        el.classList.add('panning');
        let moved = false;
        const mv = ev => {
          if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
          this.view.x = ox + ev.clientX - sx; this.view.y = oy + ev.clientY - sy; this.applyView();
        };
        const up = ev => {
          el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
          el.classList.remove('panning');
          if (!moved && e.button === 2) this.showMenu(ev);   // 제자리 우클릭 = 편집 메뉴
        };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
        return;
      }
      if (e.button !== 0 || e.target.closest('.node')) return;
      // 영역(러버밴드) 선택
      const base = e.shiftKey ? new Set(this.selNodes) : new Set();
      if (!e.shiftKey) this.select(null);
      const p0 = this.toWorld(e.clientX, e.clientY);
      const box = document.createElement('div');
      box.className = 'selbox';
      this.world.appendChild(box);
      try { el.setPointerCapture(e.pointerId); } catch (err) { }
      const mv = ev => {
        const p = this.toWorld(ev.clientX, ev.clientY);
        const x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
        box.style.left = x + 'px'; box.style.top = y + 'px'; box.style.width = w + 'px'; box.style.height = h + 'px';
        const sel = new Set(base);
        for (const n of this.g.nodes) {
          if (!n.el) continue;
          if (n.x < x + w && n.x + n.el.offsetWidth > x && n.y < y + h && n.y + n.el.offsetHeight > y) sel.add(n.id);
        }
        this.selNodes = sel;
        this.markSelected();
      };
      const up = () => {
        el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up);
        box.remove();
        this.sel = this.selNodes.size ? { kind: 'node', id: [...this.selNodes][0] } : null;
        this.refreshSelection();
      };
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
    });
    el.addEventListener('wheel', e => {
      if (e.target.closest('.v-bt .log')) return;
      e.preventDefault();
      this.zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
    }, { passive: false });
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/pb-type')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxMenu')) this.hideMenu(); }, true);
    el.addEventListener('drop', e => {
      const type = e.dataTransfer.getData('text/pb-type');
      if (!type) return;
      e.preventDefault();
      const p = this.toWorld(e.clientX, e.clientY);
      this.addNode(type, p.x - 60, p.y - 15);
    });
  }
}
