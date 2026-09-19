// micro:bit V2 시뮬레이터 모듈 + micro:bit 업로드용 호환 라이브러리
'use strict';

// micro:bit에서 machine 스타일 드라이버(ssd1306 등)를 쓰기 위한 어댑터 (실제 보드에도 업로드됨)
PY_DRIVERS.mbcompat = String.raw`# micro:bit <-> machine 스타일 드라이버 호환 어댑터 (picoBuilder)
from microbit import i2c, spi, pin13, pin14, pin15, pin19, pin20


class MbI2C:
    def __init__(self, sda=pin20, scl=pin19, freq=100000):
        i2c.init(freq=freq, sda=sda, scl=scl)

    def scan(self):
        return i2c.scan()

    def writeto(self, addr, buf, stop=True):
        i2c.write(addr, bytes(buf), not stop)
        return len(buf)

    def writevto(self, addr, vector, stop=True):
        return self.writeto(addr, b''.join([bytes(v) for v in vector if v is not None]), stop)

    def readfrom(self, addr, n, stop=True):
        return i2c.read(addr, n, not stop)

    def readfrom_into(self, addr, buf, stop=True):
        d = i2c.read(addr, len(buf), not stop)
        for i in range(len(d)):
            buf[i] = d[i]

    def readfrom_mem(self, addr, reg, n, addrsize=8):
        i2c.write(addr, bytes([reg]), True)
        return i2c.read(addr, n)

    def readfrom_mem_into(self, addr, reg, buf, addrsize=8):
        d = self.readfrom_mem(addr, reg, len(buf))
        for i in range(len(d)):
            buf[i] = d[i]

    def writeto_mem(self, addr, reg, buf, addrsize=8):
        i2c.write(addr, bytes([reg]) + bytes(buf))


class MbSPI:
    def __init__(self, baudrate=1000000, sck=pin13, mosi=pin15, miso=pin14):
        spi.init(baudrate=baudrate, bits=8, mode=0, sclk=sck, mosi=mosi, miso=miso)

    def write(self, buf):
        spi.write(bytes(buf))

    def read(self, n, write=0):
        return spi.read(n, write)

    def readinto(self, buf, write=0):
        d = spi.read(len(buf), write)
        for i in range(len(d)):
            buf[i] = d[i]

    def write_readinto(self, out, inbuf):
        spi.write_readinto(out, inbuf)


class MbPin:
    IN = 0
    OUT = 1

    def __init__(self, pin):
        self.p = pin

    def init(self, mode=-1, pull=-1, value=None):
        if value is not None:
            self.value(value)

    def value(self, v=None):
        if v is None:
            return self.p.read_digital()
        self.p.write_digital(1 if v else 0)

    def __call__(self, v=None):
        return self.value(v)

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)
`;

// micro:bit에는 framebuf가 없으므로 순수 Python 구현을 함께 업로드
PY_DRIVERS.framebuf = PY_SIM.framebuf;

const PY_MB = {};

