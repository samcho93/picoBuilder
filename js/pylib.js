// Python 소스: 시뮬레이터용 MicroPython 호환 모듈 + Pico에 업로드되는 드라이버 라이브러리
'use strict';

// ---------- Pico에도 업로드되는 드라이버 (MicroPython 실제 동작 코드) ----------
const PY_DRIVERS = {};

PY_DRIVERS.ssd1306 = String.raw`# MicroPython SSD1306 OLED driver, I2C interface (micropython-lib, MIT)
from micropython import const
import framebuf

SET_CONTRAST = const(0x81)
SET_ENTIRE_ON = const(0xA4)
SET_NORM_INV = const(0xA6)
SET_DISP = const(0xAE)
SET_MEM_ADDR = const(0x20)
SET_COL_ADDR = const(0x21)
SET_PAGE_ADDR = const(0x22)
SET_DISP_START_LINE = const(0x40)
SET_SEG_REMAP = const(0xA0)
SET_MUX_RATIO = const(0xA8)
SET_IREF_SELECT = const(0xAD)
SET_COM_OUT_DIR = const(0xC0)
SET_DISP_OFFSET = const(0xD3)
SET_COM_PIN_CFG = const(0xDA)
SET_DISP_CLK_DIV = const(0xD5)
SET_PRECHARGE = const(0xD9)
SET_VCOM_DESEL = const(0xDB)
SET_CHARGE_PUMP = const(0x8D)


class SSD1306(framebuf.FrameBuffer):
    def __init__(self, width, height, external_vcc):
        self.width = width
        self.height = height
        self.external_vcc = external_vcc
        self.pages = self.height // 8
        self.buffer = bytearray(self.pages * self.width)
        super().__init__(self.buffer, self.width, self.height, framebuf.MONO_VLSB)
        self.init_display()

    def init_display(self):
        for cmd in (
            SET_DISP,
            SET_MEM_ADDR, 0x00,
            SET_DISP_START_LINE,
            SET_SEG_REMAP | 0x01,
            SET_MUX_RATIO, self.height - 1,
            SET_COM_OUT_DIR | 0x08,
            SET_DISP_OFFSET, 0x00,
            SET_COM_PIN_CFG, 0x02 if self.width > 2 * self.height else 0x12,
            SET_DISP_CLK_DIV, 0x80,
            SET_PRECHARGE, 0x22 if self.external_vcc else 0xF1,
            SET_VCOM_DESEL, 0x30,
            SET_CONTRAST, 0xFF,
            SET_ENTIRE_ON,
            SET_NORM_INV,
            SET_IREF_SELECT, 0x30,
            SET_CHARGE_PUMP, 0x10 if self.external_vcc else 0x14,
            SET_DISP | 0x01,
        ):
            self.write_cmd(cmd)
        self.fill(0)
        self.show()

    def poweroff(self):
        self.write_cmd(SET_DISP)

    def poweron(self):
        self.write_cmd(SET_DISP | 0x01)

    def contrast(self, contrast):
        self.write_cmd(SET_CONTRAST)
        self.write_cmd(contrast)

    def invert(self, invert):
        self.write_cmd(SET_NORM_INV | (invert & 1))

    def rotate(self, rotate):
        self.write_cmd(SET_COM_OUT_DIR | ((rotate & 1) << 3))
        self.write_cmd(SET_SEG_REMAP | (rotate & 1))

    def show(self):
        x0 = 0
        x1 = self.width - 1
        if self.width != 128:
            col_offset = (128 - self.width) // 2
            x0 += col_offset
            x1 += col_offset
        self.write_cmd(SET_COL_ADDR)
        self.write_cmd(x0)
        self.write_cmd(x1)
        self.write_cmd(SET_PAGE_ADDR)
        self.write_cmd(0)
        self.write_cmd(self.pages - 1)
        self.write_data(self.buffer)


class SSD1306_I2C(SSD1306):
    def __init__(self, width, height, i2c, addr=0x3C, external_vcc=False):
        self.i2c = i2c
        self.addr = addr
        self.temp = bytearray(2)
        self.write_list = [b"\x40", None]
        super().__init__(width, height, external_vcc)

    def write_cmd(self, cmd):
        self.temp[0] = 0x80
        self.temp[1] = cmd
        self.i2c.writeto(self.addr, self.temp)

    def write_data(self, buf):
        self.write_list[1] = buf
        self.i2c.writevto(self.addr, self.write_list)
`;

PY_DRIVERS.i2c_lcd = String.raw`# HD44780 16x2 LCD + PCF8574 I2C backpack driver (picoBuilder)
try:
    import time
    time.sleep_ms
except (ImportError, AttributeError):
    import utime as time


class I2cLcd:
    def __init__(self, i2c, addr=0x27, rows=2, cols=16):
        self.i2c = i2c
        self.addr = addr
        self.rows = rows
        self.cols = cols
        self.bl = 0x08
        self.cx = 0
        self.cy = 0
        self.i2c.writeto(self.addr, bytes([0]))
        time.sleep_ms(20)
        for _ in range(3):
            self._nib(0x03, 0)
            time.sleep_ms(5)
        self._nib(0x02, 0)
        time.sleep_ms(1)
        self.cmd(0x28)
        self.cmd(0x0C)
        self.cmd(0x06)
        self.clear()

    def _nib(self, n, rs):
        b = ((n & 0x0F) << 4) | rs | self.bl
        self.i2c.writeto(self.addr, bytes([b | 0x04, b]))

    def _send(self, v, rs):
        self._nib(v >> 4, rs)
        self._nib(v & 0x0F, rs)

    def cmd(self, c):
        self._send(c, 0)
        if c <= 3:
            time.sleep_ms(2)

    def data(self, d):
        self._send(d, 1)

    def clear(self):
        self.cmd(0x01)
        self.cx = 0
        self.cy = 0

    def home(self):
        self.cmd(0x02)
        self.cx = 0
        self.cy = 0

    def move_to(self, col, row):
        self.cx = col
        self.cy = row
        addr = col & 0x3F
        if row & 1:
            addr += 0x40
        if row & 2:
            addr += self.cols
        self.cmd(0x80 | addr)

    def putchar(self, ch):
        if ch == '\n':
            self.move_to(0, (self.cy + 1) % self.rows)
            return
        c = ord(ch)
        self.data(c if c < 256 else 0x3F)
        self.cx += 1
        if self.cx >= self.cols:
            self.move_to(0, (self.cy + 1) % self.rows)

    def putstr(self, s):
        for ch in str(s):
            self.putchar(ch)

    def backlight_on(self):
        self.bl = 0x08
        self.i2c.writeto(self.addr, bytes([self.bl]))

    def backlight_off(self):
        self.bl = 0x00
        self.i2c.writeto(self.addr, bytes([self.bl]))

    def display_on(self):
        self.cmd(0x0C)

    def display_off(self):
        self.cmd(0x08)

    def custom_char(self, location, charmap):
        self.cmd(0x40 | ((location & 7) << 3))
        for b in charmap:
            self.data(b)
        self.move_to(self.cx, self.cy)
`;

