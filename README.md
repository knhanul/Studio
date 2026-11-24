# 고모 편집실 · GOMO Compose v0.1

**고모 미디어공방의 Windows 영상 편집 UI 초기 프로젝트.**

고모 창작실(GOMO Create)이 생성한 `composer_project.json`과 기존 [영상 합성기](https://github.com/knhanul/dubbing)의 Video Composer v2 프로젝트를 열어 편집합니다. UI는 **Electron + React + TypeScript**로 신규 구축했습니다. 영상 합성/녹음은 **기존 Python 소스를 그대로** 사용하도록 별도 브리지를 제공합니다.

> **초기판 알림:** 기존 PySide6 영상 합성기의 모든 UI 기능을 그대로 옮긴 완성판은 아닙니다. 아래 '작동 범위'를 확인하세요. GitHub 저장소의 Python 파일을 ZIP에 복사하거나 수정하지 않았습니다.

## 빠른 시작 (Windows)

요구 사항: Windows 10/11, Node.js 22.12 이상, VS Code 권장. 렌더·녹음에는 별도로 기존 dubbing 소스와 `.venv`가 필요합니다.

```powershell
# 1) 이 ZIP을 압축 해제 후 VS Code에서 gomo-compose-studio 폴더 열기
npm install
npm run dev
```

또는 `START_WINDOWS.bat` 더블클릭. 처음 실행 후 **프로젝트 열기** 메뉴에서
`fixtures/demo_video_composer_v2.json`을 선택하면 동봉한 예시 이미지 3장과 자막이
표시됩니다. 이는 UI 확인용 자료이며 실제 더빙 Python 환경이 없어도 열 수 있습니다.
예시를 수정하여 보관하려면 **다른 이름으로 저장**을 이용하세요.

Windows 설치/Portable EXE 빌드:

```powershell
npm run typecheck
npm run test
npm run dist:win
```

결과: `release/` 하위에 NSIS 설치 파일 및 Portable EXE. **이번 ZIP에는 미리 빌드된 EXE가 없습니다.**

## 기존 Python 엔진 연결

이전 더빙 프로그램 프로젝트가 `D:\\projects\\dubbing`에 있다면:

1. 기존 더빙 프로젝트 `run.bat`으로 초기 설치를 완료합니다. 원본 PySide6 프로그램이 정상 실행되는지 확인합니다.
2. 고모 편집실 **환경 설정 → 기존 dubbing 소스 폴더**에 `D:\\projects\\dubbing` 설정.
3. **Python 실행 파일**에는 `D:\\projects\\dubbing\\.venv\\Scripts\\python.exe` 선택.
4. **경로 저장 → 연결 테스트**. `composer.schema` 임포트가 성공하면 연결됩니다.
5. **목소리** 탭에서 마이크 장치를 조회하고 녹음합니다. **내보내기**에서 미리보기·최종 렌더를 호출합니다.

Python Worker는 `engine/bridge.py`이고, 기존 저장소의 `composer.schema`, `composer.render.runner`, `composer.render.ffmpeg_builder`, `composer.dubbing.recorder`를 원본 그대로 import합니다. Electron ↔ Python 사이에 **표준 입출력 JSON Lines**를 사용하여 로컬 포트를 열지 않습니다. 로그인 정보/API 키는 필요하지 않습니다.

## 동작하는 기능 (v0.1)

- 기존 `project.json`/`composer_project.json` **v2 열기·저장·다른 이름 저장** (알 수 없는 JSON 필드 최대한 보존)
- 새 프로젝트 만들기, 작품 이름 변경, 기본 출력 설정
- 이미지/동영상/음악 파일을 프로젝트의 `media/` 폴더에 **복사**하여 연결
- 타임라인 클립 **드래그 순서 이동**, 시간·속도·전환 수정, 실행 취소/다시 실행
- 자막 JSON `subtitle.items` 편집, SRT 가져오기·내보내기, 화면 오버레이
- 원본 미디어의 단순 이미지/영상 확인 (**최종 FFmpeg 렌더 결과와 다를 수 있음**)
- 선택 클립 색감·움직임 설정 (설정은 프로젝트에 저장, 최종 효과는 Python 렌더에 반영)
- AI 편집안 **JSON 붙여넣기 및 적용**, 단 AI 웹 자동 요청은 미구현
- Python 원본 Recorder 기반 **마이크 WAV 녹음**, `dubbing.takes`에 연결
- Python 원본 render_project 기반 **360p 임시 미리보기 / 최종 MP4 렌더**, 진행률·취소 이벤트
- 브랜드 중앙 설정: `src/shared/brand.ts`. GOMO → NUNI 표기 변경 가능

## 아직 없는 기능 (중요)

- 기존 PySide6의 영상 프레임 정확 미리보기, 자동 재렌더 캐시 UI, 진짜 멀티트랙 미디어 믹싱 프리뷰
- 정확한 소스 영상 길이 자동 탐색(새로 추가한 영상은 임시 4초로 시작하며 수동 길이 변경 필요)
- 타임라인 양 끝 핸들 직접 드래그, 다중선택·트랙 잠금·자석 기능, 전환 블록 직접 조작
- 자막별 자동 프리롤 및 연속 녹음, 레코딩 여러 버전 선택, 파형 편집
- Whisper 음성 인식/자동 자막 정렬, 고급 출력 옵션
- 최종 Windows 실행 및 실제 렌더/녹음 실환경 통합 테스트 (**개발 환경에서 원본 저장소를 다운로드할 수 없어 미실시**)

위 기능은 원본 프로그램에 구현된 기능이며, 새 UI에 순차적으로 연결하는 로드맵을 `docs/ROADMAP.md`에 명시했습니다. 현재 사용 중인 기존 프로그램을 대체하려면 필수 회귀 테스트가 필요합니다.

## 프로젝트 형식

기존 저장소 기준 `version: 2` JSON. 상대 경로는 프로젝트 JSON 파일이 있는 폴더 기준입니다. `subtitle.items`의 `index`, `start`, `end`, `text`를 지원하고, `dubbing.takes`는 `file`, `subtitle`, `offset` 등의 필드를 유지합니다.

- 새 프로젝트: 사용자 앱 데이터 폴더의 `projects/<UUID>/project.json`
- 가져온 미디어: 해당 프로젝트 옆 `media/` 폴더
- 녹음 파일: `takes/line_0001_v1.wav` 등
- 임시 렌더: `preview_gomo.mp4`
- 최종 렌더: 프로젝트의 `output.file`

고모 창작실에서 `composer_project.json`을 만든 경우 그 프로젝트 폴더 **전체를 유지한 상태에서** 고모 편집실에서 JSON을 여세요. 파일 경로만 전달받는 경우에는 해당 미디어가 원래 상대 경로에 있어야 합니다.

### 개발 구조

```text
gomo-compose-studio/
  src/main/            Electron 보안 경계 · 파일/미디어 · Python IPC
  src/preload/         제한된 renderer API
  src/renderer/        React 데스크톱 UI, CSS
  src/shared/          브랜드, 데이터 모델, SRT와 타임라인 계산
  engine/bridge.py     원본 Python 모듈 호출만 하는 경량 JSONL worker
  engine/tests/        백엔드 브리지 기본 테스트
  scripts/test.mjs     프로젝트 로직 단위 테스트
  docs/                아키텍처, 개발 순서, 품질 검수표
```

## 보안·브랜드

- `nodeIntegration:false`, `contextIsolation:true` 및 preload API 사용.
- `gomo-media://`는 Electron main 프로세스가 등록한 파일만 읽습니다.
- Python 엔진 경로를 사용자가 직접 선택하며, 외부 포트를 열지 않습니다.
- NUNI로 변경하려면 **표시용 텍스트/색상**을 `src/shared/brand.ts`와 스타일 파일에서 변경합니다. 설치 appId, 프로젝트 저장 경로 등은 이전 설치와 호환성을 위해 고정해야 합니다.
- 원본 `knhanul/dubbing` 소스는 포함되지 않으며, 기존 저장소에 적용할 패치도 포함하지 않습니다.

## 확인한 공개 근거

- https://github.com/knhanul/dubbing/blob/main/README.md
- https://github.com/knhanul/dubbing/blob/main/composer/schema.py
- https://github.com/knhanul/dubbing/blob/main/composer/render/runner.py
- https://github.com/knhanul/dubbing/blob/main/composer/dubbing/recorder.py

관련 코드 및 라이선스는 원본 저장소의 최신 변경 사항을 별도 확인하세요.
