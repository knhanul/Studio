# 고모 편집실 아키텍처 v0.1

## 설계 의도

- VS Code에서 React UI를 계속 개발한다.
- `knhanul/dubbing` Python 처리 코드는 **수정하거나 TypeScript로 이식하지 않는다**.
- 두 앱(GOMO Create, GOMO Compose)은 서로 다른 EXE로 유지한다.
- 기존 Video Composer JSON v2를 데이터 계약으로 사용한다.

## 계층

1. **renderer**: React 화면 / 순수 UI 상태 / 히스토리 / 타임라인 / 자막.
2. **preload**: 명시적으로 허용된 IPC 메서드만 노출.
3. **main**: 파일 입출력, 미디어 토큰 URL, 로컬 프로젝트, 설정.
4. **engine bridge**: JSONL over stdio, `composer.schema`, `render_project`, `Recorder` 호출.
5. **원본 Python 소스**: 기존 FFmpeg/ASR/녹음/타임라인 계산, 변경 금지.

## 작업 중단과 복구

- 프로젝트 파일은 저장 시 임시 파일을 작성하고 원자적으로 교체한다.
- UI에서는 Ctrl+S로 수동 저장하며, 자동저장은 향후 단계로 확장한다.
- 렌더 작업 중 UI가 종료되면 Worker가 종료되므로 재렌더가 필요하다.
- 녹음 중 강제 종료되는 경우 원본 WAV가 불완전할 수 있다. 차기 버전에서는 복구 메커니즘 구현.

## 향후 리팩토링 원칙

- Python을 수정해야 할 경우에도 기존 처리 함수를 감싼 최소 어댑터만 추가한다.
- 렌더 설정·프로젝트 스키마의 형식은 `composer/schema.py` 및 `schema/project.schema.json`을 진실의 원천으로 사용한다.
- 읽을 수 없는 구형 프로젝트는 원본 앱에서 먼저 마이그레이션한다.
- React UI에서 직접 ffmpeg 프로세스를 실행하지 않는다.