PY_DRIVERS.aht20 = String.raw`# AHT20 temperature/humidity sensor driver (picoBuilder)
try:
    import time
    time.sleep_ms
except (ImportError, AttributeError):
    import utime as time


class AHT20:
    def __init__(self, i2c, addr=0x38):
        self.i2c = i2c
        self.addr = addr
        time.sleep_ms(40)
        st = self.i2c.readfrom(self.addr, 1)[0]
        if not st & 0x08:
            self.i2c.writeto(self.addr, b'\xbe\x08\x00')
            time.sleep_ms(10)

    def measure(self):
        self.i2c.writeto(self.addr, b'\xac\x33\x00')
        time.sleep_ms(80)
        d = self.i2c.readfrom(self.addr, 7)
        for _ in range(10):
            if not d[0] & 0x80:
                break
            time.sleep_ms(10)
            d = self.i2c.readfrom(self.addr, 7)
        h = (d[1] << 12) | (d[2] << 4) | (d[3] >> 4)
        t = ((d[3] & 0x0F) << 16) | (d[4] << 8) | d[5]
        return t * 200 / 1048576 - 50, h * 100 / 1048576

    def temperature(self):
        return self.measure()[0]

    def humidity(self):
        return self.measure()[1]
`;

PY_DRIVERS.mpu6050 = String.raw`# MPU6050 accelerometer/gyroscope driver (picoBuilder)


class MPU6050:
    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr
        self.i2c.writeto_mem(self.addr, 0x6B, b'\x00')

    def _r(self, reg):
        d = self.i2c.readfrom_mem(self.addr, reg, 2)
        v = (d[0] << 8) | d[1]
        return v - 65536 if v > 32767 else v

    def accel(self):
        return tuple(round(self._r(0x3B + 2 * i) / 16384, 3) for i in range(3))

    def gyro(self):
        return tuple(round(self._r(0x43 + 2 * i) / 131, 2) for i in range(3))

    def temperature(self):
        return round(self._r(0x41) / 340 + 36.53, 2)
`;

PY_DRIVERS.bh1750 = String.raw`# BH1750 ambient light sensor driver (picoBuilder)
try:
    import time
    time.sleep_ms
except (ImportError, AttributeError):
    import utime as time


class BH1750:
    def __init__(self, i2c, addr=0x23):
        self.i2c = i2c
        self.addr = addr
        self.i2c.writeto(self.addr, b'\x01')
        self.i2c.writeto(self.addr, b'\x10')
        time.sleep_ms(180)

    def lux(self):
        d = self.i2c.readfrom(self.addr, 2)
        return round(((d[0] << 8) | d[1]) / 1.2, 1)
`;

PY_DRIVERS.ds3231 = String.raw`# DS3231 RTC driver (picoBuilder)


def _bcd2dec(x):
    return (x >> 4) * 10 + (x & 0x0F)


def _dec2bcd(x):
    return ((x // 10) << 4) | (x % 10)


class DS3231:
    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr

    def datetime(self, dt=None):
        if dt is None:
            d = self.i2c.readfrom_mem(self.addr, 0, 7)
            return (2000 + _bcd2dec(d[6]), _bcd2dec(d[5] & 0x1F), _bcd2dec(d[4]), _bcd2dec(d[3]),
                    _bcd2dec(d[2] & 0x3F), _bcd2dec(d[1]), _bcd2dec(d[0] & 0x7F))
        y, mo, day, wd, h, mi, s = dt[:7]
        self.i2c.writeto_mem(self.addr, 0, bytes([_dec2bcd(s), _dec2bcd(mi), _dec2bcd(h), _dec2bcd(wd),
                                                  _dec2bcd(day), _dec2bcd(mo), _dec2bcd(y % 100)]))

    def temperature(self):
        d = self.i2c.readfrom_mem(self.addr, 0x11, 2)
        t = d[0] if d[0] < 128 else d[0] - 256
        return t + (d[1] >> 6) * 0.25
`;

PY_DRIVERS.max7219 = String.raw`# MAX7219 8x8 LED matrix driver (picoBuilder)
import framebuf


class Matrix8x8(framebuf.FrameBuffer):
    def __init__(self, spi, cs, num=1):
        self.spi = spi
        self.cs = cs
        self.num = num
        self.buffer = bytearray(8 * num)
        super().__init__(self.buffer, 8 * num, 8, framebuf.MONO_HLSB)
        self.cs.init(self.cs.OUT, value=1)
        for reg, val in ((0x0C, 0), (0x0F, 0), (0x09, 0), (0x0B, 7), (0x0A, 3), (0x0C, 1)):
            self._write(reg, val)
        self.fill(0)
        self.show()

    def _write(self, reg, val):
        self.cs(0)
        for _ in range(self.num):
            self.spi.write(bytes([reg, val]))
        self.cs(1)

    def brightness(self, value):
        self._write(0x0A, value & 0x0F)

    def show(self):
        for y in range(8):
            self.cs(0)
            for m in range(self.num):
                self.spi.write(bytes([y + 1, self.buffer[y * self.num + m]]))
            self.cs(1)
`;

PY_DRIVERS.mcp3008 = String.raw`# MCP3008 8-channel 10-bit SPI ADC driver (picoBuilder)


class MCP3008:
    def __init__(self, spi, cs):
        self.spi = spi
        self.cs = cs
        self.cs.init(self.cs.OUT, value=1)
        self._out = bytearray(3)
        self._in = bytearray(3)

    def read(self, ch, diff=False):
        self._out[0] = 0x01
        self._out[1] = ((0 if diff else 1) << 7) | ((ch & 7) << 4)
        self._out[2] = 0
        self.cs(0)
        self.spi.write_readinto(self._out, self._in)
        self.cs(1)
        return ((self._in[1] & 0x03) << 8) | self._in[2]
`;

PY_DRIVERS.nmea = String.raw`# Minimal NMEA (GPS) parser (picoBuilder)


class NMEA:
    def __init__(self, uart):
        self.uart = uart
        self.lat = 0.0
        self.lon = 0.0
        self.fix = False
        self.sats = 0
        self.alt = 0.0
        self.time = ''

    def poll(self):
        while self.uart.any():
            line = self.uart.readline()
            if not line:
                break
            self._parse(line)
        return self

    def _deg(self, v, h):
        if not v:
            return 0.0
        d = int(float(v) / 100)
        r = d + (float(v) - d * 100) / 60
        return round(-r if h in ('S', 'W') else r, 6)

    def _parse(self, line):
        try:
            s = line.decode().strip()
        except Exception:
            return
        if not s.startswith('$') or '*' not in s:
            return
        body, ck = s[1:].split('*', 1)
        c = 0
        for ch in body:
            c ^= ord(ch)
        if '%02X' % c != ck[:2].upper():
            return
        f = body.split(',')
        kind = f[0][2:]
        if kind == 'RMC' and len(f) > 6:
            self.fix = f[2] == 'A'
            if len(f[1]) >= 6:
                self.time = f[1][0:2] + ':' + f[1][2:4] + ':' + f[1][4:6]
            if self.fix:
                self.lat = self._deg(f[3], f[4])
                self.lon = self._deg(f[5], f[6])
        elif kind == 'GGA' and len(f) > 9:
            self.sats = int(f[7] or 0)
            if f[9]:
                self.alt = float(f[9])
`;

// ---------- 시뮬레이터 전용 모듈 ----------
const PY_SIM = {};