PY_MB.microbit = String.raw`# microbit 모듈 에뮬레이션 (BBC micro:bit V2)
import pbhw, _pbrt, asyncio, math, time, sys

_ANALOG = (0, 1, 2, 3, 4, 10)
_FONT7 = __FONT__


class MicroBitPin:
    NO_PULL = 0
    PULL_UP = 1
    PULL_DOWN = 2

    def __init__(self, n):
        self._n = n
        self._pull = 0 if n in (0, 1, 2, 5, 11) else 2
        self._period = 20000
        self._duty = 0
        self._mode = 'unused'

    def write_digital(self, v):
        self._mode = 'write_digital'
        pbhw.pin_init(self._n, 1, 0)
        pbhw.pin_write(self._n, 1 if v else 0)

    def read_digital(self):
        if self._mode != 'read_digital':
            self._mode = 'read_digital'
            pbhw.pin_init(self._n, 0, self._pull)
        return int(pbhw.pin_read(self._n))

    def set_pull(self, p):
        self._pull = p
        self._mode = 'read_digital'
        pbhw.pin_init(self._n, 0, p)

    def get_pull(self):
        return self._pull

    def get_mode(self):
        return self._mode

    def read_analog(self):
        if self._n not in _ANALOG:
            raise ValueError('Pin %d does not support analog input' % self._n)
        self._mode = 'read_analog'
        pbhw.pin_init(self._n, 0, 0)
        return int(pbhw.adc_pin(self._n)) >> 6

    def write_analog(self, v):
        self._duty = max(0, min(1023, int(v)))
        self._mode = 'write_analog'
        pbhw.pwm_set(self._n, 1000000 / self._period, self._duty * 64)

    def set_analog_period(self, ms):
        self.set_analog_period_microseconds(int(ms * 1000))

    def set_analog_period_microseconds(self, us):
        self._period = max(256, int(us))
        if self._mode == 'write_analog':
            self.write_analog(self._duty)

    def get_analog_period_microseconds(self):
        return self._period

    def is_touched(self):
        return bool(pbhw.mb_touched(self._n))

    def set_touch_mode(self, m):
        pass

    CAPACITIVE = 1
    RESISTIVE = 0


for _i in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19, 20):
    globals()['pin%d' % _i] = MicroBitPin(_i)
del _i


class _Logo:
    def is_touched(self):
        return bool(pbhw.mb_state().to_py()[7])


pin_logo = _Logo()
pin_speaker = pin0


# ---------------- Image ----------------
class Image:
    def __init__(self, *a):
        if not a:
            self._w, self._h, self._p = 5, 5, bytearray(25)
        elif isinstance(a[0], str):
            s = a[0]
            rows = s.split(':') if ':' in s else s.split('\n')
            rows = [r for r in rows if r != '']
            self._h = len(rows)
            self._w = max(len(r) for r in rows) if rows else 0
            self._p = bytearray(self._w * self._h)
            for y, r in enumerate(rows):
                for x, ch in enumerate(r):
                    self._p[y * self._w + x] = int(ch) if ch.isdigit() else 0
        else:
            self._w, self._h = int(a[0]), int(a[1])
            self._p = bytearray(a[2]) if len(a) > 2 else bytearray(self._w * self._h)

    def width(self):
        return self._w

    def height(self):
        return self._h

    def get_pixel(self, x, y):
        return self._p[y * self._w + x]

    def set_pixel(self, x, y, v):
        self._p[y * self._w + x] = max(0, min(9, int(v)))

    def copy(self):
        return Image(self._w, self._h, bytes(self._p))

    def invert(self):
        return Image(self._w, self._h, bytes(9 - v for v in self._p))

    def fill(self, v):
        for i in range(len(self._p)):
            self._p[i] = v

    def shift_left(self, n):
        return self._shift(n, 0)

    def shift_right(self, n):
        return self._shift(-n, 0)

    def shift_up(self, n):
        return self._shift(0, n)

    def shift_down(self, n):
        return self._shift(0, -n)

    def _shift(self, dx, dy):
        im = Image(self._w, self._h)
        for y in range(self._h):
            for x in range(self._w):
                sx, sy = x + dx, y + dy
                if 0 <= sx < self._w and 0 <= sy < self._h:
                    im._p[y * self._w + x] = self._p[sy * self._w + sx]
        return im

    def crop(self, x, y, w, h):
        im = Image(w, h)
        for yy in range(h):
            for xx in range(w):
                if 0 <= x + xx < self._w and 0 <= y + yy < self._h:
                    im._p[yy * w + xx] = self._p[(y + yy) * self._w + x + xx]
        return im

    def __add__(self, o):
        return Image(self._w, self._h, bytes(min(9, a + b) for a, b in zip(self._p, o._p)))

    def __mul__(self, k):
        return Image(self._w, self._h, bytes(min(9, int(a * k)) for a in self._p))

    def __repr__(self):
        return "Image('" + ':'.join(''.join(str(self._p[y * self._w + x]) for x in range(self._w)) for y in range(self._h)) + ":')"


_IMG = {
    'HEART': '09090:99999:99999:09990:00900', 'HEART_SMALL': '00000:09090:09990:00900:00000',
    'HAPPY': '00000:09090:00000:90009:09990', 'SMILE': '00000:00000:00000:90009:09990', 'SAD': '00000:09090:00000:09990:90009',
    'CONFUSED': '00000:09090:00000:09090:90909', 'ANGRY': '90009:09090:00000:99999:90909', 'ASLEEP': '00000:99099:00000:09990:00000',
    'SURPRISED': '09090:00000:00900:09090:00900', 'SILLY': '90009:00000:99999:00909:00999', 'FABULOUS': '99999:99099:00000:09090:09990',
    'MEH': '09090:00000:00090:00900:09000', 'YES': '00000:00009:00090:90900:09000', 'NO': '90009:09090:00900:09090:90009',
    'ARROW_N': '00900:09990:90909:00900:00900', 'ARROW_NE': '00999:00099:00909:09000:90000', 'ARROW_E': '00900:00090:99999:00090:00900',
    'ARROW_SE': '90000:09000:00909:00099:00999', 'ARROW_S': '00900:00900:90909:09990:00900', 'ARROW_SW': '00009:00090:90900:99000:99900',
    'ARROW_W': '00900:09000:99999:09000:00900', 'ARROW_NW': '99900:99000:90900:00090:00009',
    'SQUARE': '99999:90009:90009:90009:99999', 'SQUARE_SMALL': '00000:09990:09090:09990:00000', 'DIAMOND': '00900:09090:90009:09090:00900',
    'DIAMOND_SMALL': '00000:00900:09090:00900:00000', 'TRIANGLE': '00000:00900:09090:99999:00000', 'TRIANGLE_LEFT': '90000:99000:90900:90090:99999',
    'CHESSBOARD': '09090:90909:09090:90909:09090', 'SKULL': '09990:90909:99999:09990:09990', 'GHOST': '99999:90909:99999:99999:90909',
    'DUCK': '09900:99900:09999:09990:00000', 'TSHIRT': '99099:99999:09990:09990:09990', 'PACMAN': '09999:99090:99900:99990:09999',
    'TARGET': '00900:09990:99099:09990:00900', 'HOUSE': '00900:09990:99999:09990:09090', 'MUSIC_QUAVER': '00900:00990:00909:99900:99900',
    'MUSIC_CROTCHET': '00900:00900:00900:99900:99900', 'SNAKE': '99000:99099:09090:09990:00000', 'RABBIT': '90900:90900:99990:99090:99990',
    'BUTTERFLY': '99099:99999:00900:99999:99099', 'SWORD': '00900:00900:00900:09990:00900', 'UMBRELLA': '09990:99999:00900:90900:09900',
    'COW': '90009:90009:99999:09990:00900', 'GIRAFFE': '99000:09000:09000:09990:09090', 'TORTOISE': '00000:09990:99999:09090:00000',
    'STICKFIGURE': '00900:99999:00900:09090:90009', 'ROLLERSKATE': '00099:00099:99999:99999:09090', 'XMAS': '00900:09990:00900:09990:99999',
    'PITCHFORK': '90909:90909:99999:00900:00900', 'SCISSORS': '99009:99090:00900:99090:99009',
}
for _k, _v in _IMG.items():
    setattr(Image, _k, Image(_v))
Image.ALL_ARROWS = [Image.ARROW_N, Image.ARROW_NE, Image.ARROW_E, Image.ARROW_SE, Image.ARROW_S, Image.ARROW_SW, Image.ARROW_W, Image.ARROW_NW]
Image.ALL_CLOCKS = [Image('00900:00900:00900:00000:00000:')] * 12


def _glyph_cols(ch):
    o = ord(ch)
    if o < 32 or o > 126:
        o = 63
    base = (o - 32) * 5
    cols = []
    for c in range(5):
        b = _FONT7[base + c]
        v = 0
        for r, rows in enumerate(((0,), (1, 2), (3,), (4, 5), (6,))):
            if any(b & (1 << q) for q in rows):
                v |= 1 << r
        cols.append(v)
    return cols


def _char_img(ch):
    im = Image()
    for x, v in enumerate(_glyph_cols(ch)):
        for y in range(5):
            if v & (1 << y):
                im._p[y * 5 + x] = 9
    return im


# ---------------- Display ----------------
class _Display:
    def __init__(self):
        self._px = bytearray(25)
        self._on = True
        self._task = None
        self._push()

    def _push(self):
        pbhw.mb_display(''.join(str(v) for v in self._px) if self._on else '')

    def _cancel(self):
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    def _bg(self, coro):
        self._task = asyncio.ensure_future(_pbrt._guard(coro))

    def _img(self, im, x0=0):
        for y in range(5):
            for x in range(5):
                xx = x + x0
                self._px[y * 5 + x] = im.get_pixel(xx, y) if 0 <= xx < im.width() and y < im.height() else 0
        self._push()

    def show(self, v, delay=400, *, wait=True, loop=False, clear=False, monospace=False):
        self._cancel()
        if isinstance(v, Image):
            self._img(v)
            return None
        if isinstance(v, (int, float)):
            v = str(v)
        if isinstance(v, str):
            if len(v) == 1:
                self._img(_char_img(v))
                return None
            frames = [_char_img(c) for c in v]
        else:
            frames = [x if isinstance(x, Image) else _char_img(str(x)[:1] or ' ') for x in v]
        coro = self._frames(frames, delay, loop, clear)
        if wait:
            return coro
        self._bg(coro)

    async def _frames(self, frames, delay, loop, clear):
        while True:
            for f in frames:
                self._img(f)
                await _pbrt.asleep_ms(delay)
            if not loop:
                break
        if clear:
            self.clear()

    def scroll(self, text, delay=150, *, wait=True, loop=False, monospace=False):
        self._cancel()
        cols = [0] * 5
        for ch in str(text):
            g = _glyph_cols(ch)
            if not monospace:
                while g and g[0] == 0 and ch != ' ':
                    g = g[1:]
                while g and g[-1] == 0 and ch != ' ':
                    g = g[:-1]
                if ch == ' ':
                    g = [0, 0, 0]
            cols += g + [0]
        cols += [0] * 5
        coro = self._scroll(cols, delay, loop)
        if wait:
            return coro
        self._bg(coro)

    async def _scroll(self, cols, delay, loop):
        while True:
            for i in range(len(cols) - 4):
                for y in range(5):
                    for x in range(5):
                        self._px[y * 5 + x] = 9 if cols[i + x] & (1 << y) else 0
                self._push()
                await _pbrt.asleep_ms(delay)
            if not loop:
                break

    def clear(self):
        self._cancel()
        for i in range(25):
            self._px[i] = 0
        self._push()

    def set_pixel(self, x, y, v):
        if not (0 <= x < 5 and 0 <= y < 5):
            raise ValueError('index out of bounds')
        self._px[y * 5 + x] = max(0, min(9, int(v)))
        self._push()

    def get_pixel(self, x, y):
        return self._px[y * 5 + x]

    def on(self):
        self._on = True
        self._push()

    def off(self):
        self._on = False
        self._push()

    def is_on(self):
        return self._on

    def read_light_level(self):
        return int(pbhw.mb_state().to_py()[4])


display = _Display()


# ---------------- Buttons / sensors ----------------
class _Button:
    def __init__(self, pin, key):
        self._pin = pin
        self._k = key

    def is_pressed(self):
        return int(pbhw.pin_read(self._pin)) == 0

    def was_pressed(self):
        return int(pbhw.mb_presses(self._k, True)) > 0

    def get_presses(self):
        return int(pbhw.mb_presses(self._k, True))


button_a = _Button(5, 'A')
button_b = _Button(11, 'B')


class _Accelerometer:
    def __init__(self):
        self._last = None
        self._hist = []

    def get_values(self):
        s = pbhw.mb_state().to_py()
        return (int(s[0]), int(s[1]), int(s[2]))

    def get_x(self):
        return self.get_values()[0]

    def get_y(self):
        return self.get_values()[1]

    def get_z(self):
        return self.get_values()[2]

    def get_strength(self):
        x, y, z = self.get_values()
        return int(math.sqrt(x * x + y * y + z * z))

    def current_gesture(self):
        x, y, z = self.get_values()
        if math.sqrt(x * x + y * y + z * z) > 2300:
            g = 'shake'
        elif x < -500:
            g = 'left'
        elif x > 500:
            g = 'right'
        elif y < -500:
            g = 'up'
        elif y > 500:
            g = 'down'
        elif z < -800:
            g = 'face up'
        elif z > 800:
            g = 'face down'
        else:
            g = ''
        if g != self._last:
            self._last = g
            if g:
                self._hist.append(g)
        return g

    def is_gesture(self, name):
        return self.current_gesture() == name

    def was_gesture(self, name):
        self.current_gesture()
        if name in self._hist:
            self._hist = []
            return True
        return False

    def get_gestures(self):
        self.current_gesture()
        h = tuple(self._hist)
        self._hist = []
        return h

    def set_range(self, v):
        pass


accelerometer = _Accelerometer()


class _Compass:
    def heading(self):
        return int(pbhw.mb_state().to_py()[6])

    def calibrate(self):
        pass

    def is_calibrated(self):
        return True

    def clear_calibration(self):
        pass

    def get_field_strength(self):
        return 50000

    def get_x(self):
        return int(40000 * math.sin(math.radians(self.heading())))

    def get_y(self):
        return int(40000 * math.cos(math.radians(self.heading())))

    def get_z(self):
        return 0


compass = _Compass()


class SoundEvent:
    LOUD = 'loud'
    QUIET = 'quiet'


class _Microphone:
    def sound_level(self):
        return int(pbhw.mb_state().to_py()[5])

    def current_event(self):
        return SoundEvent.LOUD if self.sound_level() > 128 else SoundEvent.QUIET

    def was_event(self, e):
        return self.current_event() == e

    def is_event(self, e):
        return self.current_event() == e

    def set_threshold(self, e, v):
        pass


microphone = _Microphone()


class _Speaker:
    def __init__(self):
        self._on = True

    def on(self):
        self._on = True

    def off(self):
        self._on = False

    def is_on(self):
        return self._on


speaker = _Speaker()


def temperature():
    return int(pbhw.mb_state().to_py()[3])


def running_time():
    return int(pbhw.run_ms())


def sleep(ms):
    _pbrt.busy_wait(ms / 1000)


def set_volume(v):
    pass


def scale(value, from_, to):
    a, b = from_
    c, d = to
    return (value - a) * (d - c) / (b - a) + c


def panic(n=0):
    raise SystemExit('panic(%d)' % n)


def reset():
    raise SystemExit('reset()')


# ---------------- 통신 ----------------
class _I2C:
    def __init__(self):
        self._sda, self._scl = 20, 19

    def init(self, freq=100000, sda=pin20, scl=pin19):
        self._sda, self._scl = sda._n, scl._n

    def scan(self):
        return list(pbhw.i2c_scan(self._sda, self._scl).encode('latin-1'))

    def read(self, addr, n, repeat=False):
        r = pbhw.i2c_read(self._sda, self._scl, addr, n)
        if r is None:
            raise OSError(19)
        return r.encode('latin-1')

    def write(self, addr, buf, repeat=False):
        r = pbhw.i2c_write(self._sda, self._scl, addr, bytes(buf).decode('latin-1'))
        if r < 0:
            raise OSError(19)


i2c = _I2C()


class _SPI:
    def __init__(self):
        self._sck, self._mosi, self._miso = 13, 15, 14

    def init(self, baudrate=1000000, bits=8, mode=0, sclk=pin13, mosi=pin15, miso=pin14):
        self._sck, self._mosi, self._miso = sclk._n, mosi._n, miso._n

    def _x(self, s):
        return pbhw.spi_xfer(self._sck, self._mosi, self._miso, s).encode('latin-1')

    def write(self, buf):
        self._x(bytes(buf).decode('latin-1'))

    def read(self, n, out=0):
        return self._x(chr(out & 255) * n)

    def write_readinto(self, out, inbuf):
        d = self._x(bytes(out).decode('latin-1'))
        for i in range(len(d)):
            inbuf[i] = d[i]


spi = _SPI()


class _UART:
    ODD = 1
    EVEN = 0

    def __init__(self):
        self._tx = self._rx = None
        self._baud = 115200
        self._buf = bytearray()

    def init(self, baudrate=9600, bits=8, parity=None, stop=1, *, pins=None, tx=None, rx=None):
        self._baud = baudrate
        self._tx = tx._n if tx is not None else None
        self._rx = rx._n if rx is not None else None

    def _pull(self):
        if self._rx is None:
            return
        s = pbhw.uart_read(self._rx, self._baud)
        if s:
            self._buf += s.encode('latin-1')

    def any(self):
        self._pull()
        return len(self._buf) > 0

    def read(self, n=None):
        self._pull()
        if not self._buf:
            return None
        if n is None or n >= len(self._buf):
            d, self._buf = bytes(self._buf), bytearray()
        else:
            d, self._buf = bytes(self._buf[:n]), self._buf[n:]
        return d

    def readall(self):
        return self.read()

    def readline(self):
        self._pull()
        i = self._buf.find(b'\n')
        if i < 0:
            return None
        d, self._buf = bytes(self._buf[:i + 1]), self._buf[i + 1:]
        return d

    def readinto(self, buf, nbytes=None):
        d = self.read(nbytes or len(buf))
        if not d:
            return None
        for i in range(len(d)):
            buf[i] = d[i]
        return len(d)

    def write(self, buf):
        if isinstance(buf, str):
            buf = buf.encode()
        if self._tx is None:
            sys.stdout.write(bytes(buf).decode('utf-8', 'replace'))
        else:
            pbhw.uart_write(self._tx, self._baud, bytes(buf).decode('latin-1'))
        return len(buf)


uart = _UART()
`;

