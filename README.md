# 🍓 picoBuilder

Raspberry Pi Pico용 **노드 기반 MicroPython 코드 빌더**입니다. 브라우저에서 회로를 배선하고, 프로그램을 노드로 연결해 코드를 만들고, 시뮬레이터로 실행한 뒤 실제 Pico에 업로드할 수 있습니다.

**▶ 실행: https://samcho93.github.io/picoBuilder/**

## 주요 기능

| 기능 | 설명 |
|---|---|
| Pico 핀맵 노드 | 실제 보드의 물리 핀 배열(왼쪽 1~20, 오른쪽 21~40)을 그대로 사용합니다. GPIO, 3V3, VBUS, VSYS, GND를 포함한 모든 핀을 배선할 수 있고, 핀에 마우스를 올리면 I2C, SPI, UART, ADC, PWM 대체 기능이 표시됩니다. |
| 노드 기반 프로그래밍 | 이벤트 노드(시작, 무한 반복, 타이머, 핀 인터럽트, 버튼 눌림)의 ▶ 실행 흐름에 동작 노드를 연결합니다. ● 값 포트에는 센서, 연산, 변수 노드를 연결합니다. |
| 하드웨어 모듈 | 기본 입출력: LED, RGB LED, 버튼, 스위치, 가변저항, 조이스틱, 부저, 서보, 릴레이, WS2812<br>센서: PIR, LDR, DHT11/22, DS18B20, HC-SR04 |
| 통신 모듈 | I2C: SSD1306 OLED, LCD1602(PCF8574), AHT20, MPU6050, BH1750, DS3231<br>SPI: MAX7219, MCP3008<br>UART: NEO-6M GPS, HC-05 |
| 회로 → 코드 | 배선을 분석해 `I2C(0, sda=Pin(20), scl=Pin(21))` 같은 초기화 코드를 자동으로 만듭니다. 하드웨어 버스로 쓸 수 없는 핀 조합이면 SoftI2C/SoftSPI를 사용합니다. |
| Python 에디터 | CodeMirror 기반입니다. 코드를 직접 수정할 수 있고, `.py` 파일로 저장하거나 열 수 있습니다. |
| 시뮬레이터 | Pyodide 위에서 `machine`, `time`, `framebuf`, `neopixel`, `dht`, `onewire`, `ds18x20` 모듈을 에뮬레이션합니다. 전압과 네트를 계산해 전원 미연결이나 단락(short)을 감지하고, I2C·SPI·UART 프로토콜을 레지스터 수준으로 처리합니다. |
| Pico 연동 | Web Serial(Chrome/Edge)로 보드에 연결합니다. `main.py`와 필요한 드라이버(`/lib/*.py`)를 업로드하거나 바로 실행할 수 있고, REPL 콘솔도 제공합니다. |
| 저장 | 브라우저에 자동 저장됩니다. 프로젝트는 `.pbproj.json`, 코드는 `main.py`로 저장할 수 있습니다. |

## 사용법

1. 왼쪽 팔레트에서 모듈과 노드를 캔버스로 드래그합니다.
2. 포트를 끌어 다른 포트에 연결합니다.
   - 하드웨어 핀 사이의 연결은 실선입니다.
   - 핀 참조와 모듈 참조(◆)는 점선입니다.
3. `F5`로 시뮬레이션을 실행합니다. 노드 안의 버튼, 슬라이더, 센서 값을 조작할 수 있습니다.
4. **🔌 연결** → **⬆ 업로드** 순서로 실제 Pico에 프로그램을 씁니다. 보드에 MicroPython 펌웨어가 설치되어 있어야 합니다.

**단축키**

| 키 | 동작 |
|---|---|
| F5 / Shift+F5 | 실행 / 정지 |
| Ctrl+S | 저장 |
| Ctrl+O | 열기 |
| Ctrl+Z / Ctrl+Y | 실행 취소 / 다시 실행 |
| Delete | 삭제 |
| Ctrl+D | 복제 |

## 로컬 실행

빌드 과정이 없는 정적 웹앱입니다.

```bash
python -m http.server 8765
```

서버를 띄운 뒤 http://localhost:8765 에 접속합니다.

## 구조

```
index.html        UI 레이아웃
css/style.css     스타일
js/pinmap.js      Pico 물리 핀맵 / 버스 판정
js/devices.js     하드웨어 모듈 정의 + 프로토콜 에뮬레이터
js/sim.js         네트 계산, GPIO 상태, pbhw 브리지
js/nodes.js       프로그램 노드 + 그래프 → MicroPython 코드 생성
js/pylib.js       Python 모듈 (시뮬레이터용 machine 등, 업로드용 드라이버)
js/runtime.js     Pyodide 런타임
js/serial.js      Web Serial raw REPL 업로더
js/editor.js      노드 캔버스
js/examples.js    예제 프로젝트
js/app.js         앱 통합
```

## Prompt

해당 폴더에 웹기반의 코드빌더 제작.

1. raspberryPi Pico 기반의 프로그램 작성.
2. Pico는 하드웨어 기반의 핀맵을 유지 함. 양쪽의 핀이 순서대로 내열. 전원을 포함한 모든 포트는 다른 블록과 연결이 가능.
3. 프로그램을 위한 주요 코드는 블록기반으로 연결이 되며,
4. pico와 연결해서 사용할 수 있는 다양한 IO 모듈(LED, 스위치, 센서) 등을 연결 할 수 있어야 함.
5. 다양한 통신을 지원하는 I2C, SPI, UART등의 디바이스 모듈을 상용모듈을 참고해서 만들어서 노드로 연결해서 사용함.
6. 이를 구현하기 위한 파이썬 기반의 에디터를 직접 내장하고, 실행도 가능해야 함. 실행은 시뮬레이터 형태로 가능해야 하며,
7. 작성한 파이썬 코드는 저장이 가능해야 함. 
8. 빌더와 외부 pico 모듈을 직접 연동해서 프로그램을 다운로드할 수 있어햐 함.
9. Blockly 형태가 아닌 기존에 작업을 해왔던 방식의 노드 기반의 블럭형태여야 함