PY_SIM._pbrt = String.raw`# picoBuilder runtime: 사용자 코드를 비동기로 변환해 브라우저에서 실행
import ast, sys, asyncio, traceback, linecache, time as _time
import pbhw

_last = [0.0]
_sync = [0]


def _check():
    if pbhw.is_stopped():
        raise KeyboardInterrupt()


def __pb_ny():
    _check()
    return _sync[0] == 0 and pbhw.now_ms() - _last[0] > 30


async def __pb_yield():
    await asyncio.sleep(0)
    _last[0] = pbhw.now_ms()


def busy_wait(sec):
    end = pbhw.now_ms() + sec * 1000
    n = 0
    while pbhw.now_ms() < end:
        n += 1
        if n & 255 == 0:
            _check()


async def __pb_sleep(kind, v):
    s = v if kind == 'sleep' else (v / 1000 if kind == 'sleep_ms' else v / 1e6)
    _check()
    if s <= 0:
        if __pb_ny():
            await __pb_yield()
        return
    if s < 0.003 or _sync[0]:
        busy_wait(s)
        return
    end = pbhw.now_ms() + s * 1000
    while True:
        rem = end - pbhw.now_ms()
        if rem <= 0:
            break
        await asyncio.sleep(min(rem, 50) / 1000)
        _check()
    _last[0] = pbhw.now_ms()


async def asleep_ms(ms):
    await __pb_sleep('sleep_ms', ms)


async def __pb_aw(x):
    if asyncio.iscoroutine(x):
        return await x
    return x


def __pb_sync(x):
    if not asyncio.iscoroutine(x):
        return x
    _sync[0] += 1
    try:
        x.send(None)
    except StopIteration as e:
        return e.value
    finally:
        _sync[0] -= 1
    x.close()
    raise RuntimeError('이 위치(동기 함수/람다)에서는 대기할 수 없습니다')


def report():
    et, ev, tb = sys.exc_info()
    out = ['Traceback (most recent call last):']
    for fs in traceback.extract_tb(tb):
        fn = fs.filename
        if fn == 'main.py' or (fn.startswith('/pblib/') and not fn.endswith(('_pbrt.py', 'framebuf.py', 'mbcompat.py'))):
            out.append('  File "%s", line %d, in %s' % (fn.replace('/pblib/', ''), fs.lineno, fs.name))
            if fs.line:
                out.append('    ' + fs.line.strip())
    out.append('%s: %s' % (et.__name__, ev) if str(ev) else et.__name__)
    print('\n'.join(out), file=sys.stderr)


async def _guard(c):
    try:
        await c
    except KeyboardInterrupt:
        pass
    except Exception:
        report()


def pb_call(fn, arg):
    try:
        r = fn(arg)
        if asyncio.iscoroutine(r):
            asyncio.ensure_future(_guard(r))
    except KeyboardInterrupt:
        pass
    except Exception:
        report()


def spawn(fn, args=()):
    try:
        r = fn(*args)
        if asyncio.iscoroutine(r):
            asyncio.ensure_future(_guard(r))
    except Exception:
        report()


SLEEPS = ('sleep', 'sleep_ms', 'sleep_us')


def _has_yield(fn):
    for node in ast.walk(fn):
        if isinstance(node, (ast.Yield, ast.YieldFrom)):
            return True
    return False


class _Collect(ast.NodeVisitor):
    def __init__(self):
        self.funcs = set()
        self.time_mods = set()
        self.sleep_names = set()
        self.asyncio_names = set()
        self.mb_mods = set()
        self.music_mods = set()

    def visit_FunctionDef(self, node):
        if not node.name.startswith('__') and not _has_yield(node):
            self.funcs.add(node.name)
        self.generic_visit(node)

    def visit_Import(self, node):
        for a in node.names:
            if a.name in ('time', 'utime'):
                self.time_mods.add(a.asname or a.name)
            if a.name in ('asyncio', 'uasyncio'):
                self.asyncio_names.add(a.asname or a.name)
            if a.name == 'microbit':
                self.mb_mods.add(a.asname or a.name)
            if a.name == 'music':
                self.music_mods.add(a.asname or a.name)

    def visit_ImportFrom(self, node):
        if node.module in ('time', 'utime'):
            for a in node.names:
                if a.name in SLEEPS:
                    self.sleep_names.add((a.asname or a.name, a.name))
        if node.module == 'microbit':
            for a in node.names:
                if a.name in ('*', 'sleep'):
                    self.sleep_names.add((a.asname or 'sleep', 'sleep_ms'))


class _Tx(ast.NodeTransformer):
    def __init__(self, col):
        self.c = col
        self.ctx = ['async']
        self.sleep_map = dict(col.sleep_names)

    def _async(self):
        return self.ctx[-1] == 'async'

    def visit_FunctionDef(self, node):
        if node.name in self.c.funcs:
            self.ctx.append('async')
            self.generic_visit(node)
            self.ctx.pop()
            fields = {f: getattr(node, f) for f in node._fields}
            new = ast.AsyncFunctionDef(**fields)
            return ast.copy_location(new, node)
        self.ctx.append('sync')
        self.generic_visit(node)
        self.ctx.pop()
        return node

    def visit_AsyncFunctionDef(self, node):
        self.ctx.append('async')
        self.generic_visit(node)
        self.ctx.pop()
        return node

    def visit_Lambda(self, node):
        self.ctx.append('sync')
        self.generic_visit(node)
        self.ctx.pop()
        return node

    def visit_ClassDef(self, node):
        self.ctx.append('sync')
        self.generic_visit(node)
        self.ctx.pop()
        return node

    def _gen_comp(self, node):
        # 제너레이터 표현식은 별도 스코프(동기)로 취급
        self.ctx.append('sync')
        self.generic_visit(node)
        self.ctx.pop()
        return node

    visit_GeneratorExp = _gen_comp

    def visit_Import(self, node):
        for a in node.names:
            if a.name == 'uasyncio':
                a.name = 'asyncio'
        return node

    def visit_ImportFrom(self, node):
        if node.module == 'uasyncio':
            node.module = 'asyncio'
        return node

    def visit_Await(self, node):
        if isinstance(node.value, ast.Call):
            call = node.value
            call.func = self.visit(call.func)
            call.args = [self.visit(a) for a in call.args]
            for kw in call.keywords:
                kw.value = self.visit(kw.value)
            return node
        self.generic_visit(node)
        return node

    def _sleep_kind(self, f):
        if isinstance(f, ast.Attribute) and f.attr in SLEEPS and isinstance(f.value, ast.Name) and f.value.id in self.c.time_mods:
            return f.attr
        if isinstance(f, ast.Name) and f.id in self.sleep_map:
            return self.sleep_map[f.id]
        if isinstance(f, ast.Attribute) and f.attr == 'sleep' and isinstance(f.value, ast.Name) and f.value.id in self.c.mb_mods:
            return 'sleep_ms'
        return None

    def _blocking(self, f):
        # micro:bit의 애니메이션/소리 함수는 끝날 때까지 기다리는 코루틴을 반환
        if not isinstance(f, ast.Attribute):
            return False
        v = f.value
        if f.attr in ('show', 'scroll'):
            return (isinstance(v, ast.Name) and v.id == 'display') or (isinstance(v, ast.Attribute) and v.attr == 'display')
        if f.attr in ('play', 'pitch'):
            return isinstance(v, ast.Name) and (v.id in self.c.music_mods or v.id == 'music')
        return False

    def visit_Call(self, node):
        self.generic_visit(node)
        f = node.func
        if not self._async():
            if (isinstance(f, ast.Name) and f.id in self.c.funcs) or (isinstance(f, ast.Attribute) and f.attr in self.c.funcs) or self._blocking(f):
                return ast.copy_location(ast.Call(func=ast.Name('__pb_sync', ast.Load()), args=[node], keywords=[]), node)
            return node
        if isinstance(f, ast.Attribute) and f.attr == 'run' and isinstance(f.value, ast.Name) and f.value.id in self.c.asyncio_names and node.args:
            return ast.copy_location(ast.Await(value=node.args[0]), node)
        k = self._sleep_kind(f)
        if k and node.args:
            call = ast.Call(func=ast.Name('__pb_sleep', ast.Load()), args=[ast.Constant(k), node.args[0]], keywords=[])
            return ast.copy_location(ast.Await(value=call), node)
        if (isinstance(f, ast.Name) and f.id in self.c.funcs) or (isinstance(f, ast.Attribute) and f.attr in self.c.funcs) or self._blocking(f):
            call = ast.Call(func=ast.Name('__pb_aw', ast.Load()), args=[node], keywords=[])
            return ast.copy_location(ast.Await(value=call), node)
        return node

    def _loop(self, node):
        self.generic_visit(node)
        if self._async():
            chk = ast.parse('if __pb_ny():\n    await __pb_yield()').body[0]
        else:
            chk = ast.parse('__pb_chk()').body[0]
        for n in ast.walk(chk):
            ast.copy_location(n, node)
        node.body.insert(0, chk)
        return node

    visit_While = _loop
    visit_For = _loop
    visit_AsyncFor = _loop


def _purge():
    for k in list(sys.modules):
        m = sys.modules.get(k)
        f = getattr(m, '__file__', '') or ''
        if f.startswith('/pb') and k not in ('_pbrt', 'time_patch'):
            del sys.modules[k]


async def run(src, board='pico'):
    _purge()
    for p in ('/pbpico', '/pbmb', '/pbesp'):
        while p in sys.path:
            sys.path.remove(p)
    sys.path.insert(0, {'microbit': '/pbmb', 'esp32': '/pbesp', 'nanoesp32': '/pbesp', 'unor3': '/pbesp', 'nano328': '/pbesp'}.get(board, '/pbpico'))
    if board == 'microbit':
        import microbit  # noqa: 화면 초기화
    else:
        import machine  # noqa: 디스패처 등록
    _last[0] = pbhw.now_ms()
    linecache.cache['main.py'] = (len(src), None, src.splitlines(True), 'main.py')
    try:
        tree = ast.parse(src, 'main.py')
    except SyntaxError as e:
        print('  File "main.py", line %s\n    %s\nSyntaxError: %s' % (e.lineno, (e.text or '').rstrip(), e.msg), file=sys.stderr)
        return 'error'
    col = _Collect()
    col.visit(tree)
    tree = _Tx(col).visit(tree)
    ast.fix_missing_locations(tree)
    code = compile(tree, 'main.py', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    g = {'__name__': '__main__', '__pb_sleep': __pb_sleep, '__pb_aw': __pb_aw, '__pb_sync': __pb_sync,
         '__pb_ny': __pb_ny, '__pb_yield': __pb_yield, '__pb_chk': _check}
    try:
        r = eval(code, g)
        if asyncio.iscoroutine(r):
            await r
    except KeyboardInterrupt:
        return 'stopped'
    except SystemExit:
        return 'done'
    except BaseException:
        report()
        return 'error'
    return 'done'
`;

