"""FastAPI app exposing physiological radar axes for objective combinations."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from fastapi import FastAPI, HTTPException, Query


DATA_DIR = Path(__file__).parent / "data"
OBJECTIVES_FILE = DATA_DIR / "objectives.json"
PHYSIOLOGY_RESULTS_FILE = DATA_DIR / "physiological_results.jsonl"


app = FastAPI(title="Hybrid Planner Physiology API")


def _load_objective_ids() -> Iterable[str]:
    with OBJECTIVES_FILE.open("r", encoding="utf-8") as fp:
        payload = json.load(fp)

    for category in payload.get("categories", []):
        for objective in category.get("objectives", []):
            objective_id = objective.get("id")
            if objective_id:
                yield objective_id


def _load_physiology_index() -> Dict[Tuple[str, ...], dict]:
    index: Dict[Tuple[str, ...], dict] = {}
    with PHYSIOLOGY_RESULTS_FILE.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            objectives = record.get("objectives") or []
            key = tuple(sorted(objectives))
            if key:
                index[key] = record
    return index


@lru_cache(maxsize=1)
def _objective_ids() -> frozenset[str]:
    return frozenset(_load_objective_ids())


@lru_cache(maxsize=1)
def _physiology_index() -> Dict[Tuple[str, ...], dict]:
    return _load_physiology_index()


def _normalise_objectives(objectives: Sequence[str]) -> Tuple[str, ...]:
    if not objectives:
        raise HTTPException(status_code=400, detail="At least one objective must be provided.")

    available = _objective_ids()
    unknown = sorted({obj for obj in objectives if obj not in available})
    if unknown:
        raise HTTPException(
            status_code=400,
            detail={"error": "Unknown objectives", "unknown_objectives": unknown},
        )

    normalised = tuple(sorted(dict.fromkeys(objectives)))
    return normalised


@app.get("/physiology")
def physiology(objectives: List[str] = Query(..., description="Objective identifiers")) -> dict:
    """Return physiological radar axes for the provided objective combination."""

    key = _normalise_objectives(objectives)
    record = _physiology_index().get(key)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "physiology_not_found",
                "message": "No physiological profile available for the requested combination.",
                "objectives": list(key),
            },
        )

    axes = record.get("axes") or {}
    meta = record.get("meta") or {}

    return {
        "objectives": list(key),
        "axes": axes,
        "meta": meta,
    }

