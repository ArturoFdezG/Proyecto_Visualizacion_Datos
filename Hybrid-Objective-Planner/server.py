"""Serve the Hybrid Objective Planner demo with self-contained data.

The server exposes two JSON endpoints backed entirely by files in this
folder:

``POST /api/interference``
    Return the interference score and breakdown for the selected objectives.
``POST /api/radar``
    Return the aggregated physiological profile for the selected objectives.

Static assets in this directory are also served so that running
``python server.py`` is enough to explore the demo locally.
"""

from __future__ import annotations

import json
from functools import lru_cache
from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

import sys

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OBJECTIVES_PATH = DATA_DIR / "objectives.json"
INTERFERENCE_RESULTS_PATH = DATA_DIR / "interference_results.jsonl"
PHYSIOLOGY_RESULTS_PATH = DATA_DIR / "physiological_results.jsonl"

API_PREFIX = "/api"

AXIS_LABELS: Mapping[str, str] = {
    "body_composition": "Body composition",
    "strength_local_endurance": "Strength & local endurance",
    "power_speed": "Power & speed",
    "endurance": "Endurance",
    "motor_control_skill": "Motor control & skill",
}
AXIS_ORDER: Tuple[str, ...] = tuple(AXIS_LABELS.keys())


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as fp:
        return json.load(fp)


def _load_json_lines(path: Path) -> Iterable[dict]:
    with path.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def _load_objective_ids() -> Iterable[str]:
    payload = _load_json(OBJECTIVES_PATH)
    for category in payload.get("categories", []):
        for objective in category.get("objectives", []):
            objective_id = objective.get("id")
            if objective_id:
                yield str(objective_id)


@lru_cache(maxsize=1)
def _objective_id_set() -> frozenset[str]:
    return frozenset(_load_objective_ids())


def _normalise_objective_ids(objective_ids: Iterable[str]) -> Tuple[str, ...]:
    normalised = tuple(sorted({str(obj_id) for obj_id in objective_ids if str(obj_id)}))
    if not normalised:
        return tuple()
    missing = [obj_id for obj_id in normalised if obj_id not in _objective_id_set()]
    if missing:
        raise KeyError(f"Unknown objective IDs: {', '.join(missing)}")
    return normalised


@lru_cache(maxsize=1)
def _interference_index() -> Dict[Tuple[str, ...], dict]:
    index: Dict[Tuple[str, ...], dict] = {}
    for record in _load_json_lines(INTERFERENCE_RESULTS_PATH):
        identifiers = record.get("inputs") or record.get("objectives") or []
        key = tuple(sorted(str(obj_id) for obj_id in identifiers if obj_id))
        if key:
            index[key] = record
    return index


@lru_cache(maxsize=1)
def _physiology_index() -> Dict[Tuple[str, ...], dict]:
    index: Dict[Tuple[str, ...], dict] = {}
    for record in _load_json_lines(PHYSIOLOGY_RESULTS_PATH):
        identifiers = record.get("objectives") or record.get("inputs") or []
        key = tuple(sorted(str(obj_id) for obj_id in identifiers if obj_id))
        if key:
            index[key] = record
    return index


def _format_interference(ids: Sequence[str]) -> Mapping[str, object]:
    if not ids:
        return {
            "objectives": [],
            "score": 0.0,
            "score_base": 0.0,
            "breakdown": [],
            "redundancy_flags": [],
        }

    key = tuple(ids)
    record = _interference_index().get(key)
    if record is None:
        raise KeyError(f"No interference data for: {', '.join(ids)}")

    breakdown = [
        {
            "axis": item.get("axis"),
            "label": item.get("label"),
            "contribution": item.get("contribution"),
            "interference": item.get("interference"),
        }
        for item in record.get("breakdown", [])
        if isinstance(item, dict)
    ]

    flags: List[str] = []
    triple = record.get("triple")
    if isinstance(triple, dict):
        raw_flags = triple.get("flags")
        if isinstance(raw_flags, list):
            flags = [flag for flag in raw_flags if isinstance(flag, str)]

    return {
        "objectives": list(key),
        "score": record.get("score", 0.0),
        "score_base": record.get("score_base", 0.0),
        "breakdown": breakdown,
        "redundancy_flags": flags,
    }


def _format_radar(ids: Sequence[str]) -> Mapping[str, object]:
    if not ids:
        return {
            "objectives": [],
            "labels": [AXIS_LABELS[axis] for axis in AXIS_ORDER],
            "values": [0.0 for _ in AXIS_ORDER],
            "axes": {axis: 0.0 for axis in AXIS_ORDER},
            "meta": {},
        }

    key = tuple(ids)
    record = _physiology_index().get(key)
    if record is None:
        raise KeyError(f"No physiological profile for: {', '.join(ids)}")

    axes_payload = record.get("axes", {})
    axes = {axis: float(axes_payload.get(axis, 0.0)) for axis in AXIS_ORDER}
    labels = [AXIS_LABELS[axis] for axis in AXIS_ORDER]
    values = [axes[axis] for axis in AXIS_ORDER]

    meta = record.get("meta", {})
    if not isinstance(meta, dict):
        meta = {}

    return {
        "objectives": list(key),
        "labels": labels,
        "values": values,
        "axes": axes,
        "meta": meta,
    }


class PlannerRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_OPTIONS(self) -> None:  # noqa: N802 (HTTP verb naming)
        if self.path.startswith(API_PREFIX):
            self.send_response(HTTPStatus.NO_CONTENT)
            self._send_cors_headers()
            self.end_headers()
            return
        super().do_OPTIONS()

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith(API_PREFIX):
            self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length) if content_length else b"{}"
        try:
            payload = json.loads(raw_body.decode("utf-8"))
        except json.JSONDecodeError:
            self._json_response({"error": "Invalid JSON payload"}, status=HTTPStatus.BAD_REQUEST)
            return

        objective_ids = payload.get("objectives", []) if isinstance(payload, dict) else []
        try:
            objective_ids = _normalise_objective_ids(objective_ids)
        except KeyError as exc:
            self._json_response({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return

        if self.path == f"{API_PREFIX}/interference":
            try:
                self._json_response(_format_interference(objective_ids))
            except KeyError as exc:
                self._json_response({"error": str(exc)}, status=HTTPStatus.NOT_FOUND)
        elif self.path == f"{API_PREFIX}/radar":
            try:
                self._json_response(_format_radar(objective_ids))
            except KeyError as exc:
                self._json_response({"error": str(exc)}, status=HTTPStatus.NOT_FOUND)
        else:
            self._json_response({"error": "Unknown API endpoint"}, status=HTTPStatus.NOT_FOUND)

    def _send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json_response(self, data: Mapping[str, object], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args) -> None:  # noqa: A003 - inherited signature
        sys.stdout.write("[server] " + (format % args) + "\n")


def run(host: str = "0.0.0.0", port: int = 8000) -> None:
    server = HTTPServer((host, port), PlannerRequestHandler)
    print(f"Hybrid objective planner running at http://{host}:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server…")
    finally:
        server.server_close()


if __name__ == "__main__":
    run()