PY_SIM.time_patch = String.raw`# MicroPython time 확장 (ticks_ms 등)을 표준 time 모듈에 추가
import time, sys, pbhw, _pbrt
_P = 0x40000000


def ticks_ms():
    return int(pbhw.now_ms()) & (_P - 1)


def ticks_us():
    return int(pbhw.now_us()) & (_P - 1)


def ticks_cpu():
    return ticks_us()


def ticks_diff(a, b):
    d = (a - b) & (_P - 1)
    return d - _P if d >= _P // 2 else d


def ticks_add(a, d):
    return (a + d) & (_P - 1)


def sleep(s):
    _pbrt.busy_wait(s)


def sleep_ms(ms):
    _pbrt.busy_wait(ms / 1000)


def sleep_us(us):
    _pbrt.busy_wait(us / 1e6)


for _n in ('ticks_ms', 'ticks_us', 'ticks_cpu', 'ticks_diff', 'ticks_add', 'sleep', 'sleep_ms', 'sleep_us'):
    setattr(time, _n, globals()[_n])
sys.modules['utime'] = time
`;

PY_SIM.micropython = String.raw`import _pbrt


def const(x):
    return x


def native(f):
    return f


viper = native


def alloc_emergency_exception_buf(n):
    pass


def schedule(fn, arg):
    _pbrt.pb_call(fn, arg)


def mem_info(*a):
    print('stack: 532 out of 7936\nGC: total: 233024, used: 12000, free: 221024')


def opt_level(*a):
    return 0
`;