PY_MB.music = String.raw`# music 모듈 에뮬레이션 (micro:bit)
import pbhw, _pbrt, asyncio
from microbit import pin0

_state = {'ticks': 4, 'bpm': 120, 'task': None}
_N = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}

DADADADUM = ['r4:2', 'g', 'g', 'g', 'eb:8', 'r:2', 'f', 'f', 'f', 'd:8']
ENTERTAINER = ['d4:1', 'd#', 'e', 'c5:2', 'e4:1', 'c5:2', 'e4:1', 'c5:3', 'c:1', 'd', 'd#', 'e', 'c', 'd', 'e:2', 'b4:1', 'd5:2', 'c:4']
PRELUDE = ['c4:1', 'e', 'g', 'c5', 'e', 'g4', 'c5', 'e', 'c4', 'e', 'g', 'c5', 'e', 'g4', 'c5', 'e']
ODE = ['e4', 'e', 'f', 'g', 'g', 'f', 'e', 'd', 'c', 'c', 'd', 'e', 'e:6', 'd:2', 'd:8']
NYAN = ['f#5:2', 'g#', 'c#:1', 'd#:2', 'b4:1', 'd5:1', 'c#', 'b4:2', 'b', 'c#5', 'd', 'd:1', 'c#', 'b4:1', 'c#5:1', 'd#', 'f#', 'g#', 'd#', 'f#', 'c#', 'd', 'b4', 'c#5', 'b4']
RINGTONE = ['c4:1', 'd', 'e:2', 'g', 'd:1', 'e', 'f:2', 'a', 'e:1', 'f', 'g:2', 'b', 'c5:4']
FUNK = ['c2:2', 'c', 'd#', 'c:1', 'f:2', 'c:1', 'f:2', 'f#', 'g', 'c', 'c', 'g', 'c:1', 'f#:2', 'c:1', 'f#:2', 'f', 'd#']
BLUES = ['c2:2', 'e', 'g', 'a', 'a#', 'a', 'g', 'e', 'c2:2', 'e', 'g', 'a', 'a#', 'a', 'g', 'e']
BIRTHDAY = ['c4:3', 'c:1', 'd:4', 'c:4', 'f', 'e:8', 'c:3', 'c:1', 'd:4', 'c:4', 'g', 'f:8']
WEDDING = ['c4:4', 'f:3', 'f:1', 'f:8', 'c:4', 'g:3', 'e:1', 'f:8']
FUNERAL = ['c3:4', 'c:3', 'c:1', 'c:4', 'd#:3', 'd:1', 'd:3', 'c:1', 'c:3', 'b2:1', 'c3:4']
PUNCHLINE = ['c4:3', 'g3:1', 'f#', 'g', 'g#:3', 'g', 'r', 'b', 'c4']
PYTHON = ['d5:1', 'b4', 'r', 'b', 'b', 'a#', 'b', 'g5', 'r', 'd', 'd', 'r', 'b4', 'c5', 'r', 'c', 'c', 'r', 'd', 'e:5', 'c:1', 'a4', 'r', 'a', 'a', 'g#', 'a', 'f#5', 'r', 'e', 'e', 'r', 'c', 'b4', 'r', 'b', 'b', 'r', 'c5', 'd:5']
BADDY = ['c3:3', 'r', 'd:2', 'd#', 'r', 'c', 'r', 'f#:8']
CHASE = ['a4:1', 'b', 'c5', 'b4', 'a:2', 'r', 'a:1', 'b', 'c5', 'b4', 'a:2', 'r', 'a:2', 'e5', 'd#', 'e', 'f', 'e', 'd#', 'e', 'b4:1', 'c5', 'd', 'c', 'b4:2', 'r', 'b:1', 'c5', 'd', 'c', 'b4:2', 'r', 'b:2', 'e5', 'd#', 'e', 'f', 'e', 'd#', 'e']
BA_DING = ['b5:1', 'e6:3']
WAWAWAWAA = ['e3:3', 'r:1', 'd#:3', 'r:1', 'd:4', 'r:1', 'c#:8']
JUMP_UP = ['c5:1', 'd', 'e', 'f', 'g']
JUMP_DOWN = ['g5:1', 'f', 'e', 'd', 'c']
POWER_UP = ['g4:1', 'c5', 'e', 'g:2', 'e:1', 'g:3']
POWER_DOWN = ['g5:1', 'd#', 'c', 'g4:2', 'b:1', 'c5:3']


def _parse(seq):
    octave, dur, out = 4, 4, []
    for note in seq:
        note = str(note).lower()
        if ':' in note:
            note, d = note.split(':', 1)
            dur = int(d)
        name = note[:1]
        rest = note[1:]
        semi = 0
        if rest.startswith('#'):
            semi, rest = 1, rest[1:]
        elif rest.startswith('b'):
            semi, rest = -1, rest[1:]
        if rest:
            octave = int(rest)
        ms = 60000 / _state['bpm'] / _state['ticks'] * dur
        if name == 'r' or name not in _N:
            out.append((0, ms))
        else:
            midi = (octave + 1) * 12 + _N[name] + semi
            out.append((440 * 2 ** ((midi - 69) / 12), ms))
    return out


async def _run(seq, pin, loop):
    try:
        while True:
            for f, ms in seq:
                pbhw.mb_tone(pin._n, f)
                await _pbrt.asleep_ms(ms * 0.9)
                pbhw.mb_tone(pin._n, 0)
                await _pbrt.asleep_ms(ms * 0.1)
            if not loop:
                break
    finally:
        pbhw.mb_tone(pin._n, 0)


def _go(coro, wait):
    stop()
    if wait:
        return coro
    _state['task'] = asyncio.ensure_future(_pbrt._guard(coro))


def play(music, pin=pin0, wait=True, loop=False):
    if isinstance(music, str):
        music = [music]
    return _go(_run(_parse(music), pin, loop), wait)


def pitch(frequency, duration=-1, pin=pin0, wait=True):
    stop()
    pbhw.mb_tone(pin._n, frequency)
    if duration < 0:
        return None

    async def _p():
        try:
            await _pbrt.asleep_ms(duration)
        finally:
            pbhw.mb_tone(pin._n, 0)
    if wait:
        return _p()
    _state['task'] = asyncio.ensure_future(_pbrt._guard(_p()))


def stop(pin=pin0):
    t = _state['task']
    if t is not None and not t.done():
        t.cancel()
    _state['task'] = None
    pbhw.mb_tone(pin._n, 0)


def set_tempo(ticks=4, bpm=120):
    _state['ticks'], _state['bpm'] = ticks, bpm


def get_tempo():
    return (_state['ticks'], _state['bpm'])


def reset():
    set_tempo()
`;

