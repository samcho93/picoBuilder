// 프로그램 노드 정의 + 그래프 → MicroPython 코드 생성기
// 포트 종류: exec(실행 흐름), data(값), pin(Pico GPIO 핀 참조), dev(하드웨어 모듈 참조)
'use strict';

const PROG_CATS = [
  ['event', '이벤트', '#f0a030'],
  ['flow', '흐름 제어', '#e5c07b'],
  ['gpio', 'GPIO', '#61afef'],
  ['time', '시간', '#d19a66'],
  ['var', '변수', '#ff79c6'],
  ['math', '연산 / 값', '#abb2bf'],
  ['logic', '논리 / 비교', '#7ec699'],
  ['text', '텍스트 / 출력', '#8be9fd'],
  ['m_io', '모듈: 입출력', '#4a9eff'],
  ['m_sensor', '모듈: 센서', '#98c379'],
  ['m_disp', '모듈: 디스플레이', '#c678dd'],
  ['m_comm', '모듈: 통신/시계', '#56b6c2'],
  ['mb', 'micro:bit 전용', '#2c7be5'],
  ['esp', 'ESP32 전용', '#c0392b'],
];

const TYPE_COLORS = { number: '#98c379', bool: '#e06c75', string: '#e5a0ff', any: '#9aa4b2' };

const X = (n = 'in', label = '') => ({ n, k: 'exec', label });
const D = (n, t, def, label) => ({ n, k: 'data', t, def, label: label ?? n });
const PIN = (label = '핀') => ({ n: 'pin', k: 'pin', label });
const DEV = (types, label = '모듈') => ({ n: 'dev', k: 'dev', types, label });
const OUT = (n, t, label) => ({ n, k: 'data', t, label: label ?? n });

const NODES = {};
const def = (type, spec) => { NODES[type] = spec; };

const ind = (lines, n = 1) => (lines.length ? lines : ['pass']).map(l => '    '.repeat(n) + l);

// ================= 이벤트 =================
def('ev_start', { label: '시작', cat: 'event', desc: '프로그램이 시작될 때 한 번 실행합니다.', ins: [], outs: [X('out', '실행')] });
def('ev_loop', {
  label: '무한 반복', cat: 'event', desc: '시작 블록 실행 후 계속 반복 실행합니다 (while True).', ins: [], outs: [X('out', '반복')],
  props: [{ k: 'delay', type: 'number', label: '주기(ms)', def: 10 }],
});
def('ev_timer', {
  label: '타이머 (주기)', cat: 'event', desc: '지정한 주기(ms)마다 실행합니다 (machine.Timer).', ins: [], outs: [X('out', '실행')],
  props: [{ k: 'period', type: 'number', label: '주기(ms)', def: 1000 }],
});
def('ev_pin', {
  label: '핀 변화 (인터럽트)', cat: 'event', desc: '핀 신호가 바뀔 때 실행합니다 (Pin.irq).', ins: [PIN()], outs: [X('out', '실행')],
  props: [
    { k: 'edge', type: 'select', label: '조건', def: 'FALLING', opts: [['FALLING', '하강(1→0)'], ['RISING', '상승(0→1)'], ['BOTH', '양쪽']] },
    { k: 'pull', type: 'select', label: '풀업', def: 'PULL_UP', opts: [['PULL_UP', '풀업'], ['PULL_DOWN', '풀다운'], ['NONE', '없음']] },
  ],
});
def('ev_button', {
  label: '버튼 눌림', cat: 'event', desc: '버튼 모듈이 눌렸을 때 실행합니다 (인터럽트 + 디바운스).',
  ins: [DEV(['button', 'switch'], '버튼')], outs: [X('out', '실행')],
});

// ================= 흐름 제어 =================
def('if', {
  label: '만약 (if)', cat: 'flow', desc: '조건이 참이면 "참", 아니면 "거짓" 흐름을 실행한 뒤 "다음"으로 진행합니다.',
  ins: [X(), D('cond', 'bool', true, '조건')], outs: [X('then', '참'), X('else', '거짓'), X('out', '다음')],
  stmt(n, G) {
    const t = G.chain(n, 'then'), e = G.chain(n, 'else');
    const L = [`if ${G.expr(n, 'cond')}:`, ...ind(t)];
    if (e.length) L.push('else:', ...ind(e));
    return L;
  },
});
def('repeat', {
  label: 'N번 반복', cat: 'flow', desc: '"반복" 흐름을 N번 실행합니다. i = 0 ~ N-1',
  ins: [X(), D('count', 'number', 10, '횟수')], outs: [X('body', '반복'), X('out', '완료'), OUT('i', 'number', 'i')],
  stmt: (n, G) => [`for _i_${n.id} in range(int(${G.expr(n, 'count')})):`, ...ind(G.chain(n, 'body'))],
  expr: n => `_i_${n.id}`,
});
def('for_range', {
  label: '범위 반복 (for)', cat: 'flow', desc: '시작값부터 끝값 직전까지 간격만큼 증가하며 반복합니다.',
  ins: [X(), D('from', 'number', 0, '시작'), D('to', 'number', 10, '끝'), D('step', 'number', 1, '간격')],
  outs: [X('body', '반복'), X('out', '완료'), OUT('i', 'number', 'i')],
  stmt: (n, G) => [`for _i_${n.id} in range(int(${G.expr(n, 'from')}), int(${G.expr(n, 'to')}), int(${G.expr(n, 'step')})):`, ...ind(G.chain(n, 'body'))],
  expr: n => `_i_${n.id}`,
});
def('while', {
  label: '조건 반복 (while)', cat: 'flow', desc: '조건이 참인 동안 반복합니다.',
  ins: [X(), D('cond', 'bool', true, '조건')], outs: [X('body', '반복'), X('out', '완료')],
  stmt: (n, G) => [`while ${G.expr(n, 'cond')}:`, ...ind(G.chain(n, 'body'))],
});
def('break', { label: '반복 중단 (break)', cat: 'flow', desc: '가장 가까운 반복문을 빠져나갑니다.', ins: [X()], outs: [], stmt: () => ['break'] });
def('wait_until', {
  label: '조건까지 대기', cat: 'flow', desc: '조건이 참이 될 때까지 기다립니다.',
  ins: [X(), D('cond', 'bool', true, '조건')], outs: [X('out')],
  stmt: (n, G) => [`while not (${G.expr(n, 'cond')}):`, '    ' + G.B.sleep(10)],
});

// ================= 시간 =================
def('wait', {
  label: '기다리기', cat: 'time', desc: '지정한 시간(ms)만큼 기다립니다.',
  ins: [X(), D('ms', 'number', 500, 'ms')], outs: [X('out')],
  stmt: (n, G) => [G.B.sleep(`int(${G.expr(n, 'ms')})`)],
});
def('ticks', { label: '경과 시간(ms)', cat: 'time', desc: '부팅 후 경과 시간 (Pico: time.ticks_ms / micro:bit: running_time)', ins: [], outs: [OUT('ms', 'number')], expr: (n, G) => G.B.ticks });
def('elapsed', {
  label: '시간 차이(ms)', cat: 'time', desc: '현재 - 이전 (ticks_diff)', ins: [D('now', 'number', 0, '현재'), D('prev', 'number', 0, '이전')], outs: [OUT('ms', 'number')],
  expr: (n, G) => G.B.diff(G.expr(n, 'now'), G.expr(n, 'prev')),
});

// ================= 변수 =================
const VARPROP = { k: 'name', type: 'text', label: '이름', def: 'count' };
def('var_set', {
  label: '변수 설정', cat: 'var', desc: '변수에 값을 저장합니다.', ins: [X(), D('value', 'any', 0, '값')], outs: [X('out')], props: [VARPROP],
  stmt: (n, G) => [`${G.var(n)} = ${G.expr(n, 'value')}`],
});
def('var_change', {
  label: '변수 증가', cat: 'var', desc: '변수에 값을 더합니다 (음수면 감소).', ins: [X(), D('by', 'number', 1, '증가량')], outs: [X('out')], props: [VARPROP],
  stmt: (n, G) => [`${G.var(n)} += ${G.expr(n, 'by')}`],
});
def('var_get', { label: '변수 값', cat: 'var', desc: '변수 값을 읽습니다.', ins: [], outs: [OUT('value', 'any', '값')], props: [VARPROP], expr: (n, G) => G.var(n) });