PY_SIM.machine = String.raw`# machine 모듈 에뮬레이션 (Raspberry Pi Pico / RP2040)
import pbhw, time, _pbrt
from pyodide.ffi import create_proxy

_BOARD = pbhw.board_type()
_S3 = _BOARD == 'nanoesp32'                      # Arduino Nano ESP32 (ESP32-S3)
_AVR = _BOARD in ('unor3', 'nano328')            # 구형 Arduino: 시뮬레이터 전용 (실제 코드는 C++)
_ESP = _BOARD == 'esp32' or _S3 or _AVR          # 핀 자유 배정 + adc_pin 경로 공유
if _AVR:
    _ESP_GPIO = set(range(22))
    _ESP_ADC = tuple(range(14, 22))
    _ESP_TOUCH = ()
elif _S3:
    _ESP_GPIO = set(range(22)) | set(range(26, 49))
    _ESP_ADC = tuple(range(1, 21))
    _ESP_TOUCH = tuple(range(1, 15))
else:
    _ESP_GPIO = set(range(40)) - {20, 24, 28, 29, 30, 31}
    _ESP_ADC = (32, 33, 34, 35, 36, 39, 0, 2, 4, 12, 13, 14, 15, 25, 26, 27)
    _ESP_TOUCH = (0, 2, 4, 12, 13, 14, 15, 27, 32, 33)
_irq = {}
_timers = {}


def _dispatch(kind, id, arg):
    if kind == 'irq':
        h = _irq.get(id)
        if h and h[0]:
            h[1]._flags = arg
            _pbrt.pb_call(h[0], h[1])
    elif kind == 'timer':
        t = _timers.get(id)
        if t is not None:
            if t._mode == Timer.ONE_SHOT:
                _timers.pop(id, None)
            if t._cb:
                _pbrt.pb_call(t._cb, t)


pbhw.set_dispatcher(create_proxy(_dispatch))


def _gid(p):
    if isinstance(p, Pin):
        return p._id
    if isinstance(p, str):
        if p == 'LED':
            return 13 if _AVR else (48 if _S3 else (2 if _ESP else 25))
        if not _ESP and p in ('WL_GPIO0', 'GP25', 'GPIO25'):
            return 25
        s = p.upper().replace('GPIO', '').replace('GP', '')
        if s.isdigit() and (int(s) in _ESP_GPIO if _ESP else 0 <= int(s) <= 29):
            return int(s)
        raise ValueError('unknown named pin "%s"' % p)
    if isinstance(p, int) and (p in _ESP_GPIO if _ESP else 0 <= p <= 29):
        return p
    raise ValueError('invalid pin')


def _bs(buf):
    return bytes(buf).decode('latin-1')


class Pin:
    IN = 0
    OUT = 1
    OPEN_DRAIN = 2
    ALT = 3
    PULL_UP = 1
    PULL_DOWN = 2
    IRQ_FALLING = 4
    IRQ_RISING = 8

    def __init__(self, id, mode=-1, pull=-1, *args, value=None, **kw):
        self._id = _gid(id)
        self._mode = None
        self._flags = 0
        self.init(mode, pull, value=value)

    def init(self, mode=-1, pull=-1, *args, value=None, **kw):
        if mode is None:
            mode = -1
        if _ESP and not _S3 and not _AVR and self._id >= 34:
            if mode in (1, 2):
                raise ValueError('pin can only be input')
            pull = 0 if pull not in (-1, None) else pull
        if mode != -1:
            self._mode = mode
            if pull == -1:
                pull = 0
        if pull is None:
            pull = 0
        if value is not None:
            pbhw.pin_write(self._id, 1 if value else 0)
        pbhw.pin_init(self._id, mode, pull)
        if value is not None:
            pbhw.pin_write(self._id, 1 if value else 0)

    def value(self, v=None):
        if v is None:
            return int(pbhw.pin_read(self._id))
        pbhw.pin_write(self._id, 1 if v else 0)

    def __call__(self, v=None):
        return self.value(v)

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    high = on
    low = off

    def toggle(self):
        self.value(0 if pbhw.pin_read(self._id) else 1)

    def irq(self, handler=None, trigger=12, hard=False, **kw):
        _irq[self._id] = (handler, self)
        pbhw.pin_irq(self._id, trigger if handler else 0)
        return self

    def flags(self):
        return self._flags

    def __repr__(self):
        return 'Pin(GPIO%d, mode=%s)' % (self._id, {0: 'IN', 1: 'OUT', 2: 'OPEN_DRAIN', 3: 'ALT'}.get(self._mode, 'IN'))


class PWM:
    def __init__(self, pin, freq=None, duty_u16=None, duty_ns=None, invert=False):
        self._id = _gid(pin)
        self._f = 1000
        self._d = 0
        if freq:
            self._f = int(freq)
        if duty_u16 is not None:
            self._d = int(duty_u16)
        if duty_ns is not None:
            self.duty_ns(duty_ns)
            return
        self._apply()

    def init(self, freq=None, duty_u16=None, duty_ns=None):
        if freq:
            self._f = int(freq)
        if duty_u16 is not None:
            self._d = int(duty_u16)
        if duty_ns is not None:
            self.duty_ns(duty_ns)
        self._apply()

    def _apply(self):
        pbhw.pwm_set(self._id, self._f, self._d)

    def freq(self, f=None):
        if f is None:
            return self._f
        if f < 8 or f > 62500000:
            raise ValueError('freq out of range')
        self._f = int(f)
        self._apply()

    def duty_u16(self, d=None):
        if d is None:
            return self._d
        self._d = max(0, min(65535, int(d)))
        self._apply()

    def duty_ns(self, ns=None):
        period = 1e9 / self._f
        if ns is None:
            return int(self._d / 65535 * period)
        self._d = max(0, min(65535, int(ns / period * 65535)))
        self._apply()

    def deinit(self):
        pbhw.pwm_off(self._id)


class ADC:
    CORE_TEMP = 4
    ATTN_0DB = 0
    ATTN_2_5DB = 1
    ATTN_6DB = 2
    ATTN_11DB = 3
    _AVR_FS = (5.0, 5.0, 5.0, 5.0)
    WIDTH_9BIT = 9
    WIDTH_10BIT = 10
    WIDTH_11BIT = 11
    WIDTH_12BIT = 12
    _FS = (5.0, 5.0, 5.0, 5.0) if _AVR else (1.0, 1.34, 2.0, 3.3)

    def __init__(self, pin, *a, atten=None, **k):
        self._esp = _ESP
        if _ESP:
            g = _gid(pin)
            if g not in _ESP_ADC:
                raise ValueError('invalid Pin for ADC')
            self._g = g
            self._atten = (3 if _AVR else 0) if atten is None else atten
            return
        if isinstance(pin, int) and 0 <= pin <= 4:
            self._ch = pin
        else:
            g = _gid(pin)
            if not 26 <= g <= 29:
                raise ValueError("Pin doesn't have ADC capabilities")
            self._ch = g - 26

    def atten(self, a):
        self._atten = a

    def width(self, w):
        pass

    def init(self, atten=None, **k):
        if atten is not None:
            self._atten = atten

    def _volts(self):
        v = int(pbhw.adc_pin(self._g)) * self._FS[3] / 65535
        return min(v, self._FS[self._atten])

    def read_u16(self):
        if not self._esp:
            return int(pbhw.adc_read(self._ch))
        return int(self._volts() / self._FS[self._atten] * 65535)

    def read(self):
        return self.read_u16() >> 4

    def read_uv(self):
        return int(self._volts() * 1000000)


class TouchPad:
    def __init__(self, pin):
        self._g = _gid(pin)
        if self._g not in _ESP_TOUCH:
            raise ValueError('Touch pad error')

    def read(self):
        return 90 if pbhw.mb_touched(self._g) else 620

    def config(self, v):
        pass


class DAC:
    def __init__(self, pin, *a):
        self._g = _gid(pin)
        if self._g not in (25, 26):
            raise ValueError('invalid Pin for DAC')

    def write(self, v):
        pbhw.pwm_set(self._g, 100000, int(max(0, min(255, v)) * 257))


_I2C_DEF = {0: (9, 8), 1: (7, 6)}


class I2C:
    def __init__(self, id=-1, *, scl=None, sda=None, freq=400000, timeout=50000, _soft=False):
        if _ESP and not _soft:
            if id not in (0, 1):
                raise ValueError("I2C(%s) doesn't exist" % id)
            dscl, dsda = (19, 18) if _AVR else ((18, 19), (25, 26))[id]
            self._scl = _gid(scl) if scl is not None else dscl
            self._sda = _gid(sda) if sda is not None else dsda
        elif not _soft:
            if id not in (0, 1):
                raise ValueError('I2C(%s) doesn\'t exist' % id)
            dscl, dsda = _I2C_DEF[id]
            self._scl = _gid(scl) if scl is not None else dscl
            self._sda = _gid(sda) if sda is not None else dsda
            if self._sda % 2 != 0 or (self._sda >> 1) & 1 != id:
                raise ValueError('bad SDA pin')
            if self._scl % 2 != 1 or (self._scl >> 1) & 1 != id:
                raise ValueError('bad SCL pin')
        else:
            self._scl = _gid(scl)
            self._sda = _gid(sda)
        self._freq = freq

    def __repr__(self):
        return 'I2C(scl=%d, sda=%d, freq=%d)' % (self._scl, self._sda, self._freq)

    def init(self, *a, **k):
        pass

    def scan(self):
        return list(pbhw.i2c_scan(self._sda, self._scl).encode('latin-1'))

    def writeto(self, addr, buf, stop=True):
        r = pbhw.i2c_write(self._sda, self._scl, addr, _bs(buf))
        if r < 0:
            raise OSError(5, 'EIO')
        return r

    def writevto(self, addr, vector, stop=True):
        return self.writeto(addr, b''.join(bytes(v) for v in vector if v is not None), stop)

    def readfrom(self, addr, n, stop=True):
        r = pbhw.i2c_read(self._sda, self._scl, addr, n)
        if r is None:
            raise OSError(5, 'EIO')
        return r.encode('latin-1')

    def readfrom_into(self, addr, buf, stop=True):
        d = self.readfrom(addr, len(buf))
        buf[:len(d)] = d

    def _ma(self, memaddr, addrsize):
        return bytes([(memaddr >> 8) & 255, memaddr & 255]) if addrsize == 16 else bytes([memaddr & 255])

    def readfrom_mem(self, addr, memaddr, n, *, addrsize=8):
        self.writeto(addr, self._ma(memaddr, addrsize), False)
        return self.readfrom(addr, n)

    def readfrom_mem_into(self, addr, memaddr, buf, *, addrsize=8):
        d = self.readfrom_mem(addr, memaddr, len(buf), addrsize=addrsize)
        buf[:len(d)] = d

    def writeto_mem(self, addr, memaddr, buf, *, addrsize=8):
        self.writeto(addr, self._ma(memaddr, addrsize) + bytes(buf))


class SoftI2C(I2C):
    def __init__(self, scl, sda, *, freq=400000, timeout=50000):
        super().__init__(-1, scl=scl, sda=sda, freq=freq, _soft=True)


_SPI_DEF = {0: (18, 19, 16), 1: (10, 11, 8)}


class SPI:
    MSB = 0
    LSB = 1
    CONTROLLER = 0

    def __init__(self, id=0, baudrate=1000000, *, polarity=0, phase=0, bits=8, firstbit=0, sck=None, mosi=None, miso=None, _soft=False):
        if _ESP and not _soft:
            if _AVR:
                d = (13, 11, 12)
            else:
                if id not in (1, 2):
                    raise ValueError("SPI(%s) doesn't exist" % id)
                d = {1: (14, 13, 12), 2: (18, 23, 19)}[id]
            self._sck = _gid(sck) if sck is not None else d[0]
            self._mosi = _gid(mosi) if mosi is not None else d[1]
            self._miso = _gid(miso) if miso is not None else d[2]
        elif not _soft:
            if id not in (0, 1):
                raise ValueError("SPI(%s) doesn't exist" % id)
            d = _SPI_DEF[id]
            self._sck = _gid(sck) if sck is not None else d[0]
            self._mosi = _gid(mosi) if mosi is not None else d[1]
            self._miso = _gid(miso) if miso is not None else d[2]
            role = lambda n: ('RX', 'CSn', 'SCK', 'TX')[n % 4]
            bus = lambda n: (n >> 3) & 1
            if role(self._sck) != 'SCK' or bus(self._sck) != id:
                raise ValueError('bad SCK pin')
            if role(self._mosi) != 'TX' or bus(self._mosi) != id:
                raise ValueError('bad MOSI pin')
            if role(self._miso) != 'RX' or bus(self._miso) != id:
                raise ValueError('bad MISO pin')
        else:
            self._sck = _gid(sck)
            self._mosi = _gid(mosi)
            self._miso = _gid(miso) if miso is not None else None
        self._baud = baudrate

    def init(self, *a, **k):
        pass

    def deinit(self):
        pass

    def _x(self, data):
        return pbhw.spi_xfer(self._sck, self._mosi, self._miso, data).encode('latin-1')

    def write(self, buf):
        self._x(_bs(buf))

    def read(self, n, write=0):
        return self._x(chr(write & 255) * n)

    def readinto(self, buf, write=0):
        d = self.read(len(buf), write)
        buf[:len(d)] = d

    def write_readinto(self, wbuf, rbuf):
        d = self._x(_bs(wbuf))
        rbuf[:len(d)] = d


class SoftSPI(SPI):
    def __init__(self, baudrate=500000, *, polarity=0, phase=0, bits=8, firstbit=0, sck=None, mosi=None, miso=None):
        super().__init__(-1, baudrate, sck=sck, mosi=mosi, miso=miso, _soft=True)


_UART_DEF = {0: (0, 1), 1: (4, 5)}


class UART:
    def __init__(self, id, baudrate=115200, bits=8, parity=None, stop=1, *, tx=None, rx=None, timeout=0, **kw):
        if _ESP:
            if _AVR:
                d = (1, 0)
            else:
                if id not in (0, 1, 2):
                    raise ValueError("UART(%s) doesn't exist" % id)
                d = ((1, 3), (10, 9), (17, 16))[id]
            self._tx = _gid(tx) if tx is not None else d[0]
            self._rx = _gid(rx) if rx is not None else d[1]
        else:
            if id not in (0, 1):
                raise ValueError("UART(%s) doesn't exist" % id)
            d = _UART_DEF[id]
            self._tx = _gid(tx) if tx is not None else d[0]
            self._rx = _gid(rx) if rx is not None else d[1]
            role = lambda n: ('TX', 'RX', 'CTS', 'RTS')[n % 4]
            bus = lambda n: ((n + 4) >> 3) & 1
            if role(self._tx) != 'TX' or bus(self._tx) != id:
                raise ValueError('bad TX pin')
            if role(self._rx) != 'RX' or bus(self._rx) != id:
                raise ValueError('bad RX pin')
        self._baud = baudrate
        self._id = id
        self._buf = bytearray()

    def __repr__(self):
        return 'UART(%d, baudrate=%d, tx=%d, rx=%d)' % (self._id, self._baud, self._tx, self._rx)

    def init(self, baudrate=None, *a, **k):
        if baudrate:
            self._baud = baudrate

    def deinit(self):
        pass

    def _pull(self):
        s = pbhw.uart_read(self._rx, self._baud)
        if s:
            self._buf += s.encode('latin-1')

    def any(self):
        self._pull()
        return len(self._buf)

    def read(self, n=None):
        self._pull()
        if not self._buf:
            return None
        if n is None or n >= len(self._buf):
            d = bytes(self._buf)
            self._buf = bytearray()
        else:
            d = bytes(self._buf[:n])
            self._buf = self._buf[n:]
        return d

    def readline(self):
        self._pull()
        i = self._buf.find(b'\n')
        if i < 0:
            return None
        d = bytes(self._buf[:i + 1])
        self._buf = self._buf[i + 1:]
        return d

    def readinto(self, buf, nbytes=None):
        d = self.read(nbytes or len(buf))
        if not d:
            return None
        buf[:len(d)] = d
        return len(d)

    def write(self, buf):
        if isinstance(buf, str):
            buf = buf.encode()
        pbhw.uart_write(self._tx, self._baud, _bs(buf))
        return len(buf)

    def flush(self):
        pass

    def txdone(self):
        return True


_tid = [0]


class Timer:
    ONE_SHOT = 0
    PERIODIC = 1

    def __init__(self, id=-1, *, mode=1, period=-1, freq=-1, callback=None, tick_hz=1000):
        _tid[0] += 1
        self._tid = _tid[0]
        self._cb = None
        self._mode = mode
        if callback is not None or period > 0 or freq > 0:
            self.init(mode=mode, period=period, freq=freq, callback=callback, tick_hz=tick_hz)

    def init(self, *, mode=1, period=-1, freq=-1, callback=None, tick_hz=1000):
        self._mode = mode
        self._cb = callback
        if freq > 0:
            ms = 1000 / freq
        elif period >= 0:
            ms = period * 1000 / tick_hz
        else:
            ms = 1000
        _timers[self._tid] = self
        pbhw.timer_start(self._tid, ms, mode == Timer.PERIODIC)

    def deinit(self):
        pbhw.timer_stop(self._tid)
        _timers.pop(self._tid, None)


class RTC:
    def __init__(self, *a):
        self._off = 0

    def datetime(self, dt=None):
        if dt is None:
            t = time.localtime(time.time() + self._off)
            return (t[0], t[1], t[2], t[6], t[3], t[4], t[5], 0)
        import calendar
        target = calendar.timegm((dt[0], dt[1], dt[2], dt[4], dt[5], dt[6], 0, 0, 0))
        self._off = target - calendar.timegm(time.localtime())


class WDT:
    def __init__(self, id=0, timeout=5000):
        pass

    def feed(self):
        pass


def time_pulse_us(pin, level, timeout_us=1000000):
    return int(pbhw.pulse_us(_gid(pin), level, timeout_us))


def freq(f=None):
    return 125000000 if f is None else None


def unique_id():
    return b'\xe6\x60\x58\x38\x83\x2a\x5c\x2e'


def reset():
    raise SystemExit('machine.reset()')


soft_reset = reset


def reset_cause():
    return 1


def bootloader(*a):
    raise SystemExit('bootloader')


def idle():
    pass


def disable_irq():
    return 0


def enable_irq(state=0):
    pass


def lightsleep(ms=0):
    time.sleep_ms(ms)


deepsleep = lightsleep
PWRON_RESET = 1
WDT_RESET = 3
`;