PY_MB.machine = String.raw`# micro:bit machine 모듈 (일부)
import pbhw


def time_pulse_us(pin, level, timeout_us=1000000):
    return int(pbhw.pulse_us(pin._n, level, timeout_us))


def freq():
    return 64000000


def unique_id():
    return b'\x9a\x1f\x22\x7c\x51\x0e\x33\x40'


def reset():
    raise SystemExit('machine.reset()')


def disable_irq():
    return 0


def enable_irq(state=0):
    pass
`;

PY_MB.radio = String.raw`# radio 모듈 (시뮬레이터: 다른 micro:bit가 없으므로 수신 없음)
RATE_1MBIT = 1
RATE_2MBIT = 2
_on = [False]


def on():
    _on[0] = True


def off():
    _on[0] = False


def config(**kw):
    pass


def reset():
    pass


def send(msg):
    if not _on[0]:
        raise ValueError('radio is not enabled')


def send_bytes(b):
    send(b)


def receive():
    return None


def receive_bytes():
    return None


def receive_full():
    return None
`;

// micro:bit 폰트를 Python bytes 리터럴로 주입
PY_MB.microbit = PY_MB.microbit.replace('__FONT__', "b'" + FONT5x7.map(b => '\\x' + b.toString(16).padStart(2, '0')).join('') + "'");
