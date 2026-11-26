# 고모 편집실 아키텍처 v0.2

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

1. 장면별 중간 파일(.mkv, H.264 + PCM): 이미지는 `perspective`로 부드러운 움직임, 영상은 속도·자르기·맞춤.
   다음 장면으로 넘어가는 전환 시간만큼 길게 만들어 둠.
2. 이어 붙이기: 전환이 있으면 `xfade`/`acrossfade`, 없으면 concat.
3. 자막: ASS 파일로 만들어 `ass` 필터로 새김(작업 폴더 기준 상대 경로, Windows 글꼴 폴더 지정).
4. 소리: 테이크(자르기·크기·위치) amix → 배경음악(반복·페이드·크기) → sidechaincompress 자동 줄이기 → alimiter.
5. 진행률은 `-progress pipe:1`, 취소는 AbortSignal.

## 테이크 위치

`위치 = 자막 시작 + offset − latency`. 자르기는 `offset = −trim_start`로 맞춰 목소리가 자막 시작에 정확히 들어감.
"녹음 길이에 맞추기"는 녹음된 문장 길이로 자막을 다시 배치하고, 이미지 장면 길이만 늘이거나 줄임(영상 장면은 그대로).

## 저장과 복구

- 저장은 임시 파일 작성 후 교체. 변경 900ms 뒤 자동 저장.
- 다시 녹음해도 예전 WAV는 지우지 않음(`line_0001_v2.wav` …).
- 렌더는 임시 작업 폴더에서 하고, 끝나면 정리.
