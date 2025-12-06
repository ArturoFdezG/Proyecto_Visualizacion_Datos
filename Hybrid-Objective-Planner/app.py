"""Hybrid Objective Planner - FastAPI application for Render deployment.

This application serves the static frontend and exposes two JSON endpoints:
- POST /api/interference: Return interference score and breakdown
- POST /api/radar: Return aggregated physiological profile

The application can be run locally with: python app.py
For production, use: gunicorn app:app
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Sequence, Tuple

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Paths configuration
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
OBJECTIVES_PATH = DATA_DIR / "objectives.json"
INTERFERENCE_RESULTS_PATH = DATA_DIR / "interference_results.jsonl"
PHYSIOLOGY_RESULTS_PATH = DATA_DIR / "physiological_results.jsonl"

# Axis configuration
AXIS_LABELS: Mapping[str, str] = {
    "body_composition": "Body composition",
    "strength_local_endurance": "Strength & local endurance",
    "power_speed": "Power & speed",
    "endurance": "Endurance",
    "motor_control_skill": "Motor control & skill",
}
AXIS_ORDER: Tuple[str, ...] = tuple(AXIS_LABELS.keys())

# Create FastAPI app
app = FastAPI(
    title="Hybrid Objective Planner",
    description="A planner for combining training objectives with interference and physiology insights",
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static directories
app.mount("/vendor", StaticFiles(directory="vendor"), name="vendor")
app.mount("/data", StaticFiles(directory="data"), name="data")


# Request/Response models
class ObjectivesRequest(BaseModel):
    objectives: List[str]


# Data loading functions (reused from server.py)
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
        raise ValueError(f"Unknown objective IDs: {', '.join(missing)}")
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
        raise ValueError(f"No interference data for: {', '.join(ids)}")

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
        raise ValueError(f"No physiological profile for: {', '.join(ids)}")

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


# API Endpoints
@app.post("/api/interference")
async def interference(request: ObjectivesRequest) -> dict:
    """Return interference score and breakdown for the selected objectives."""
    try:
        objective_ids = _normalise_objective_ids(request.objectives)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        return _format_interference(objective_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@app.post("/api/radar")
async def radar(request: ObjectivesRequest) -> dict:
    """Return aggregated physiological profile for the selected objectives."""
    try:
        objective_ids = _normalise_objective_ids(request.objectives)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        return _format_radar(objective_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


# Serve static files
@app.get("/")
async def read_root():
    """Serve the main HTML file."""
    return FileResponse("index.html")


@app.get("/styles.css")
async def read_styles():
    """Serve the CSS file."""
    return FileResponse("styles.css")


@app.get("/app.js")
async def read_app_js():
    """Serve the main JavaScript file."""
    return FileResponse("app.js")


@app.get("/app.legacy.js")
async def read_app_legacy_js():
    """Serve the legacy JavaScript file."""
    return FileResponse("app.legacy.js")


# Health check endpoint for Render
@app.get("/health")
async def health_check():
    """Health check endpoint for monitoring."""
    return {"status": "ok", "service": "Hybrid Objective Planner"}


if __name__ == "__main__":
    import uvicorn

    print("Hybrid objective planner running at http://127.0.0.1:8000")
    print("Press Ctrl+C to stop.")
    uvicorn.run(app, host="0.0.0.0", port=8000)