PY_SIM.framebuf = String.raw`# framebuf 모듈 에뮬레이션
MONO_VLSB = 0
MVLSB = 0
RGB565 = 1
GS4_HMSB = 2
MONO_HLSB = 3
MONO_HMSB = 4
GS2_HMSB = 5
GS8 = 6

_FONT = __FONT__


class FrameBuffer:
    def __init__(self, buf, width, height, format, stride=None):
        self.buf = buf
        self.width = width
        self.height = height
        self.format = format
        self.stride = stride or width

    def _idx(self, x, y):
        f = self.format
        if f == MONO_VLSB:
            return (y >> 3) * self.stride + x, 1 << (y & 7)
        if f == MONO_HLSB:
            return y * ((self.stride + 7) >> 3) + (x >> 3), 0x80 >> (x & 7)
        if f == MONO_HMSB:
            return y * ((self.stride + 7) >> 3) + (x >> 3), 1 << (x & 7)
        return None, None

    def _set(self, x, y, c):
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return
        if self.format == RGB565:
            i = (y * self.stride + x) * 2
            self.buf[i] = c & 255
            self.buf[i + 1] = (c >> 8) & 255
            return
        if self.format == GS8:
            self.buf[y * self.stride + x] = c & 255
            return
        i, b = self._idx(x, y)
        if c:
            self.buf[i] |= b
        else:
            self.buf[i] &= ~b & 255

    def _get(self, x, y):
        if x < 0 or y < 0 or x >= self.width or y >= self.height:
            return 0
        if self.format == RGB565:
            i = (y * self.stride + x) * 2
            return self.buf[i] | (self.buf[i + 1] << 8)
        if self.format == GS8:
            return self.buf[y * self.stride + x]
        i, b = self._idx(x, y)
        return 1 if self.buf[i] & b else 0

    def pixel(self, x, y, c=None):
        if c is None:
            return self._get(x, y)
        self._set(x, y, c)

    def fill(self, c):
        if self.format in (MONO_VLSB, MONO_HLSB, MONO_HMSB):
            v = 255 if c else 0
            for i in range(len(self.buf)):
                self.buf[i] = v
        else:
            for y in range(self.height):
                for x in range(self.width):
                    self._set(x, y, c)

    def fill_rect(self, x, y, w, h, c):
        for yy in range(max(0, y), min(self.height, y + h)):
            for xx in range(max(0, x), min(self.width, x + w)):
                self._set(xx, yy, c)

    def hline(self, x, y, w, c):
        self.fill_rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.fill_rect(x, y, 1, h, c)

    def rect(self, x, y, w, h, c, f=False):
        if f:
            self.fill_rect(x, y, w, h, c)
            return
        self.hline(x, y, w, c)
        self.hline(x, y + h - 1, w, c)
        self.vline(x, y, h, c)
        self.vline(x + w - 1, y, h, c)

    def line(self, x0, y0, x1, y1, c):
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        n = 0
        while n < 4096:
            n += 1
            self._set(x0, y0, c)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, cx, cy, xr, yr, c, f=False, m=15):
        import math
        if xr <= 0 and yr <= 0:
            self._set(cx, cy, c)
            return
        for y in range(-yr, yr + 1):
            for x in range(-xr, xr + 1):
                d = (x * x) / max(1, xr * xr) + (y * y) / max(1, yr * yr)
                if (f and d <= 1.0) or (not f and 0.75 <= d <= 1.15):
                    self._set(cx + x, cy + y, c)

    def poly(self, x, y, coords, c, f=False):
        pts = [(coords[i], coords[i + 1]) for i in range(0, len(coords) - 1, 2)]
        for i in range(len(pts)):
            a = pts[i]
            b = pts[(i + 1) % len(pts)]
            self.line(x + a[0], y + a[1], x + b[0], y + b[1], c)

    def text(self, s, x, y, c=1):
        for ch in str(s):
            o = ord(ch)
            if 32 <= o <= 126:
                base = (o - 32) * 5
                for col in range(5):
                    bits = _FONT[base + col]
                    for row in range(8):
                        if bits & (1 << row):
                            self._set(x + col + 1, y + row, c)
            x += 8

    def scroll(self, dx, dy):
        w, h = self.width, self.height
        old = [[self._get(x, y) for x in range(w)] for y in range(h)]
        for y in range(h):
            for x in range(w):
                sx, sy = x - dx, y - dy
                if 0 <= sx < w and 0 <= sy < h:
                    self._set(x, y, old[sy][sx])

    def blit(self, fbuf, x, y, key=-1, palette=None):
        for yy in range(fbuf.height):
            for xx in range(fbuf.width):
                c = fbuf._get(xx, yy)
                if palette is not None:
                    c = palette._get(c, 0)
                if c != key:
                    self._set(x + xx, y + yy, c)


def FrameBuffer1(*a, **k):
    return FrameBuffer(*a, **k)
`;

