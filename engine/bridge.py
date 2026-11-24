#!/usr/bin/env python3
"""Thin JSONL adapter for the UNMODIFIED original knhanul/dubbing Python engine.

Launch this bridge *using the original repo's Python venv*, with cwd=that repo.
The original source stays in the original checkout. No HTTP port, API key, or Qt UI.
"""
from __future__ import annotations

import json
import os
import sys
import threading
import traceback
from pathlib import Path
from typing import Any

# The subprocess runs this script outside the original repository.
# Import the existing composer package from the explicitly configured cwd.
sys.path.insert(0, os.getcwd())

PRINT_LOCK = threading.Lock()
ACTIVE_RENDER: threading.Thread | None = None
CANCEL_RENDER = threading.Event()
RECORDER: Any = None
REC_PATH: Path | None = None
REC_INDEX: int | None = None
REC_BASE: Path | None = None


def send(message: dict) -> None:
    with PRINT_LOCK:
        sys.stdout.write(json.dumps(message, ensure_ascii=False, default=str) + "\n")
        sys.stdout.flush()


def response(msg_id: int, *, result: Any = None, error: str = "") -> None:
    send({"id": msg_id, "ok": not error, **({"error": error} if error else {"result": result})})


def event(name: str, **kwargs: Any) -> None:
    send({"event": name, **kwargs})


def import_engine():
    from composer.schema import Project, load_project  # type: ignore
    return Project, load_project


def check_project(doc: dict, base: Path) -> dict:
    Project, _ = import_engine()
    project = Project.from_dict(doc, base_dir=base)
    issues: list[str] = []
    if not project.clips:
        issues.append("클립이 없습니다.")
    for i, clip in enumerate(project.clips, 1):
        source = project.resolve(clip.file)
        if not source or not source.is_file():
            issues.append(f"클립 {i}의 파일을 찾을 수 없습니다: {clip.file}")
    if project.bgm.file:
        source = project.resolve(project.bgm.file)
        if not source or not source.is_file():
            issues.append(f"배경음악을 찾을 수 없습니다: {project.bgm.file}")
    return {"valid": not issues, "issues": issues, "version": project.version, "clips": len(project.clips)}


def start_recording(args: dict) -> dict:
    global RECORDER, REC_PATH, REC_INDEX, REC_BASE
    if RECORDER is not None and RECORDER.is_recording:
        raise ValueError("이미 녹음 중입니다.")
    from composer.dubbing.recorder import Recorder  # type: ignore

    base = Path(str(args["base_dir"]))
    folder = base / "takes"
    folder.mkdir(parents=True, exist_ok=True)
    idx = int(args.get("subtitle") or 0)
    prefix = f"line_{idx:04d}_v" if idx else "free_v"
    number = 1
    while (folder / f"{prefix}{number}.wav").exists():
        number += 1
    dest = folder / f"{prefix}{number}.wav"
    if RECORDER is None:
        RECORDER = Recorder()
    device = args.get("device")
    RECORDER.open(int(device) if device is not None else None)
    RECORDER.start(dest)
    REC_PATH, REC_INDEX, REC_BASE = dest, idx, base
    return {"recording": True, "file": str(dest)}


def stop_recording() -> dict:
    global RECORDER, REC_PATH, REC_INDEX, REC_BASE
    if RECORDER is None or not RECORDER.is_recording or not REC_PATH:
        raise ValueError("현재 녹음 중이 아닙니다.")
    duration = RECORDER.stop()
    RECORDER.close()
    name = REC_PATH.relative_to(REC_BASE).as_posix() if REC_BASE else str(REC_PATH)
    result = {"recording": False, "file": name, "duration": duration, "subtitle": REC_INDEX}
    REC_PATH, REC_INDEX, REC_BASE = None, None, None
    return result


def start_render(args: dict) -> dict:
    global ACTIVE_RENDER
    if ACTIVE_RENDER and ACTIVE_RENDER.is_alive():
        raise RuntimeError("이미 렌더링 중입니다.")
    project_file = Path(str(args["project_path"])).resolve()
    if not project_file.is_file():
        raise ValueError("프로젝트가 저장되지 않았습니다.")
    draft = bool(args.get("draft", True))
    encoder = str(args.get("encoder", "libx264"))
    if encoder not in ("libx264", "h264_nvenc"):
        raise ValueError("지원되지 않는 인코더")
    filename = "preview_gomo.mp4" if draft else str(args.get("output") or "output.mp4")
    output = (project_file.parent / filename).resolve()
    if not output.is_relative_to(project_file.parent):
        raise ValueError("출력 경로는 프로젝트 폴더 내부여야 합니다.")
    CANCEL_RENDER.clear()

    def work() -> None:
        try:
            from composer.schema import load_project
            from composer.render.runner import render_project
            from composer.render.ffmpeg_builder import RenderSettings

            project = load_project(project_file)
            result = render_project(
                project, output, RenderSettings(draft=draft, encoder=encoder),
                progress=lambda fraction, message: event("render_progress", progress=round(float(fraction), 4), message=message),
                cancel=CANCEL_RENDER,
            )
            event("render_done", path=str(result.output), duration=result.duration,
                  message=f"완료 · 새로 렌더 {result.clips_rendered} / 캐시 {result.clips_cached}")
        except Exception as exc:
            event("render_error", message=str(exc))
            sys.stderr.write(traceback.format_exc() + "\n")
        finally:
            CANCEL_RENDER.clear()

    ACTIVE_RENDER = threading.Thread(target=work, daemon=True)
    ACTIVE_RENDER.start()
    return {"started": True, "output": str(output), "draft": draft}


def dispatch(action: str, args: dict) -> Any:
    if action == "ping":
        Project, _ = import_engine()
        return {"connected": True, "schema": Project.__name__, "cwd": os.getcwd()}
    if action == "validate":
        return check_project(args["project"], Path(str(args["base_dir"])))
    if action == "devices":
        from composer.dubbing.recorder import list_input_devices
        return [dict(index=d.index, name=d.name, channels=d.channels,
                     samplerate=d.samplerate, is_default=d.is_default) for d in list_input_devices()]
    if action == "record_start":
        return start_recording(args)
    if action == "record_stop":
        return stop_recording()
    if action == "record_level":
        return {"db": float(RECORDER.level_db) if RECORDER else -90.0,
                "recording": bool(RECORDER and RECORDER.is_recording)}
    if action == "render":
        return start_render(args)
    if action == "cancel":
        CANCEL_RENDER.set()
        return {"cancel_requested": True}
    raise ValueError("Unknown action: " + action)


def main() -> None:
    for line in sys.stdin:
        try:
            item = json.loads(line)
            ident = int(item.get("id", 0))
            response(ident, result=dispatch(str(item["action"]), item.get("args") or {}))
        except Exception as exc:
            response(locals().get("ident", 0), error=f"{type(exc).__name__}: {exc}")
    if RECORDER:
        RECORDER.close()
    CANCEL_RENDER.set()


if __name__ == "__main__":
    main()