// ================= 연산 / 값 =================
def('num', { label: '숫자', cat: 'math', desc: '숫자 상수', ins: [], outs: [OUT('value', 'number', '값')], props: [{ k: 'v', type: 'number', label: '값', def: 0 }], expr: n => numLit(n.st.v) });
def('str', { label: '문자열', cat: 'math', desc: '문자열 상수', ins: [], outs: [OUT('value', 'string', '값')], props: [{ k: 'v', type: 'text', label: '값', def: 'Hello' }], expr: n => pyStr(n.st.v ?? '') });
def('bool', {
  label: '참/거짓', cat: 'math', desc: '논리 상수', ins: [], outs: [OUT('value', 'bool', '값')],
  props: [{ k: 'v', type: 'select', label: '값', def: 'True', opts: [['True', '참'], ['False', '거짓']] }], expr: n => n.st.v === 'False' ? 'False' : 'True',
});
def('math', {
  label: '사칙연산', cat: 'math', desc: 'A (연산) B', ins: [D('a', 'number', 0, 'A'), D('b', 'number', 1, 'B')], outs: [OUT('r', 'number', '결과')],
  props: [{ k: 'op', type: 'select', label: '연산', def: '+', opts: [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷'], ['//', '몫'], ['%', '나머지'], ['**', '거듭제곱']] }],
  expr: (n, G) => `${G.expr(n, 'a')} ${n.st.op || '+'} ${G.expr(n, 'b')}`,
});
def('mathfn', {
  label: '수학 함수', cat: 'math', desc: 'abs, round, int, sqrt, sin, cos ...', ins: [D('x', 'number', 0, 'x')], outs: [OUT('r', 'number', '결과')],
  props: [{ k: 'fn', type: 'select', label: '함수', def: 'round', opts: [['round', 'round'], ['int', 'int'], ['abs', 'abs'], ['math.sqrt', 'sqrt'], ['math.sin', 'sin(rad)'], ['math.cos', 'cos(rad)'], ['math.floor', 'floor'], ['math.ceil', 'ceil'], ['float', 'float']] }],
  expr(n, G) { const f = n.st.fn || 'round'; if (f.startsWith('math.')) G.imp('import math'); return `${f}(${G.expr(n, 'x')})`; },
});
def('map', {
  label: '범위 변환 (map)', cat: 'math', desc: 'x를 [입력최소~최대] → [출력최소~최대]로 변환',
  ins: [D('x', 'number', 0, 'x'), D('a', 'number', 0, '입력 최소'), D('b', 'number', 65535, '입력 최대'), D('c', 'number', 0, '출력 최소'), D('d', 'number', 100, '출력 최대')],
  outs: [OUT('r', 'number', '결과')],
  expr(n, G) { G.helper('map', 'def map_range(x, a, b, c, d):\n    return (x - a) * (d - c) / (b - a) + c'); return `map_range(${['x', 'a', 'b', 'c', 'd'].map(p => G.expr(n, p)).join(', ')})`; },
});
def('constrain', {
  label: '범위 제한', cat: 'math', desc: 'x를 최소~최대 사이로 제한', ins: [D('x', 'number', 0, 'x'), D('lo', 'number', 0, '최소'), D('hi', 'number', 100, '최대')], outs: [OUT('r', 'number', '결과')],
  expr: (n, G) => `max(${G.expr(n, 'lo')}, min(${G.expr(n, 'hi')}, ${G.expr(n, 'x')}))`,
});
def('random', {
  label: '랜덤 정수', cat: 'math', desc: '최소~최대 사이 정수 (random.randint)', ins: [D('lo', 'number', 0, '최소'), D('hi', 'number', 100, '최대')], outs: [OUT('r', 'number', '결과')],
  expr(n, G) { G.imp('import random'); return `random.randint(int(${G.expr(n, 'lo')}), int(${G.expr(n, 'hi')}))`; },
});

// ================= 논리 =================
def('compare', {
  label: '비교', cat: 'logic', desc: 'A (비교) B → 참/거짓 (숫자·문자열)', ins: [D('a', 'any', 0, 'A'), D('b', 'any', 0, 'B')], outs: [OUT('r', 'bool', '결과')],
  props: [{ k: 'op', type: 'select', label: '비교', def: '>', opts: [['==', '='], ['!=', '≠'], ['<', '<'], ['<=', '≤'], ['>', '>'], ['>=', '≥']] }],
  expr: (n, G) => `${G.expr(n, 'a')} ${n.st.op || '>'} ${G.expr(n, 'b')}`,
});
def('logic', {
  label: '논리 연산', cat: 'logic', desc: 'A and/or B', ins: [D('a', 'bool', true, 'A'), D('b', 'bool', true, 'B')], outs: [OUT('r', 'bool', '결과')],
  props: [{ k: 'op', type: 'select', label: '연산', def: 'and', opts: [['and', '그리고(and)'], ['or', '또는(or)']] }],
  expr: (n, G) => `${G.expr(n, 'a')} ${n.st.op || 'and'} ${G.expr(n, 'b')}`,
});
def('not', { label: '부정 (not)', cat: 'logic', desc: '참↔거짓', ins: [D('a', 'bool', true, 'A')], outs: [OUT('r', 'bool', '결과')], expr: (n, G) => `not ${G.expr(n, 'a')}` });
def('select', {
  label: '조건 선택', cat: 'logic', desc: '조건이 참이면 A, 아니면 B', ins: [D('cond', 'bool', true, '조건'), D('a', 'any', 1, 'A'), D('b', 'any', 0, 'B')], outs: [OUT('r', 'any', '결과')],
  expr: (n, G) => `${G.expr(n, 'a')} if ${G.expr(n, 'cond')} else ${G.expr(n, 'b')}`,
});

// ================= 텍스트 / 출력 =================
def('print', { label: '출력 (print)', cat: 'text', desc: '시리얼 콘솔에 값을 출력합니다.', ins: [X(), D('value', 'any', 'Hello Pico!', '값')], outs: [X('out')], stmt: (n, G) => [`print(${G.expr(n, 'value')})`] });
def('join', {
  label: '문자열 결합', cat: 'text', desc: 'str(A) + str(B)', ins: [D('a', 'any', 'T=', 'A'), D('b', 'any', 0, 'B')], outs: [OUT('r', 'string', '결과')],
  expr: (n, G) => `str(${G.expr(n, 'a')}) + str(${G.expr(n, 'b')})`,
});
def('format', {
  label: '숫자 서식', cat: 'text', desc: '소수점 자릿수를 지정해 문자열로 변환', ins: [D('x', 'number', 0, 'x')], outs: [OUT('r', 'string', '결과')],
  props: [{ k: 'd', type: 'number', label: '소수 자리', def: 1 }],
  expr: (n, G) => `'{:.${Math.max(0, parseInt(n.st.d ?? 1) || 0)}f}'.format(${G.expr(n, 'x')})`,
});

// ================= GPIO =================
def('gpio_write', {
  label: '디지털 출력', cat: 'gpio', desc: '핀을 HIGH(1) / LOW(0)로 출력합니다.', ins: [X(), PIN(), D('value', 'bool', true, '값')], outs: [X('out')],
  stmt: (n, G) => { const p = G.pinVar(n, 'out'); return p ? [G.B.write(G, p, G.expr(n, 'value'))] : []; },
});
def('gpio_toggle', {
  label: '디지털 토글', cat: 'gpio', desc: '핀 출력을 반전합니다.', ins: [X(), PIN()], outs: [X('out')],
  stmt: (n, G) => { const p = G.pinVar(n, 'out'); return p ? [G.B.toggle(G, p)] : []; },
});
def('gpio_read', {
  label: '디지털 입력', cat: 'gpio', desc: '핀 상태(0/1)를 읽습니다.', ins: [PIN()], outs: [OUT('value', 'bool', '값')],
  props: [{ k: 'pull', type: 'select', label: '풀업', def: 'PULL_UP', opts: [['PULL_UP', '풀업'], ['PULL_DOWN', '풀다운'], ['NONE', '없음']] }],
  expr: (n, G) => { const p = G.pinVar(n, 'in', n.st.pull); return p ? G.B.read(p) : '0'; },
});
def('pwm_write', {
  label: 'PWM 출력', cat: 'gpio', desc: '듀티비(0~100%)와 주파수로 PWM을 출력합니다.', ins: [X(), PIN(), D('duty', 'number', 50, '듀티(%)'), D('freq', 'number', 1000, '주파수')], outs: [X('out')],
  stmt(n, G) {
    const p = G.pinVar(n, 'pwm');
    if (!p) return [];
    G.helper('pwm', G.B.h.pwm);
    return [`pwm_percent(${p}, ${G.expr(n, 'duty')}, ${G.expr(n, 'freq')})`];
  },
});
def('adc_read', {
  label: '아날로그 입력', cat: 'gpio', desc: '아날로그 핀 전압을 읽습니다 (Pico: GP26~28, 0~65535 / micro:bit: P0~P4·P10, 0~1023).', ins: [PIN()], outs: [OUT('value', 'number', '값')],
  props: [{ k: 'unit', type: 'select', label: '단위', def: 'raw', opts: [['raw', '원시값'], ['pct', '0~100%'], ['volt', '전압(V)']] }],
  expr(n, G) {
    const p = G.pinVar(n, 'adc');
    if (!p) return '0';
    return analogExpr(G, G.B.adcRead(p), n.st.unit);
  },
});
def('onboard_led', {
  label: '보드 LED', cat: 'gpio', boards: ['pico', 'esp32', 'rp2040zero', 'nanorp2040', 'nanoesp32', 'unor3', 'nano328'], desc: '보드 내장 LED (Pico: GP25 / ESP32: GPIO2 / RP2040-Zero: GP16 RGB LED를 흰색으로)', ins: [X(), D('value', 'bool', true, '켜기')], outs: [X('out')],
  stmt(n, G) {
    if (G.B.zero) { zeroBoardLed(G); return [`board_led(${G.expr(n, 'value')})`]; }
    G.setup('led_onboard', `led_onboard = Pin(${G.B.ledPin}, Pin.OUT)`); return [`led_onboard.value(${G.expr(n, 'value')})`];
  },
});
def('onboard_toggle', {
  label: '보드 LED 토글', cat: 'gpio', boards: ['pico', 'esp32', 'rp2040zero', 'nanorp2040', 'nanoesp32', 'unor3', 'nano328'], desc: '내장 LED 반전', ins: [X()], outs: [X('out')],
  stmt(n, G) {
    if (G.B.zero) { zeroBoardLed(G); return ['board_led(not _board_led_on)']; }
    G.setup('led_onboard', `led_onboard = Pin(${G.B.ledPin}, Pin.OUT)`); return [G.B.toggle(G, 'led_onboard')];
  },
});
def('board_rgb', {
  label: '보드 RGB LED', cat: 'gpio', boards: ['rp2040zero'], desc: 'RP2040-Zero 내장 WS2812 RGB LED(GP16) 색을 설정합니다 (0~255).', ins: [X(), D('r', 'number', 0, 'R'), D('g', 'number', 40, 'G'), D('b', 'number', 0, 'B')], outs: [X('out')],
  stmt(n, G) {
    zeroRgb(G);
    return [`board_rgb[0] = (int(${G.expr(n, 'r')}), int(${G.expr(n, 'g')}), int(${G.expr(n, 'b')}))`, 'board_rgb.write()'];
  },
});
def('bootsel', {
  label: 'BOOT 버튼 눌림?', cat: 'gpio', boards: ['pico', 'rp2040zero', 'nanorp2040'], desc: '보드의 BOOTSEL/BOOT 버튼 상태 (rp2.bootsel_button)', ins: [], outs: [OUT('p', 'bool', '눌림')],
  expr(n, G) { G.imp('import rp2'); return 'rp2.bootsel_button() == 1'; },
});
def('cpu_temp', {
  label: '내부 온도센서', cat: 'gpio', desc: '보드 내장 온도(°C) — Pico: ADC4 / micro:bit: temperature()', ins: [], outs: [OUT('t', 'number', '°C')],
  expr(n, G) {
    if (!G.B.pico) return 'temperature()';
    if (G.B.esp) { G.imp('import esp32'); return 'round((esp32.raw_temperature() - 32) / 1.8, 1)'; }
    G.setup('adc_temp', 'adc_temp = ADC(4)');
    G.helper('cpu_temp', 'def cpu_temp():\n    v = adc_temp.read_u16() * 3.3 / 65535\n    return round(27 - (v - 0.706) / 0.001721, 1)');
    return 'cpu_temp()';
  },
});

// ================= 모듈: 입출력 =================
def('m_led', {
  label: 'LED / 릴레이 켜기', cat: 'm_io', desc: 'LED 또는 릴레이 모듈을 켜고 끕니다.', ins: [X(), DEV(['led', 'relay']), D('on', 'bool', true, '켜기')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; const v = G.expr(n, 'on'); return [G.B.write(G, d.name, G.meta(d).inv ? `not ${v}` : v)]; },
});
def('m_led_toggle', {
  label: 'LED 토글', cat: 'm_io', desc: 'LED/릴레이 상태를 반전합니다.', ins: [X(), DEV(['led', 'relay'])], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [G.B.toggle(G, d.name)] : []; },
});
def('m_rgb', {
  label: 'RGB LED 색상', cat: 'm_io', desc: 'R, G, B (0~255)로 색을 설정합니다.', ins: [X(), DEV(['rgb']), D('r', 'number', 255, 'R'), D('g', 'number', 0, 'G'), D('b', 'number', 0, 'B')], outs: [X('out')],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    return ['r', 'g', 'b'].map(c => G.B.duty255(`${d.name}_${c}`, G.expr(n, c)));
  },
});
def('m_button', {
  label: '버튼 눌림?', cat: 'm_io', desc: '버튼/스위치가 눌려 있으면 참', ins: [DEV(['button', 'switch'], '버튼')], outs: [OUT('pressed', 'bool', '눌림')],
  expr(n, G) { const d = G.dev(n); if (!d) return 'False'; return `${G.B.read(d.name)} == ${G.meta(d).activeLow === false ? 1 : 0}`; },
});
def('m_analog', {
  label: '가변저항/조도 값', cat: 'm_io', desc: '아날로그 모듈 값을 읽습니다.', ins: [DEV(['pot', 'ldr'])], outs: [OUT('value', 'number', '값')],
  props: [{ k: 'unit', type: 'select', label: '단위', def: 'pct', opts: [['pct', '0~100%'], ['raw', '원시값'], ['volt', '전압(V)']] }],
  expr(n, G) {
    const d = G.dev(n); if (!d) return '0';
    return analogExpr(G, G.B.adcRead(d.name), n.st.unit || 'pct');
  },
});
def('m_joystick', {
  label: '조이스틱 읽기', cat: 'm_io', desc: 'X, Y (-100~100)와 버튼 상태', ins: [DEV(['joystick'])], outs: [OUT('x', 'number', 'X'), OUT('y', 'number', 'Y'), OUT('sw', 'bool', '버튼')],
  expr(n, G, port) {
    const d = G.dev(n); if (!d) return '0';
    if (port === 'sw') return `${G.B.read(d.name + '_sw')} == 0`;
    return `round(${G.B.adcRead(`${d.name}_${port}`)} * 200 / ${G.B.adcMax} - 100)`;
  },
});
def('m_buzzer', {
  label: '부저 소리', cat: 'm_io', desc: '주파수(Hz)로 지정 시간(ms) 동안 소리를 냅니다. 시간 0 = 계속', ins: [X(), DEV(['buzzer']), D('freq', 'number', 440, '주파수'), D('ms', 'number', 200, '시간(ms)')], outs: [X('out')],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    if (!G.B.pico) G.imp('import music');
    G.helper('tone', G.B.h.tone);
    return [`tone(${d.name}, ${G.expr(n, 'freq')}, ${G.expr(n, 'ms')})`];
  },
});
def('m_buzzer_off', {
  label: '부저 끄기', cat: 'm_io', desc: '부저 소리를 멈춥니다.', ins: [X(), DEV(['buzzer'])], outs: [X('out')],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    if (G.B.pico) return [`${d.name}.duty_u16(0)`];
    G.imp('import music');
    return [`music.stop(${d.name})`];
  },
});
def('m_servo', {
  label: '서보 각도', cat: 'm_io', desc: '서보 모터를 0~180°로 회전합니다.', ins: [X(), DEV(['servo']), D('angle', 'number', 90, '각도')], outs: [X('out')],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    G.helper('servo', G.B.h.servo);
    return [`servo_angle(${d.name}, ${G.expr(n, 'angle')})`];
  },
});
def('m_np_fill', {
  label: '네오픽셀 전체 색', cat: 'm_io', desc: '모든 LED를 같은 색으로 채우고 표시합니다.', ins: [X(), DEV(['neopixel']), D('r', 'number', 0, 'R'), D('g', 'number', 0, 'G'), D('b', 'number', 255, 'B')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; return [`${d.name}.fill((int(${G.expr(n, 'r')}), int(${G.expr(n, 'g')}), int(${G.expr(n, 'b')})))`, G.B.npShow(d.name)]; },
});
def('m_np_set', {
  label: '네오픽셀 한 개 색', cat: 'm_io', desc: 'i번째 LED 색을 설정합니다 ("표시" 필요).', ins: [X(), DEV(['neopixel']), D('i', 'number', 0, '번호'), D('r', 'number', 255, 'R'), D('g', 'number', 0, 'G'), D('b', 'number', 0, 'B')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; return [`${d.name}[int(${G.expr(n, 'i')}) % len(${d.name})] = (int(${G.expr(n, 'r')}), int(${G.expr(n, 'g')}), int(${G.expr(n, 'b')}))`]; },
});
def('m_np_rainbow', {
  label: '네오픽셀 무지개', cat: 'm_io', desc: '오프셋만큼 회전한 무지개 색을 표시합니다.', ins: [X(), DEV(['neopixel']), D('off', 'number', 0, '오프셋')], outs: [X('out')],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    G.helper('wheel', 'def wheel(p):\n    p = p % 255\n    if p < 85:\n        return (255 - p * 3, p * 3, 0)\n    if p < 170:\n        p -= 85\n        return (0, 255 - p * 3, p * 3)\n    p -= 170\n    return (p * 3, 0, 255 - p * 3)');
    return [`for _k in range(len(${d.name})):`, `    ${d.name}[_k] = wheel(int(_k * 255 / len(${d.name}) + ${G.expr(n, 'off')}))`, G.B.npShow(d.name)];
  },
});
def('m_np_show', {
  label: '네오픽셀 표시', cat: 'm_io', desc: '설정한 색을 LED에 전송합니다 (write).', ins: [X(), DEV(['neopixel'])], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [G.B.npShow(d.name)] : []; },
});

