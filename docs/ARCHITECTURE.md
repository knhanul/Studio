# 고모 편집실 아키텍처 v0.3

## 설계 의도

- 고모 창작실과 한 세트: 같은 디자인 시스템(`styles/base.css`), 같은 셸(사이드바 · 문서 헤더 · 작업 공간 · 하단 바).
- 더빙에 꼭 필요한 기능만 가볍게. 녹음과 영상 만들기는 **Python 없이** 앱 안에서 처리.
- 데이터 계약은 dubbing의 Video Composer JSON v2. 창작실 전달 패키지는 불러올 때 v2로 변환.

## 계층

1. **renderer** — React 화면, 편집 상태, 히스토리, 미리보기(CSS로 움직임·전환 흉내), 녹음(getUserMedia → PCM → WAV).
2. **preload** — 허용된 IPC만 `window.compose`로 노출.
3. **main** — 파일 입출력, 미디어 URL, 녹음 파일 저장, FFmpeg 실행, 설정.
4. **shared** — 순수 함수: 타임라인·테이크 위치·창작실 변환·SRT/ASS·렌더 계획. 단위 테스트 대상.
5. **(선택) engine bridge** — 예전 Python 엔진. 기본 흐름에서는 쓰지 않음.

## 렌더 파이프라인 (`shared/render.ts` → `main/ffmpeg.ts`)

1. 구간(`shared/camera.ts` buildSegments)별 중간 파일(.mkv, H.264 + PCM). 같은 장면·같은 그림의 연속 이미지 샷은 한 구간.
   - 이미지: 출력의 2배로 cover 맞춤 → `perspective`(소수점 좌표·cubic)로 카메라 경로를 따라 잘라 냄 → 출력 크기.
     카메라 경로는 샷 매듭(z, cx, cy)을 단조 3차 에르미트로 잇는 FFmpeg 식(미리보기와 같은 식).
     zoompan 대신 perspective 를 쓰는 이유: zoompan 은 자르는 위치를 정수 픽셀로 반올림해 떨림이 생기고,
     4배로 키워도 1/4 픽셀 계단이 남는다. perspective 는 실수 좌표로 보간하므로 계단이 없다(Python 없이 같은 효과).
   - 영상: 검은 첫 프레임 자동 잘라 냄, setpts 속도, fps, cover 맞춤.
   - 공통 끝맺음: 색감 → setsar=1 → yuv420p → 프레임 수를 정확히 N개(tpad·trim·-frames:v).
   다음 구간과 섞일 프레임만큼 길게 만든다(카메라는 그 끝까지 이어 움직임).
2. 이어 붙이기: 구간 사이만 전환이 있으면 `xfade`/`acrossfade`(offset = 시작 프레임 ÷ fps), 없으면 concat.
   클립마다 fade-in/out 은 넣지 않는다(영상 맨 앞·맨 끝만).
3. 자막: ASS 파일로 만들어 `ass` 필터로 새김(작업 폴더 기준 상대 경로, Windows 글꼴 폴더 지정).
4. 소리: 테이크(자르기·크기·위치) amix → 소리 층(`musicLayers`: 배경음악 + 바뀌는 음악 + 효과음, 각각 구간·반복·페이드·크기) →
   자동 줄이기가 켜진 층은 한 묶음(musicbus)으로 sidechaincompress, 나머지(효과음)는 그대로 → alimiter.
5. 진행률은 `-progress pipe:1`, 취소는 AbortSignal.

## 테이크 위치

`위치 = 자막 시작 + offset − latency`. 자르기는 `offset = −trim_start`로 맞춰 목소리가 자막 시작에 정확히 들어감.
"녹음 길이에 맞추기"는 녹음된 문장 길이로 자막을 다시 배치하고, 이미지 장면 길이만 늘이거나 줄임(영상 장면은 그대로).

## 저장과 복구

- 저장은 임시 파일 작성 후 교체. 변경 900ms 뒤 자동 저장.
- 다시 녹음해도 예전 WAV는 지우지 않음(`line_0001_v2.wav` …).
- 렌더는 임시 작업 폴더에서 하고, 끝나면 정리.

## 미디어 보관함 (`shared/media.ts`)

- 창작실을 열 때 우선순위: `composer_project.json` → `project.json`(creator.project.v1) → `gomo-handoff.json`.
- 보관함 = 창작실 `project.json`의 assets(장면 연결 · 기준 이미지 · 다른 버전 · BGM) + `assets/` · `media/` 폴더의 실제 파일.
  파일 이름 규칙(`S04_image_v2.png`, `BGM_02.mp3`)은 창작실 `asset-naming.ts`와 같음. 없어진 파일은 열 때 뺌.
- 장면 클립에 `scene_id`, 영상 클립에 `poster`(기준 이미지)를 채워 같은 장면의 다른 미디어를 찾음.