PY_SIM.neopixel = String.raw`import pbhw


class NeoPixel:
    ORDER = (1, 0, 2, 3)

    def __init__(self, pin, n, bpp=3, timing=1):
        self.pin = pin
        self.n = n
        self.bpp = bpp
        self.buf = bytearray(n * bpp)
        if hasattr(pin, 'init'):
            self.pin.init(pin.OUT)

    def __len__(self):
        return self.n

    def __setitem__(self, i, v):
        o = i * self.bpp
        for j in range(self.bpp):
            self.buf[o + self.ORDER[j]] = int(v[j]) & 255

    def __getitem__(self, i):
        o = i * self.bpp
        return tuple(self.buf[o + self.ORDER[j]] for j in range(self.bpp))

    def fill(self, v):
        for i in range(self.n):
            self[i] = v

    def write(self):
        pid = self.pin._id if hasattr(self.pin, '_id') else self.pin._n
        pbhw.neopixel_write(pid, bytes(self.buf).decode('latin-1'))

    show = write

    def clear(self):
        self.fill((0, 0, 0))
        self.write()
`;

PY_SIM.dht = String.raw`import pbhw


class DHTBase:
    def __init__(self, pin):
        self.pin = pin
        self._t = None
        self._h = None

    def measure(self):
        r = pbhw.dht_read(self.pin._id)
        if r is None:
            raise OSError(110, 'ETIMEDOUT')
        r = r.to_py()
        self._t, self._h = float(r[0]), float(r[1])


class DHT11(DHTBase):
    def temperature(self):
        return int(round(self._t))

    def humidity(self):
        return int(round(self._h))


class DHT22(DHTBase):
    def temperature(self):
        return round(self._t, 1)

    def humidity(self):
        return round(self._h, 1)
`;