// ================= 모듈: 센서 =================
def('m_pir', {
  label: 'PIR 움직임?', cat: 'm_sensor', desc: '움직임이 감지되면 참', ins: [DEV(['pir'])], outs: [OUT('motion', 'bool', '감지')],
  expr(n, G) { const d = G.dev(n); return d ? `${G.B.read(d.name)} == 1` : 'False'; },
});
def('m_dht', {
  label: 'DHT 온습도', cat: 'm_sensor', boards: ['pico', 'esp32', 'rp2040zero', 'nanorp2040', 'nanoesp32', 'unor3', 'nano328'], desc: 'DHT11/22 온도(°C)와 습도(%) (2초 캐시)', ins: [DEV(['dht11', 'dht22'])], outs: [OUT('t', 'number', '온도'), OUT('h', 'number', '습도')],
  expr(n, G, port) {
    const d = G.dev(n); if (!d) return '0';
    G.helper('dht', "_dht_cache = {}\ndef dht_read(d):\n    now = time.ticks_ms()\n    c = _dht_cache.get(id(d))\n    if c is None or time.ticks_diff(now, c[0]) > 2000:\n        try:\n            d.measure()\n            c = (now, d.temperature(), d.humidity())\n        except OSError:\n            c = (now, c[1], c[2]) if c else (now, 0, 0)\n        _dht_cache[id(d)] = c\n    return c");
    return `dht_read(${d.name})[${port === 't' ? 1 : 2}]`;
  },
});
def('m_ds18', {
  label: 'DS18B20 온도', cat: 'm_sensor', boards: ['pico', 'esp32', 'rp2040zero', 'nanorp2040', 'nanoesp32', 'unor3', 'nano328'], desc: '1-Wire 온도(°C)', ins: [DEV(['ds18b20'])], outs: [OUT('t', 'number', '온도')],
  expr(n, G) {
    const d = G.dev(n); if (!d) return '0';
    G.helper('ds18', 'def ds_temp(d, roms):\n    if not roms:\n        return None\n    d.convert_temp()\n    time.sleep_ms(750)\n    return round(d.read_temp(roms[0]), 2)');
    return `ds_temp(${d.name}, ${d.name}_roms)`;
  },
});
def('m_sonar', {
  label: '초음파 거리(cm)', cat: 'm_sensor', desc: 'HC-SR04 거리 측정 (실패 시 -1)', ins: [DEV(['hcsr04'])], outs: [OUT('cm', 'number', '거리')],
  expr(n, G) {
    const d = G.dev(n); if (!d) return '0';
    G.imp('from machine import time_pulse_us');
    if (!G.B.pico) G.imp('import utime');
    G.helper('sonar', G.B.h.sonar);
    return `distance_cm(${d.name}_trig, ${d.name}_echo)`;
  },
});
def('m_aht', {
  label: 'AHT20 온습도', cat: 'm_sensor', desc: 'AHT20 온도(°C)와 습도(%)', ins: [DEV(['aht20'])], outs: [OUT('t', 'number', '온도'), OUT('h', 'number', '습도')],
  expr(n, G, port) { const d = G.dev(n); return d ? `round(${d.name}.${port === 't' ? 'temperature' : 'humidity'}(), 1)` : '0'; },
});
def('m_mpu', {
  label: 'MPU6050 읽기', cat: 'm_sensor', desc: '가속도(g)와 자이로(°/s)', ins: [DEV(['mpu6050'])],
  outs: [OUT('ax', 'number', 'AX'), OUT('ay', 'number', 'AY'), OUT('az', 'number', 'AZ'), OUT('gx', 'number', 'GX'), OUT('gy', 'number', 'GY'), OUT('gz', 'number', 'GZ')],
  expr(n, G, port) { const d = G.dev(n); if (!d) return '0'; return `${d.name}.${port[0] === 'a' ? 'accel' : 'gyro'}()[${'xyz'.indexOf(port[1])}]`; },
});
def('m_lux', {
  label: 'BH1750 조도(lx)', cat: 'm_sensor', desc: '조도 (lux)', ins: [DEV(['bh1750'])], outs: [OUT('lux', 'number', 'lux')],
  expr(n, G) { const d = G.dev(n); return d ? `${d.name}.lux()` : '0'; },
});
def('m_mcp', {
  label: 'MCP3008 읽기', cat: 'm_sensor', desc: '채널(0~7) 값 0~1023', ins: [DEV(['mcp3008']), D('ch', 'number', 0, '채널')], outs: [OUT('value', 'number', '값')],
  expr(n, G) { const d = G.dev(n); return d ? `${d.name}.read(int(${G.expr(n, 'ch')}))` : '0'; },
});

