"""FastAPI app exposing interference estimates for objective combinations."""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

from fastapi import FastAPI, HTTPException, Query


DATA_DIR = Path(__file__).parent / "data"
OBJECTIVES_FILE = DATA_DIR / "objectives.json"
INTERFERENCE_RESULTS_FILE = DATA_DIR / "interference_results.jsonl"


app = FastAPI(title="Hybrid Planner Interference API")


def _load_objective_ids() -> Iterable[str]:
    with OBJECTIVES_FILE.open("r", encoding="utf-8") as fp:
        payload = json.load(fp)

    for category in payload.get("categories", []):
        for objective in category.get("objectives", []):
            objective_id = objective.get("id")
            if objective_id:
                yield objective_id


def _load_interference_index() -> Dict[Tuple[str, ...], dict]:
    index: Dict[Tuple[str, ...], dict] = {}
    with INTERFERENCE_RESULTS_FILE.open("r", encoding="utf-8") as fp:
        for line in fp:
            line = line.strip()
            if not line:
                continue
            record = json.loads(line)
            inputs = record.get("inputs") or []
            key = tuple(sorted(inputs))
            if key:
                index[key] = record
    return index


@lru_cache(maxsize=1)
def _objective_ids() -> frozenset[str]:
    return frozenset(_load_objective_ids())


@lru_cache(maxsize=1)
def _interference_index() -> Dict[Tuple[str, ...], dict]:
    return _load_interference_index()


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


@app.get("/interference")
def interference(objectives: List[str] = Query(..., description="Objective identifiers")) -> dict:
    """Return interference metrics for the provided objective combination."""

    key = _normalise_objectives(objectives)
    record = _interference_index().get(key)
    if record is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": "interference_not_found",
                "message": "No interference data available for the requested combination.",
                "objectives": list(key),
            },
        )

    breakdown = [
        {
            "axis": item.get("axis"),
            "label": item.get("label"),
            "contribution": item.get("contribution"),
            "interference": item.get("interference"),
        }
        for item in record.get("breakdown", [])
    ]

    redundancy_flags: List[str] = []
    triple = record.get("triple")
    if isinstance(triple, dict):
        flags = triple.get("flags")
        if isinstance(flags, list):
            redundancy_flags = [flag for flag in flags if isinstance(flag, str)]

    return {
        "objectives": list(key),
        "score": record.get("score"),
        "score_base": record.get("score_base"),
        "breakdown": breakdown,
        "redundancy_flags": redundancy_flags,
    }