PY_SIM.onewire = String.raw`import pbhw


class OneWireError(Exception):
    pass


class OneWire:
    def __init__(self, pin):
        self.pin = pin

    def reset(self, required=False):
        ok = bool(pbhw.ow_scan(self.pin._id))
        if required and not ok:
            raise OneWireError
        return ok

    def scan(self):
        s = pbhw.ow_scan(self.pin._id)
        return [bytearray(bytes.fromhex(x)) for x in s.split(',') if x]
`;

PY_SIM.ds18x20 = String.raw`import pbhw


class DS18X20:
    def __init__(self, onewire):
        self.ow = onewire

    def scan(self):
        return [r for r in self.ow.scan() if r[0] in (0x10, 0x22, 0x28)]

    def convert_temp(self):
        self.ow.reset(True)

    def read_temp(self, rom):
        t = pbhw.ds_temp(self.ow.pin._id, bytes(rom).hex())
        if t is None:
            raise Exception('CRC error')
        return float(t)
`;

PY_SIM._thread = String.raw`import _pbrt


def start_new_thread(fn, args, kwargs=None):
    _pbrt.spawn(fn, tuple(args))
    return 1


class _Lock:
    def __init__(self):
        self._l = False

    def acquire(self, *a):
        self._l = True
        return True

    def release(self):
        self._l = False

    def locked(self):
        return self._l

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *a):
        self.release()


def allocate_lock():
    return _Lock()


def get_ident():
    return 1
`;

PY_SIM.rp2 = String.raw`import pbhw


def bootsel_button():
    return int(pbhw.bootsel())


class PIO:
    def __init__(self, *a):
        raise NotImplementedError('PIO는 시뮬레이터에서 지원하지 않습니다')


class StateMachine(PIO):
    pass


def asm_pio(*a, **k):
    def d(f):
        return f
    return d
`;

PY_SIM.framebuf = PY_SIM.framebuf.replace('__FONT__', "b'" + FONT5x7.map(b => '\\x' + b.toString(16).padStart(2, '0')).join('') + "'");

// 보드별 모듈 분리: 공통(/pblib), Pico 전용(/pbpico), ESP32 전용(/pbesp)
const PY_PICO = {};
for (const k of ['machine', 'dht', 'onewire', 'ds18x20', '_thread', 'rp2']) { PY_PICO[k] = PY_SIM[k]; delete PY_SIM[k]; }

const PY_ESP = { machine: PY_PICO.machine, dht: PY_PICO.dht, onewire: PY_PICO.onewire, ds18x20: PY_PICO.ds18x20, _thread: PY_PICO._thread };
PY_ESP.network = String.raw`# network 모듈 (시뮬레이터: 가상 WiFi)
import pbhw

STA_IF = 0
AP_IF = 1
STAT_IDLE = 1000
STAT_CONNECTING = 1001
STAT_GOT_IP = 1010
_st = {'active': False, 't0': None, 'ssid': None}


class WLAN:
    def __init__(self, interface_id=STA_IF):
        self._if = interface_id

    def active(self, v=None):
        if v is None:
            return _st['active']
        _st['active'] = bool(v)
        if not v:
            _st['t0'] = None
            pbhw.esp_wifi('')

    def connect(self, ssid=None, key=None, **kw):
        if not _st['active']:
            raise OSError('Wifi Internal Error')
        _st['ssid'] = ssid
        _st['t0'] = pbhw.now_ms()
        pbhw.esp_wifi('connecting')

    def disconnect(self):
        _st['t0'] = None
        pbhw.esp_wifi('')

    def isconnected(self):
        if self._if == AP_IF:
            return _st['active']
        ok = _st['t0'] is not None and pbhw.now_ms() - _st['t0'] > 1500
        if ok:
            pbhw.esp_wifi('connected')
        return ok

    def status(self, *a):
        if a:
            return -60 if a[0] == 'rssi' else None
        if self.isconnected():
            return STAT_GOT_IP
        return STAT_CONNECTING if _st['t0'] is not None else STAT_IDLE

    def ifconfig(self, *a):
        if self._if == AP_IF:
            return ('192.168.4.1', '255.255.255.0', '192.168.4.1', '8.8.8.8')
        if self.isconnected():
            return ('192.168.0.57', '255.255.255.0', '192.168.0.1', '8.8.8.8')
        return ('0.0.0.0', '0.0.0.0', '0.0.0.0', '0.0.0.0')

    def scan(self):
        return [(b'MyWiFi', b'\x12\x34\x56\x78\x9a\xbc', 6, -48, 3, False), (b'Guest', b'\x22\x34\x56\x78\x9a\xbd', 11, -71, 0, False)]

    def config(self, *a, **k):
        if a and a[0] == 'mac':
            return b'\x24\x0a\xc4\x12\x34\x56'
        if a and a[0] in ('ssid', 'essid'):
            return _st['ssid'] or ''
        return None
`;
PY_ESP.esp32 = String.raw`# esp32 모듈 (일부)
import pbhw


def raw_temperature():
    return int(pbhw.esp_temp() * 1.8 + 32)


def mcu_temperature():
    return int(pbhw.esp_temp())


def hall_sensor():
    return 0


def wake_on_ext0(*a, **k):
    pass


def wake_on_touch(*a):
    pass


class NVS:
    _d = {}

    def __init__(self, ns):
        self._ns = ns

    def set_i32(self, k, v):
        NVS._d[(self._ns, k)] = v

    def get_i32(self, k):
        return NVS._d[(self._ns, k)]

    def commit(self):
        pass
`;
PY_ESP.esp = String.raw`def osdebug(*a):
    pass


def flash_size():
    return 4194304
`;