// ================= 모듈: 디스플레이 =================
def('m_oled_clear', {
  label: 'OLED 지우기', cat: 'm_disp', desc: '화면 버퍼를 지웁니다.', ins: [X(), DEV(['oled'])], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.fill(0)`] : []; },
});
def('m_oled_text', {
  label: 'OLED 글자', cat: 'm_disp', desc: '(x, y) 위치에 글자를 씁니다 (8x8 폰트).', ins: [X(), DEV(['oled']), D('text', 'any', 'Hello', '글자'), D('x', 'number', 0, 'x'), D('y', 'number', 0, 'y')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.text(str(${G.expr(n, 'text')}), int(${G.expr(n, 'x')}), int(${G.expr(n, 'y')}), 1)`] : []; },
});
def('m_oled_shape', {
  label: 'OLED 도형', cat: 'm_disp', desc: '사각형/선/점을 그립니다.', ins: [X(), DEV(['oled']), D('x', 'number', 0, 'x'), D('y', 'number', 0, 'y'), D('w', 'number', 20, 'w / x2'), D('h', 'number', 10, 'h / y2')], outs: [X('out')],
  props: [{ k: 'shape', type: 'select', label: '도형', def: 'rect', opts: [['rect', '사각형'], ['fill_rect', '채운 사각형'], ['line', '선'], ['pixel', '점']] }],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    const a = ['x', 'y', 'w', 'h'].map(p => `int(${G.expr(n, p)})`);
    const s = n.st.shape || 'rect';
    return [s === 'pixel' ? `${d.name}.pixel(${a[0]}, ${a[1]}, 1)` : `${d.name}.${s}(${a.join(', ')}, 1)`];
  },
});
def('m_oled_show', {
  label: 'OLED 표시', cat: 'm_disp', desc: '버퍼 내용을 화면에 전송합니다 (show).', ins: [X(), DEV(['oled'])], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.show()`] : []; },
});
def('m_lcd_print', {
  label: 'LCD 글자', cat: 'm_disp', desc: '(열, 행) 위치에 글자를 표시합니다.', ins: [X(), DEV(['lcd']), D('text', 'any', 'Hello', '글자'), D('col', 'number', 0, '열'), D('row', 'number', 0, '행')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.move_to(int(${G.expr(n, 'col')}), int(${G.expr(n, 'row')}))`, `${d.name}.putstr(str(${G.expr(n, 'text')}))`] : []; },
});
def('m_lcd_clear', {
  label: 'LCD 지우기', cat: 'm_disp', desc: '화면을 지웁니다.', ins: [X(), DEV(['lcd'])], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.clear()`] : []; },
});
def('m_lcd_bl', {
  label: 'LCD 백라이트', cat: 'm_disp', desc: '백라이트 켜기/끄기', ins: [X(), DEV(['lcd']), D('on', 'bool', true, '켜기')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; return [`${d.name}.backlight_on() if ${G.expr(n, 'on')} else ${d.name}.backlight_off()`]; },
});
def('m_mtx_text', {
  label: '매트릭스 글자', cat: 'm_disp', boards: ['pico', 'rp2040zero', 'nanorp2040', 'microbit', 'esp32', 'nanoesp32'], desc: '8x8 매트릭스에 한 글자를 표시합니다.', ins: [X(), DEV(['max7219']), D('text', 'any', 'A', '글자')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.fill(0)`, `${d.name}.text(str(${G.expr(n, 'text')})[:1], 0, 0, 1)`, `${d.name}.show()`] : []; },
});
def('m_mtx_icon', {
  label: '매트릭스 아이콘', cat: 'm_disp', desc: '미리 정의된 아이콘을 표시합니다.', ins: [X(), DEV(['max7219'])], outs: [X('out')],
  props: [{ k: 'icon', type: 'select', label: '아이콘', def: 'heart', opts: [['heart', '하트'], ['smile', '웃음'], ['sad', '슬픔'], ['up', '위 화살표'], ['down', '아래 화살표'], ['x', 'X'], ['check', '체크']] }],
  stmt(n, G) {
    const d = G.dev(n); if (!d) return [];
    const I = { heart: '0066FFFFFF7E3C18', smile: '3C4281A58199423C', sad: '3C4281A599A5423C', up: '183C7EFF18181818', down: '18181818FF7E3C18', x: '8142241818244281', check: '0001030706CC7830' };
    G.helper('mtx_icon', 'def mtx_icon(m, hexrows):\n    m.fill(0)\n    for y in range(8):\n        row = int(hexrows[y * 2:y * 2 + 2], 16)\n        for x in range(8):\n            if row & (0x80 >> x):\n                m.pixel(x, y, 1)\n    m.show()');
    return [`mtx_icon(${d.name}, '${I[n.st.icon || 'heart']}')`];
  },
});
def('m_mtx_pixel', {
  label: '매트릭스 점', cat: 'm_disp', desc: '(x, y) 점을 켜거나 끕니다 ("표시" 필요).', ins: [X(), DEV(['max7219']), D('x', 'number', 0, 'x'), D('y', 'number', 0, 'y'), D('on', 'bool', true, '켜기')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.pixel(int(${G.expr(n, 'x')}), int(${G.expr(n, 'y')}), 1 if ${G.expr(n, 'on')} else 0)`] : []; },
});
def('m_mtx_show', {
  label: '매트릭스 표시/지우기', cat: 'm_disp', desc: '버퍼를 표시하거나 지웁니다.', ins: [X(), DEV(['max7219'])], outs: [X('out')],
  props: [{ k: 'act', type: 'select', label: '동작', def: 'show', opts: [['show', '표시'], ['clear', '지우기']] }],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; return n.st.act === 'clear' ? [`${d.name}.fill(0)`, `${d.name}.show()`] : [`${d.name}.show()`]; },
});

// ================= 모듈: 통신/시계 =================
def('m_gps', {
  label: 'GPS 읽기', cat: 'm_comm', desc: 'NMEA 데이터를 해석해 위치를 얻습니다.', ins: [DEV(['gps'])],
  outs: [OUT('lat', 'number', '위도'), OUT('lon', 'number', '경도'), OUT('sats', 'number', '위성수'), OUT('fix', 'bool', '수신'), OUT('time', 'string', 'UTC')],
  expr(n, G, port) { const d = G.dev(n); return d ? `${d.name}.poll().${port}` : '0'; },
});
def('m_uart_send', {
  label: '블루투스/UART 보내기', cat: 'm_comm', desc: '문자열을 전송합니다 (줄바꿈 포함).', ins: [X(), DEV(['hc05']), D('text', 'any', 'Hello', '내용')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); return d ? [`${d.name}.write(str(${G.expr(n, 'text')}) + '\\r\\n')`] : []; },
});
def('m_uart_recv', {
  label: '블루투스/UART 받기', cat: 'm_comm', desc: '수신된 한 줄(없으면 빈 문자열)과 수신 여부', ins: [DEV(['hc05'])], outs: [OUT('line', 'string', '한 줄'), OUT('has', 'bool', '수신 있음')],
  expr(n, G, port) {
    const d = G.dev(n); if (!d) return "''";
    if (port === 'has') return `${d.name}.any() > 0`;
    G.helper('readline', "def uart_line(u):\n    if not u.any():\n        return ''\n    s = u.readline()\n    if not s:\n        return ''\n    try:\n        return s.decode().strip()\n    except Exception:\n        return ''");
    return `uart_line(${d.name})`;
  },
});
def('m_rtc', {
  label: 'RTC 시간 읽기', cat: 'm_comm', desc: 'DS3231 현재 시각', ins: [DEV(['ds3231'])],
  outs: [OUT('text', 'string', 'HH:MM:SS'), OUT('date', 'string', 'YYYY-MM-DD'), OUT('h', 'number', '시'), OUT('m', 'number', '분'), OUT('s', 'number', '초')],
  expr(n, G, port) {
    const d = G.dev(n); if (!d) return '0';
    if (port === 'text') { G.helper('rtc_text', "def rtc_text(r):\n    t = r.datetime()\n    return '{:02d}:{:02d}:{:02d}'.format(t[4], t[5], t[6])"); return `rtc_text(${d.name})`; }
    if (port === 'date') { G.helper('rtc_date', "def rtc_date(r):\n    t = r.datetime()\n    return '{:04d}-{:02d}-{:02d}'.format(t[0], t[1], t[2])"); return `rtc_date(${d.name})`; }
    return `${d.name}.datetime()[${{ h: 4, m: 5, s: 6 }[port]}]`;
  },
});
def('m_rtc_set', {
  label: 'RTC 시간 설정', cat: 'm_comm', desc: 'DS3231 시각을 설정합니다.', ins: [X(), DEV(['ds3231']), D('y', 'number', 2026, '년'), D('mo', 'number', 1, '월'), D('d', 'number', 1, '일'), D('h', 'number', 12, '시'), D('mi', 'number', 0, '분'), D('s', 'number', 0, '초')], outs: [X('out')],
  stmt(n, G) { const d = G.dev(n); if (!d) return []; const e = p => `int(${G.expr(n, p)})`; return [`${d.name}.datetime((${e('y')}, ${e('mo')}, ${e('d')}, 1, ${e('h')}, ${e('mi')}, ${e('s')}))`]; },
});

// ================= micro:bit 전용 =================
const MB_IMAGES = ['HEART', 'HEART_SMALL', 'HAPPY', 'SMILE', 'SAD', 'CONFUSED', 'ANGRY', 'ASLEEP', 'SURPRISED', 'SILLY', 'FABULOUS', 'MEH', 'YES', 'NO',
  'ARROW_N', 'ARROW_E', 'ARROW_S', 'ARROW_W', 'SQUARE', 'SQUARE_SMALL', 'DIAMOND', 'TRIANGLE', 'CHESSBOARD', 'SKULL', 'GHOST', 'DUCK', 'TSHIRT',
  'PACMAN', 'TARGET', 'HOUSE', 'MUSIC_QUAVER', 'SNAKE', 'RABBIT', 'BUTTERFLY', 'SWORD', 'UMBRELLA'];
const MB_MELODIES = ['DADADADUM', 'BIRTHDAY', 'ENTERTAINER', 'ODE', 'POWER_UP', 'POWER_DOWN', 'BA_DING', 'JUMP_UP', 'JUMP_DOWN', 'WAWAWAWAA', 'PRELUDE', 'NYAN', 'RINGTONE', 'FUNK', 'BLUES', 'WEDDING', 'FUNERAL', 'PUNCHLINE', 'PYTHON', 'BADDY', 'CHASE'];
const MB = ['microbit'];
def('ev_mb_button', {
  label: '버튼 A/B·로고 눌림', cat: 'mb', boards: MB, desc: 'micro:bit 버튼 또는 터치 로고를 누르면 실행합니다 (메인 루프에서 확인).', ins: [], outs: [X('out', '실행')],
  props: [{ k: 'btn', type: 'select', label: '버튼', def: 'a', opts: [['a', '버튼 A'], ['b', '버튼 B'], ['logo', '터치 로고']] }],
});
def('ev_mb_gesture', {
  label: '제스처 감지', cat: 'mb', boards: MB, desc: '흔들기/기울이기 등 제스처가 감지되면 실행합니다.', ins: [], outs: [X('out', '실행')],
  props: [{ k: 'g', type: 'select', label: '제스처', def: 'shake', opts: [['shake', '흔들기'], ['left', '왼쪽 기울임'], ['right', '오른쪽 기울임'], ['up', '로고 위로'], ['down', '로고 아래로'], ['face up', '화면 위'], ['face down', '화면 아래']] }],
});
def('mb_show', { label: 'LED 화면 표시', cat: 'mb', boards: MB, desc: '숫자/글자를 5x5 LED에 표시합니다 (display.show).', ins: [X(), D('value', 'any', 'A', '값')], outs: [X('out')], stmt: (n, G) => [`display.show(${G.expr(n, 'value')})`] });
def('mb_scroll', { label: 'LED 화면 스크롤', cat: 'mb', boards: MB, desc: '문자열을 흘려서 표시합니다 (display.scroll).', ins: [X(), D('text', 'any', 'Hello!', '글자')], outs: [X('out')], stmt: (n, G) => [`display.scroll(str(${G.expr(n, 'text')}))`] });
def('mb_image', {
  label: 'LED 아이콘', cat: 'mb', boards: MB, desc: '내장 이미지를 표시합니다 (Image.HEART 등).', ins: [X()], outs: [X('out')],
  props: [{ k: 'img', type: 'select', label: '아이콘', def: 'HEART', opts: MB_IMAGES.map(x => [x, x]) }],
  stmt: n => [`display.show(Image.${n.st.img || 'HEART'})`],
});
def('mb_plot', {
  label: 'LED 점 켜기', cat: 'mb', boards: MB, desc: '(x, y) LED 밝기(0~9)를 설정합니다.', ins: [X(), D('x', 'number', 2, 'x'), D('y', 'number', 2, 'y'), D('b', 'number', 9, '밝기')], outs: [X('out')],
  stmt: (n, G) => [`display.set_pixel(max(0, min(4, int(${G.expr(n, 'x')}))), max(0, min(4, int(${G.expr(n, 'y')}))), max(0, min(9, int(${G.expr(n, 'b')}))))`],
});
def('mb_clear', { label: 'LED 화면 지우기', cat: 'mb', boards: MB, desc: 'display.clear()', ins: [X()], outs: [X('out')], stmt: () => ['display.clear()'] });
def('mb_button', {
  label: '버튼 눌림?', cat: 'mb', boards: MB, desc: '버튼 A/B/로고가 눌려 있으면 참', ins: [], outs: [OUT('p', 'bool', '눌림')],
  props: [{ k: 'btn', type: 'select', label: '버튼', def: 'a', opts: [['a', '버튼 A'], ['b', '버튼 B'], ['logo', '터치 로고']] }],
  expr: n => n.st.btn === 'logo' ? 'pin_logo.is_touched()' : `button_${n.st.btn || 'a'}.is_pressed()`,
});
def('mb_accel', {
  label: '가속도 센서', cat: 'mb', boards: MB, desc: 'X, Y, Z (mg, 약 ±2048)와 세기', ins: [],
  outs: [OUT('x', 'number', 'X'), OUT('y', 'number', 'Y'), OUT('z', 'number', 'Z'), OUT('s', 'number', '세기')],
  expr: (n, G, port) => port === 's' ? 'accelerometer.get_strength()' : `accelerometer.get_${port}()`,
});
def('mb_sensors', {
  label: 'micro:bit 센서', cat: 'mb', boards: MB, desc: '온도(°C), 빛(0~255), 소리(0~255), 나침반(°)', ins: [],
  outs: [OUT('t', 'number', '온도'), OUT('l', 'number', '빛'), OUT('s', 'number', '소리'), OUT('h', 'number', '나침반')],
  expr: (n, G, port) => ({ t: 'temperature()', l: 'display.read_light_level()', s: 'microphone.sound_level()', h: 'compass.heading()' })[port],
});
def('mb_tone', {
  label: '스피커 음 재생', cat: 'mb', boards: MB, desc: '내장 스피커(와 P0)로 주파수(Hz)를 재생합니다.', ins: [X(), D('freq', 'number', 440, '주파수'), D('ms', 'number', 300, '시간(ms)')], outs: [X('out')],
  stmt(n, G) { G.imp('import music'); return [`music.pitch(int(${G.expr(n, 'freq')}), int(${G.expr(n, 'ms')}))`]; },
});
def('mb_melody', {
  label: '멜로디 재생', cat: 'mb', boards: MB, desc: '내장 멜로디를 재생합니다 (music.play).', ins: [X()], outs: [X('out')],
  props: [
    { k: 'm', type: 'select', label: '멜로디', def: 'BA_DING', opts: MB_MELODIES.map(x => [x, x]) },
    { k: 'wait', type: 'select', label: '대기', def: 'True', opts: [['True', '끝날 때까지'], ['False', '백그라운드']] },
  ],
  stmt(n, G) { G.imp('import music'); return [`music.play(music.${n.st.m || 'BA_DING'}, wait=${n.st.wait === 'False' ? 'False' : 'True'})`]; },
});

// ================= ESP32 전용 =================
const ESP = ['esp32', 'nanoesp32'];
def('esp_wifi', {
  label: 'WiFi 연결', cat: 'esp', boards: ESP, desc: '공유기(AP)에 접속합니다 (network.WLAN). 시뮬레이터에서는 가상으로 연결됩니다.',
  ins: [X(), D('ssid', 'string', 'MyWiFi', 'SSID'), D('pw', 'string', 'password', '비밀번호')], outs: [X('out')],
  stmt(n, G) {
    G.imp('import network');
    G.helper('wifi', "def wifi_connect(ssid, password, timeout_ms=10000):\n    wlan = network.WLAN(network.STA_IF)\n    wlan.active(True)\n    if not wlan.isconnected():\n        wlan.connect(ssid, password)\n        t0 = time.ticks_ms()\n        while not wlan.isconnected() and time.ticks_diff(time.ticks_ms(), t0) < timeout_ms:\n            time.sleep_ms(100)\n    print('WiFi', 'connected' if wlan.isconnected() else 'failed', wlan.ifconfig()[0])\n    return wlan.isconnected()");
    return [`wifi_connect(${G.expr(n, 'ssid')}, ${G.expr(n, 'pw')})`];
  },
});
def('esp_wifi_info', {
  label: 'WiFi 상태', cat: 'esp', boards: ESP, desc: '연결 여부와 IP 주소', ins: [], outs: [OUT('ok', 'bool', '연결됨'), OUT('ip', 'string', 'IP')],
  expr(n, G, port) { G.imp('import network'); return port === 'ok' ? 'network.WLAN(network.STA_IF).isconnected()' : 'network.WLAN(network.STA_IF).ifconfig()[0]'; },
});
def('esp_touch', {
  label: '터치 센서', cat: 'esp', boards: ESP, desc: '정전식 터치 값 (터치하면 값이 작아짐, TouchPad)', ins: [PIN()], outs: [OUT('v', 'number', '값'), OUT('t', 'bool', '터치됨')],
  expr(n, G, port) {
    const g = G.pin(n);
    if (g == null) return '0';
    const touchOk = G.B.nano ? (g >= 1 && g <= 14) : ESP_TOUCH.includes(g);
    if (!touchOk) { G.warn(n, G.B.nano ? `GPIO${g}는 터치 핀이 아닙니다 (Nano ESP32: A0~A7)` : `GPIO${g}는 터치 핀이 아닙니다 (${ESP_TOUCH.join(', ')})`); return '0'; }
    G.imp('from machine import TouchPad');
    G.setup('touch' + g, `touch${g} = TouchPad(Pin(${g}))`);
    return port === 't' ? `touch${g}.read() < 300` : `touch${g}.read()`;
  },
});

// RP2040-Zero 내장 WS2812 (GP16)
function zeroRgb(G) {
  G.imp('import neopixel');
  G.setup('board_rgb', 'board_rgb = neopixel.NeoPixel(Pin(16), 1)  # 내장 RGB LED');
}
function zeroBoardLed(G) {
  zeroRgb(G);
  G.helper('board_led', '_board_led_on = False\n\ndef board_led(on):\n    global _board_led_on\n    _board_led_on = bool(on)\n    board_rgb[0] = (40, 40, 40) if on else (0, 0, 0)\n    board_rgb.write()');
}

function analogExpr(G, raw, unit) {
  const mx = G.B.adcMax;
  return unit === 'pct' ? `round(${raw} * 100 / ${mx})` : unit === 'volt' ? `round(${raw} * 3.3 / ${mx}, 2)` : raw;
}

// ================= 리터럴 도우미 =================
function numLit(v) { const x = Number(v); return Number.isFinite(x) ? String(x) : '0'; }
function pyStr(s) { return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') + "'"; }
function literal(t, v) {
  if (t === 'number') return numLit(v);
  if (t === 'bool') return v === false || v === 'False' || v === 0 || v === '0' ? 'False' : 'True';
  if (t === 'string') return pyStr(v ?? '');
  if (v === true || v === false) return v ? 'True' : 'False';
  if (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v)))) return numLit(v);
  return pyStr(v ?? '');
}
const pyIdent = s => { let x = String(s || '').replace(/[^A-Za-z0-9_]/g, '_'); if (!x || /^\d/.test(x)) x = 'v_' + x; return x; };

// ================= 보드별 코드 방언 =================
const DIALECTS = {
  pico: {
    pico: true,
    header: ['from machine import Pin, PWM, ADC, I2C, SoftI2C, SPI, SoftSPI, UART, Timer', 'import time'],
    out: g => `Pin(${g}, Pin.OUT)`,
    inp: (name, g, pull, cm) => [`${name} = Pin(${g}, Pin.IN${pull && pull !== 'NONE' ? ', Pin.' + pull : ''})${cm ? '  # ' + cm : ''}`],
    adc: g => `ADC(Pin(${g}))`,
    adcOk: g => HW.adcChannel(g) != null,
    adcHint: g => `GP${g}는 ADC를 지원하지 않습니다 (GP26~28 사용)`,
    adcRead: v => `${v}.read_u16()`, adcMax: 65535,
    pwm: g => `PWM(Pin(${g}))`,
    pwmInit: v => [`${v}.freq(1000)`], pwmOff: v => [`${v}.duty_u16(0)`], servoInit: v => [`${v}.freq(50)`],
    pinObj: (C, g) => `Pin(${g}, Pin.OUT)`,
    np: (g, n) => `neopixel.NeoPixel(Pin(${g}), ${n})`, npShow: v => `${v}.write()`,
    write: (G, v, x) => `${v}.value(${x})`,
    read: v => `${v}.value()`,
    toggle: (G, v) => `${v}.toggle()`,
    sleep: x => `time.sleep_ms(${x})`, ticks: 'time.ticks_ms()', diff: (a, b) => `time.ticks_diff(${a}, ${b})`,
    duty255: (v, x) => `${v}.duty_u16(int(max(0, min(255, ${x})) * 257))`,
    h: {
      pwm: 'def pwm_percent(p, duty, freq):\n    p.freq(int(freq))\n    p.duty_u16(int(max(0, min(100, duty)) * 65535 / 100))',
      servo: 'def servo_angle(s, angle):\n    angle = max(0, min(180, angle))\n    s.duty_ns(int(500000 + angle * 2000000 / 180))',
      tone: 'def tone(b, freq, ms):\n    b.freq(int(freq))\n    b.duty_u16(32768)\n    if ms > 0:\n        time.sleep_ms(int(ms))\n        b.duty_u16(0)',
      sonar: 'def distance_cm(trig, echo):\n    trig.value(0)\n    time.sleep_us(2)\n    trig.value(1)\n    time.sleep_us(10)\n    trig.value(0)\n    t = time_pulse_us(echo, 1, 30000)\n    if t < 0:\n        return -1\n    return round(t / 58.3, 1)',
    },
  },
  microbit: {
    pico: false,
    header: ['from microbit import *'],
    out: g => `pin${g}`,
    inp: (name, g, pull, cm) => [`${name} = pin${g}${cm ? '  # ' + cm : ''}`, `${name}.set_pull(${name}.${!pull || pull === 'NONE' ? 'NO_PULL' : pull})`],
    adc: g => `pin${g}`,
    adcOk: g => [0, 1, 2, 3, 4, 10].includes(g),
    adcHint: g => `P${g}는 아날로그 입력을 지원하지 않습니다 (P0, P1, P2, P3, P4, P10 사용)`,
    adcRead: v => `${v}.read_analog()`, adcMax: 1023,
    pwm: g => `pin${g}`,
    pwmInit: () => [], pwmOff: v => [`${v}.write_digital(0)`], servoInit: v => [`${v}.set_analog_period(20)`],
    pinObj: (C, g) => { C.lib('mbcompat', 'from mbcompat import MbPin'); return `MbPin(pin${g})`; },
    np: (g, n) => `neopixel.NeoPixel(pin${g}, ${n})`, npShow: v => `${v}.show()`,
    write(G, v, x) {
      G.helper('pin_write', '_pin_state = {}\n\ndef pin_write(p, v):\n    v = 1 if v else 0\n    _pin_state[id(p)] = v\n    p.write_digital(v)');
      return `pin_write(${v}, ${x})`;
    },
    read: v => `${v}.read_digital()`,
    toggle(G, v) {
      DIALECTS.microbit.write(G, v, 0);
      G.helper('pin_toggle', 'def pin_toggle(p):\n    pin_write(p, not _pin_state.get(id(p), 0))');
      return `pin_toggle(${v})`;
    },
    sleep: x => `sleep(${x})`, ticks: 'running_time()', diff: (a, b) => `(${a} - ${b})`,
    duty255: (v, x) => `${v}.write_analog(int(max(0, min(255, ${x})) * 1023 / 255))`,
    h: {
      pwm: 'def pwm_percent(p, duty, freq):\n    p.set_analog_period_microseconds(int(1000000 / max(1, freq)))\n    p.write_analog(int(max(0, min(100, duty)) * 1023 / 100))',
      servo: 'def servo_angle(s, angle):\n    angle = max(0, min(180, angle))\n    s.write_analog(int(25.6 + angle * 102.4 / 180))',
      tone: 'def tone(b, freq, ms):\n    music.pitch(int(freq), int(ms) if ms > 0 else -1, pin=b)',
      sonar: 'def distance_cm(trig, echo):\n    trig.write_digital(0)\n    utime.sleep_us(2)\n    trig.write_digital(1)\n    utime.sleep_us(10)\n    trig.write_digital(0)\n    t = time_pulse_us(echo, 1, 30000)\n    if t < 0:\n        return -1\n    return round(t / 58.3, 1)',
    },
  },
};

// ESP32: machine 모듈(Pico와 동일 API) + 버스 핀 자유 배정, ADC 감쇠, 입력 전용 핀
DIALECTS.esp32 = {
  ...DIALECTS.pico,
  esp: true,
  ledPin: 2,
  out(g) { if (g >= 34) this.warnPin(g, `GPIO${g}는 입력 전용 핀이라 출력으로 쓸 수 없습니다`); return `Pin(${g}, Pin.OUT)`; },
  inp(name, g, pull, cm) {
    if (g >= 34 && pull && pull !== 'NONE') { this.warnPin(g, `GPIO${g}에는 내부 풀업/풀다운이 없습니다 (외부 저항 필요)`); pull = 'NONE'; }
    return DIALECTS.pico.inp(name, g, pull, cm);
  },
  adc: g => `ADC(Pin(${g}), atten=ADC.ATTN_11DB)`,
  adcOk: g => ESP_ADC.includes(g),
  adcHint: g => `GPIO${g}는 ADC를 지원하지 않습니다 (ADC1: GPIO32~39 권장, ADC2는 WiFi 사용 중 동작 안 함)`,
  pwm(g) { if (g >= 34) this.warnPin(g, `GPIO${g}는 입력 전용이라 PWM 출력이 안 됩니다`); return `PWM(Pin(${g}))`; },
  toggle: (G, v) => `${v}.value(not ${v}.value())`,
};
DIALECTS.pico.ledPin = "'LED'";
// RP2040-Zero: Pico와 같은 RP2040 MicroPython (핀 배치/내장 LED만 다름)
DIALECTS.rp2040zero = { ...DIALECTS.pico, zero: true };
// 구형 Arduino(ATmega328P)는 MicroPython이 없으므로, 아래 방언은 "시뮬레이터 전용" 파이썬 코드에만 사용합니다.
// 사용자에게 보여주는 코드는 js/arduino.js 가 Arduino C++로 생성합니다.
const AVR_SIM_DIALECT = {
  ...DIALECTS.esp32,
  esp: true, nano: true, cpp: true, ledPin: 13,
  out: g => `Pin(${g}, Pin.OUT)`,
  pwm: g => `PWM(Pin(${g}))`,
  inp: (name, g, pull, cm) => DIALECTS.pico.inp(name, g, pull, cm),
  adc: g => `ADC(Pin(${g}))`,
  adcOk: g => g >= 14 && g <= 21,
  adcHint: g => `아날로그 입력은 A0~A7 핀만 가능합니다`,
};
DIALECTS.unor3 = { ...AVR_SIM_DIALECT };
DIALECTS.nano328 = { ...AVR_SIM_DIALECT };
// Arduino Nano RP2040 Connect: RP2040 포트 + D13(GPIO6) 내장 LED
DIALECTS.nanorp2040 = { ...DIALECTS.pico, ledPin: 6, nano: true };
// Arduino Nano ESP32: ESP32-S3 (입력 전용 핀 없음, ADC1/2 = GPIO1~20)
DIALECTS.nanoesp32 = {
  ...DIALECTS.esp32,
  nano: true,
  ledPin: 48,
  out: g => `Pin(${g}, Pin.OUT)`,
  pwm: g => `PWM(Pin(${g}))`,
  inp: (name, g, pull, cm) => DIALECTS.pico.inp(name, g, pull, cm),
  adcOk: g => g >= 1 && g <= 20,
  adcHint: g => `GPIO${g}는 ADC를 지원하지 않습니다 (Nano ESP32는 A0~A7 = GPIO1~14 사용)`,
};

// ================= 코드 생성기 =================
function generateCode(graph, sim) {
  sim.invalidate();
  sim.rebuild();
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const boardNode = graph.nodes.find(n => BOARDS[n.type]);
  const btype = boardNode ? boardNode.type : 'pico';
  const B = Object.create(DIALECTS[btype]);
  B.warnPin = (g, msg) => warn(null, msg);
  const bdef = BOARDS[btype];
  const into = new Map(), from = new Map();
  for (const w of graph.wires) {
    into.set(w.b, w.a);
    if (!from.has(w.a)) from.set(w.a, []);
    from.get(w.a).push(w.b);
  }
  const warnings = [];
  const warn = (node, msg) => warnings.push({ node: node && node.id, msg: (node ? `[${node.name || NODES[node.type]?.label || node.type}] ` : '') + msg });
  const imports = new Set(), libs = new Map(), setup = [], setupKeys = new Set(), helpers = new Map(), vars = new Set();
  const metas = new Map();
  const usedPins = new Map();   // gpio -> 사용한 노드
  const boardOk = (n, d) => !d.boards || d.boards.includes(btype);

  // --- 회로 → 설정 코드 ---
  const netGpio = term => { const i = sim.netIndex(term); if (i < 0) return null; const g = sim.nets[i].gpios; return g.length ? g[0] : null; };
  const netKind = term => {
    const i = sim.netIndex(term); if (i < 0) return null;
    for (const p of sim.nets[i].pico) {
      if (p.type === 'gnd') return 'gnd';
      if (p.type === 'power') return '3v3';
      if (p.type === 'power5') return '5v';
    }
    return null;
  };
  const buses = new Map(), busLines = [];
  const devNodes = graph.nodes.filter(n => DEVICES[n.type]);
  const catOrder = DEV_CATS.map(c => c[0]);
  devNodes.sort((a, b) => catOrder.indexOf(DEVICES[a.type].cat) - catOrder.indexOf(DEVICES[b.type].cat));
  for (const n of devNodes) {
    const d = DEVICES[n.type];
    const meta = {};
    metas.set(n.id, meta);
    const T = p => n.id + ':' + p;
    const C = {
      B, meta,
      gpio: p => { const g = netGpio(T(p)); if (g != null) usedPins.set(g, n); return g; },
      kind: p => netKind(T(p)),
      warn: m => { warn(n, m); return []; },
      imp: s => imports.add(s),
      lib: (name, imp) => { libs.set(name, true); imports.add(imp); },
      i2c() {
        const sda = C.gpio('SDA'), scl = C.gpio('SCL');
        if (sda == null || scl == null) { C.warn('SDA/SCL 핀을 GPIO에 연결하세요'); return null; }
        const key = `i2c:${sda}:${scl}`;
        if (buses.has(key)) return buses.get(key);
        let name;
        if (!B.pico) {
          if ([...buses.keys()].some(k => k.startsWith('i2c:'))) { C.warn('micro:bit는 외부 I2C 버스가 하나뿐입니다. 모든 I2C 모듈을 같은 핀(P19/P20)에 연결하세요'); return null; }
          if (sda !== 20 || scl !== 19) C.warn('micro:bit 표준 I2C 핀은 SDA=P20, SCL=P19 입니다');
          C.lib('mbcompat', 'from mbcompat import MbI2C');
          name = 'i2c_ext';
          busLines.push(`${name} = MbI2C(sda=pin${sda}, scl=pin${scl})`);
        } else if (B.esp) {
          const used = [...buses.values()].filter(v => /^i2c\d$/.test(v)).length;
          if (used < 2) { name = 'i2c' + used; busLines.push(`${name} = I2C(${used}, scl=Pin(${scl}), sda=Pin(${sda}), freq=400000)`); }
          else { name = `i2c_gp${sda}_${scl}`; busLines.push(`${name} = SoftI2C(scl=Pin(${scl}), sda=Pin(${sda}), freq=100000)`); }
          if (!B.nano && (sda >= 34 || scl >= 34)) C.warn('GPIO34~39는 입력 전용이라 I2C에 쓸 수 없습니다');
        } else {
          const hw = HW.i2cBus(sda, scl);
          if (hw != null && ![...buses.values()].includes('i2c' + hw)) {
            name = 'i2c' + hw;
            busLines.push(`${name} = I2C(${hw}, sda=Pin(${sda}), scl=Pin(${scl}), freq=400000)`);
          } else {
            name = `i2c_gp${sda}_${scl}`;
            busLines.push(`${name} = SoftI2C(sda=Pin(${sda}), scl=Pin(${scl}), freq=100000)  # 하드웨어 I2C 핀 조합이 아님`);
          }
        }
        buses.set(key, name);
        return name;
      },
      spi() {
        const s = d.spi;
        const sck = C.gpio(s.sck), mosi = C.gpio(s.mosi), miso = s.miso ? C.gpio(s.miso) : null;
        if (sck == null || mosi == null) { C.warn(`${s.sck}/${s.mosi} 핀을 GPIO에 연결하세요`); return null; }
        const key = `spi:${sck}:${mosi}:${miso}`;
        if (buses.has(key)) return buses.get(key);
        let name;
        if (!B.pico) {
          if ([...buses.keys()].some(k => k.startsWith('spi:'))) { C.warn('micro:bit는 SPI 버스가 하나뿐입니다. SPI 모듈을 같은 핀에 연결하세요'); return null; }
          C.lib('mbcompat', 'from mbcompat import MbSPI');
          name = 'spi_ext';
          busLines.push(`${name} = MbSPI(sck=pin${sck}, mosi=pin${mosi}, miso=pin${miso != null ? miso : 14})`);
        } else if (B.esp) {
          const used = [...buses.values()].filter(v => /^spi\d$/.test(v)).length;
          const misoArg = miso != null ? `, miso=Pin(${miso})` : '';
          if (used >= 2) { C.warn('ESP32 하드웨어 SPI는 2개(VSPI/HSPI)까지입니다'); return null; }
          const id = used === 0 ? 2 : 1;
          name = 'spi' + id;
          busLines.push(`${name} = SPI(${id}, baudrate=1000000, sck=Pin(${sck}), mosi=Pin(${mosi})${misoArg})  # ${id === 2 ? 'VSPI' : 'HSPI'}`);
        } else {
          const hw = HW.spiBus(sck, mosi, miso);
          const misoArg = miso != null ? `, miso=Pin(${miso})` : '';
          if (hw != null && ![...buses.values()].includes('spi' + hw)) {
            name = 'spi' + hw;
            busLines.push(`${name} = SPI(${hw}, baudrate=1000000, sck=Pin(${sck}), mosi=Pin(${mosi})${misoArg})`);
          } else {
            name = `spi_gp${sck}`;
            busLines.push(`${name} = SoftSPI(baudrate=500000, sck=Pin(${sck}), mosi=Pin(${mosi})${misoArg || `, miso=Pin(${sck === 28 ? 27 : 28})`})  # 하드웨어 SPI 핀 조합이 아님`);
          }
        }
        buses.set(key, name);
        return name;
      },
      uart(baud) {
        const u = d.uart;
        const rx = C.gpio(u.tx), tx = C.gpio(u.rx);
        if (rx == null && tx == null) { C.warn(`${u.tx}→보드 RX, ${u.rx}→보드 TX 로 연결하세요`); return null; }
        if (!B.pico) {
          if (buses.has('uart')) { C.warn('micro:bit는 UART가 하나뿐입니다'); return null; }
          buses.set('uart', 'uart');
          const args = [tx != null ? `tx=pin${tx}` : '', rx != null ? `rx=pin${rx}` : ''].filter(Boolean).join(', ');
          busLines.push(`uart.init(baudrate=${baud}, ${args})  # 주의: 이후 print()는 USB로 출력되지 않습니다`);
          C.warn('micro:bit에서 uart.init()을 하면 USB 시리얼(print/REPL)이 해당 핀으로 넘어갑니다');
          return 'uart';
        }
        let bus;
        if (B.esp) {
          if (tx != null && tx >= 34) C.warn(`GPIO${tx}는 입력 전용이라 TX로 쓸 수 없습니다`);
          const used = [...buses.keys()].filter(k => /^uart\d$/.test(k)).length;
          if (used >= 2) { C.warn('ESP32에서 사용할 수 있는 UART는 UART1, UART2 두 개입니다'); return null; }
          bus = used === 0 ? 2 : 1;
        } else {
          bus = HW.uartBus(tx, rx);
          if (bus == null) { C.warn(`GP${tx ?? '-'}/GP${rx ?? '-'} 는 UART TX/RX 핀 조합이 아닙니다 (예: GP0=TX0, GP1=RX0 / GP4=TX1, GP5=RX1)`); return null; }
        }
        const name = 'uart' + bus;
        if (!buses.has(name)) {
          buses.set(name, name);
          const args = [tx != null ? `tx=Pin(${tx})` : '', rx != null ? `rx=Pin(${rx})` : ''].filter(Boolean).join(', ');
          busLines.push(`${name} = UART(${bus}, baudrate=${baud}, ${args})`);
        }
        return name;
      },
    };
    B.warnPin = (g, msg) => warn(n, msg);
    try {
      const lines = d.setup ? d.setup(n, C) : [];
      if (lines && lines.length) setup.push(...lines);
    } catch (e) { warn(n, '설정 코드 오류: ' + e.message); }
  }

  // --- 프로그램 노드 ---
  const pinVars = new Map();
  const depth = { v: 0 };
  const G = {
    B, warn,
    imp: s => imports.add(s),
    helper: (k, code) => { if (!helpers.has(k)) helpers.set(k, code); },
    setup: (k, line) => { if (!setupKeys.has(k)) { setupKeys.add(k); setup.push(line); } },
    meta: d => metas.get(d.id) || {},
    var(n) { const v = pyIdent(n.st.name || 'count'); vars.add(v); return v; },
    expr(n, port) {
      const src = into.get(n.id + ':' + port);
      const spec = NODES[n.type].ins.find(p => p.n === port);
      if (src) {
        const [sid, sp] = splitTerm(src);
        const sn = byId.get(sid);
        const sd = sn && NODES[sn.type];
        if (!sd || !sd.expr) return literal(spec ? spec.t : 'any', n.st[port] ?? spec?.def);
        if (!boardOk(sn, sd)) { warn(sn, `${bdef.short}에서는 사용할 수 없는 노드입니다`); return '0'; }
        if (depth.v > 60) { warn(n, '데이터 연결이 순환합니다'); return '0'; }
        depth.v++;
        try {
          const e = sd.expr(sn, G, sp);
          return /^[\w.]+(\(.*\))?(\[\d+\])?$/.test(e) && !/\s/.test(e) ? e : `(${e})`;
        } finally { depth.v--; }
      }
      return literal(spec ? spec.t : 'any', n.st[port] ?? spec?.def);
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
        else { warn(n, 'GPIO 핀에 연결하세요'); return null; }
      } else {
        const v = n.st.pin;
        if (v === undefined || v === '' || v === null) { warn(n, '핀을 선택하거나 보드 핀에 연결하세요'); return null; }
        g = +v;
        if (!bdef.gpios.includes(g)) { warn(n, `${bdef.short}에는 ${bdef.pinLabel(g)} 핀이 없습니다`); return null; }
      }
      usedPins.set(g, n);
      return g;
    },
    pinVar(n, mode, pull) {
      const g = G.pin(n);
      if (g == null) return null;
      if (mode === 'adc' && !B.adcOk(g)) { warn(n, B.adcHint(g)); return null; }
      const key = `${g}:${mode}`;
      if (pinVars.has(key)) return pinVars.get(key);
      if (!B.pico) {
        const name = `pin${g}`;
        pinVars.set(key, name);
        if (mode === 'in') setup.push(`${name}.set_pull(${name}.${pull && pull !== 'NONE' ? pull : 'NO_PULL'})`);
        return name;
      }
      const used = [...pinVars.keys()].some(k => k.startsWith(g + ':'));
      const name = used ? `gp${g}_${mode}` : `gp${g}`;
      pinVars.set(key, name);
      B.warnPin = (gg, msg) => warn(n, msg);
      if (mode === 'in') setup.push(...B.inp(name, g, pull));
      else setup.push(`${name} = ${mode === 'out' ? B.out(g) : mode === 'pwm' ? B.pwm(g) : B.adc(g)}`);
      return name;
    },
    chain(n, port) {
      const lines = [];
      const seen = new Set();
      let t = (from.get(n.id + ':' + port) || [])[0];
      while (t) {
        const [tid] = splitTerm(t);
        const tn = byId.get(tid);
        if (!tn || !NODES[tn.type] || !NODES[tn.type].stmt) break;
        if (seen.has(tid) || depth.v > 40) { warn(tn, '실행 흐름이 순환합니다 (반복 노드를 사용하세요)'); break; }
        seen.add(tid);
        depth.v++;
        try {
          if (!boardOk(tn, NODES[tn.type])) warn(tn, `${bdef.short}에서는 사용할 수 없는 노드입니다`);
          else lines.push(...NODES[tn.type].stmt(tn, G));
        } finally { depth.v--; }
        t = (from.get(tid + ':out') || [])[0];
      }
      return lines;
    },
  };

  const byPos = (a, b) => a.y - b.y || a.x - b.x;
  const evs = t => graph.nodes.filter(n => n.type === t).sort(byPos);
  for (const n of graph.nodes) {
    const d = NODES[n.type];
    if (d && !boardOk(n, d) && (n.type.startsWith('ev_') || !d.stmt && !d.expr)) warn(n, `${bdef.short}에서는 사용할 수 없는 노드입니다`);
  }

  // 이벤트: Pico는 Timer/IRQ, micro:bit는 메인 루프에서 폴링
  const handlers = [];     // {pre, head, guard, body, after(pico 등록), poll(mb 루프 확인)}
  for (const n of evs('ev_timer')) {
    const period = Math.max(1, parseInt(n.st.period) || 1000);
    const body = G.chain(n, 'out');
    const tid = B.esp ? `${handlers.filter(h => h.timer).length}, ` : '';
    if (B.esp && tid === '4, ') warn(n, 'ESP32 하드웨어 타이머는 4개(0~3)까지입니다');
    if (B.pico) handlers.push({ timer: true, head: `def on_timer_${n.id}(t):`, body, after: [`timer_${n.id} = Timer(${tid}period=${period}, mode=Timer.PERIODIC, callback=on_timer_${n.id})`] });
    else handlers.push({ pre: [`_t_${n.id} = running_time()`], head: `def on_timer_${n.id}():`, body, poll: [`if running_time() - _t_${n.id} >= ${period}:`, `    _t_${n.id} = running_time()`, `    on_timer_${n.id}()`] });
  }
  for (const n of evs('ev_pin')) {
    const pv = G.pinVar(n, 'in', n.st.pull || 'PULL_UP');
    const body = G.chain(n, 'out');
    if (!pv) continue;
    const edge = n.st.edge || 'FALLING';
    if (B.pico) {
      const trig = edge === 'BOTH' ? 'Pin.IRQ_FALLING | Pin.IRQ_RISING' : `Pin.IRQ_${edge}`;
      handlers.push({ head: `def on_pin_${n.id}(p):`, body, after: [`${pv}.irq(trigger=${trig}, handler=on_pin_${n.id})`] });
    } else {
      const cond = edge === 'BOTH' ? '' : edge === 'RISING' ? ` and _v == 1` : ` and _v == 0`;
      handlers.push({
        pre: [`_prev_${n.id} = ${pv}.read_digital()`], head: `def on_pin_${n.id}():`, body,
        poll: [`_v = ${pv}.read_digital()`, `if _v != _prev_${n.id}${cond}:`, `    on_pin_${n.id}()`, `_prev_${n.id} = _v`],
      });
    }
  }
  for (const n of evs('ev_button')) {
    const d = G.dev(n);
    const body = G.chain(n, 'out');
    if (!d) continue;
    const low = G.meta(d).activeLow !== false;
    if (B.pico) {
      handlers.push({
        pre: [`_last_${n.id} = 0`], head: `def on_press_${n.id}(p):`, extraGlobal: `_last_${n.id}`,
        guard: [`    if time.ticks_diff(time.ticks_ms(), _last_${n.id}) < 200:`, '        return', `    _last_${n.id} = time.ticks_ms()`],
        body, after: [`${d.name}.irq(trigger=Pin.IRQ_${low ? 'FALLING' : 'RISING'}, handler=on_press_${n.id})`],
      });
    } else {
      const act = low ? 0 : 1;
      handlers.push({
        pre: [`_prev_${n.id} = ${1 - act}`], head: `def on_press_${n.id}():`, body,
        poll: [`_v = ${d.name}.read_digital()`, `if _v != _prev_${n.id} and _v == ${act}:`, `    on_press_${n.id}()`, `_prev_${n.id} = _v`],
      });
    }
  }
  if (!B.pico) {
    for (const n of evs('ev_mb_button')) {
      const body = G.chain(n, 'out');
      const b = n.st.btn || 'a';
      if (b === 'logo') handlers.push({ pre: [`_logo_${n.id} = False`], head: `def on_logo_${n.id}():`, body, poll: [`_v = pin_logo.is_touched()`, `if _v and not _logo_${n.id}:`, `    on_logo_${n.id}()`, `_logo_${n.id} = _v`] });
      else handlers.push({ head: `def on_button_${b}_${n.id}():`, body, poll: [`if button_${b}.was_pressed():`, `    on_button_${b}_${n.id}()`] });
    }
    for (const n of evs('ev_mb_gesture')) {
      const body = G.chain(n, 'out');
      handlers.push({ head: `def on_gesture_${n.id}():`, body, poll: [`if accelerometer.was_gesture('${n.st.g || 'shake'}'):`, `    on_gesture_${n.id}()`] });
    }
  }
  const startCode = [];
  for (const n of evs('ev_start')) startCode.push(...G.chain(n, 'out'));
  const loopNodes = evs('ev_loop');
  if (loopNodes.length > 1) warn(loopNodes[1], '무한 반복 노드는 하나만 사용할 수 있습니다 (첫 번째만 실행)');
  const polls = handlers.flatMap(h => h.poll || []);
  let loops = [];
  if (loopNodes.length || polls.length) {
    const n = loopNodes[0];
    const body = n ? G.chain(n, 'out') : [];
    const dl = n ? (parseInt(n.st.delay ?? 10) || 0) : 10;
    loops = ['while True:', ...ind(body.concat(polls, dl > 0 ? [B.sleep(dl)] : []))];
  }
  const handlerLines = [];
  for (const h of handlers) {
    const gl = [...vars, h.extraGlobal, ...(h.poll ? [] : [])].filter(Boolean);
    handlerLines.push(...(h.pre || []), h.head, ...(gl.length ? [`    global ${gl.join(', ')}`] : []), ...(h.guard || []), ...ind(h.body), '');
  }
  const afters = handlers.flatMap(h => h.after || []);

  if (B.esp && !B.nano) {
    for (const g of [1, 3]) if (usedPins.has(g)) warn(usedPins.get(g), `GPIO${g}는 USB REPL(UART0)과 공유됩니다 (UART는 TX=17, RX=16 등 다른 핀 권장)`);
    if (usedPins.has(12)) warn(usedPins.get(12), 'GPIO12는 스트래핑 핀입니다 (부팅 시 HIGH면 부팅 실패 가능)');
    const wifi = graph.nodes.some(n => n.type === 'esp_wifi');
    const adc2 = [...usedPins.keys()].filter(g => [0, 2, 4, 12, 13, 14, 15, 25, 26, 27].includes(g));
    if (wifi && adc2.length && [...setup, ...busLines].some(l => /ADC\(Pin\((0|2|4|12|13|14|15|25|26|27)\)/.test(l))) warn(null, 'WiFi 사용 중에는 ADC2 핀(GPIO0,2,4,12~15,25~27)의 아날로그 입력이 동작하지 않습니다. GPIO32~39를 사용하세요');
  }

  // micro:bit LED 화면 공유 핀
  if (!B.pico) {
    const shared = [...usedPins.keys()].filter(g => MB_DISPLAY_PINS.includes(g));
    if (shared.length) {
      setup.unshift('display.off()  # LED 화면과 공유되는 핀(P3/P4/P6/P7/P9/P10) 사용');
      const usesDisplay = graph.nodes.some(n => ['mb_show', 'mb_scroll', 'mb_image', 'mb_plot', 'mb_clear'].includes(n.type));
      warn(usedPins.get(shared[0]), `P${shared.join(', P')}는 LED 화면과 공유됩니다${usesDisplay ? ' — LED 화면 노드와 함께 쓰면 충돌합니다' : ' (display.off() 자동 추가)'}`);
    }
    for (const g of [5, 11]) if (usedPins.has(g)) warn(usedPins.get(g), `P${g}는 내장 버튼 ${g === 5 ? 'A' : 'B'}와 연결되어 있습니다`);
  }

  // --- 조립 ---
  const out = [];
  out.push(`# picoBuilder 자동 생성 코드 (MicroPython / ${bdef.label})`);
  out.push(...B.header);
  const sortedImp = [...imports].sort((a, b) => (a.startsWith('from') - b.startsWith('from')) || a.localeCompare(b));
  out.push(...sortedImp);
  out.push('');
  if (busLines.length || setup.length) out.push('# ---- 회로 설정 ----', ...busLines, ...setup, '');
  if (helpers.size) out.push('# ---- 도우미 함수 ----', ...[...helpers.values()].flatMap(h => [h, '']));
  if (vars.size) out.push('# ---- 변수 ----', ...[...vars].map(v => `${v} = 0`), '');
  if (handlerLines.length) out.push('# ---- 이벤트 ----', ...handlerLines, ...afters, ...(afters.length ? [''] : []));
  if (startCode.length) out.push('# ---- 시작 ----', ...startCode, '');
  if (loops.length) out.push(polls.length && !B.pico ? '# ---- 무한 반복 (이벤트 확인 포함) ----' : '# ---- 무한 반복 ----', ...loops, '');
  if (!startCode.length && !loops.length && !handlerLines.length) out.push('# "시작" 또는 "무한 반복" 이벤트 노드에 실행 노드를 연결하세요', '');
  // 업로드에 필요한 라이브러리 (micro:bit는 framebuf 미내장)
  const libList = [...libs.keys()];
  if (!B.pico && libList.some(l => l === 'ssd1306' || l === 'max7219')) libList.push('framebuf');
  const python = out.join('\n');
  // 구형 Arduino: 화면에는 C++ 코드를, 시뮬레이터에는 위에서 만든 파이썬 코드를 사용
  if (bdef.lang === 'cpp') {
    let cpp;
    try { cpp = generateArduino(graph, sim); }
    catch (e) { console.error(e); cpp = { code: '// 코드 생성 오류: ' + e.message, libs: [], warnings: [{ msg: 'C++ 코드 생성 오류: ' + e.message }] }; }
    const seen = new Set(cpp.warnings.map(w => w.msg));
    const merged = cpp.warnings.concat(warnings.filter(w => !seen.has(w.msg)));
    return { code: cpp.code, simCode: python, libs: cpp.libs, warnings: merged, board: btype, lang: 'cpp' };
  }
  return { code: python, libs: libList, warnings, board: btype, lang: 'python' };
}
