"""app.py — FastAPI backend for CineMatch.

Endpoints:
  GET  /health          → liveness + whether the index is loaded
  POST /search          → semantic search + live enrichment
  GET  /examples        → example vibe prompts

The heavy model + embeddings load once at startup. If enrichment APIs are
down, search still returns semantic matches with whatever data we have.
"""
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer

import config
from core.search import SearchEngine
from core.enrich import enrich_movie

# Loaded at startup
STATE = {"engine": None, "error": None}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model + data once when the server boots."""
    try:
        model = SentenceTransformer(config.EMBED_MODEL)
        df = pd.read_csv(config.MOVIES_CSV)
        embeddings = np.load(config.EMBEDDINGS_NPY)
        STATE["engine"] = SearchEngine(model, df, embeddings)
        print(f"[startup] Loaded {len(df)} movies. Ready.")
    except Exception as e:
        STATE["error"] = str(e)
        print(f"[startup] FAILED: {e}")
    yield
    STATE.clear()


app = FastAPI(title="CineMatch API", lifespan=lifespan)

# CORS — allow the frontend (set FRONTEND_ORIGIN in prod; * is fine for a demo)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "*")],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SearchRequest(BaseModel):
    query: str
    top_k: int = config.DEFAULT_RESULTS
    region: str = config.DEFAULT_REGION
    enrich: bool = True


@app.get("/health")
def health():
    return {
        "status": "ok" if STATE.get("engine") else "loading",
        "ready": STATE.get("engine") is not None,
        "error": STATE.get("error"),
    }


@app.get("/examples")
def examples():
    return {"examples": config.EXAMPLE_VIBES}


@app.post("/search")
def search(req: SearchRequest):
    engine = STATE.get("engine")
    if engine is None:
        return {
            "ok": False,
            "error": "Search index is still loading. Try again in a few seconds.",
            "results": [],
        }

    query = (req.query or "").strip()
    if not query:
        return {"ok": True, "results": [], "message": "Type a vibe to get started."}
    if len(query) > 500:
        query = query[:500]

    top_k = max(1, min(req.top_k, config.MAX_RESULTS))

    try:
        matches = engine.search(query, top_k=top_k, min_score=config.MIN_SCORE)
    except Exception as e:
        return {"ok": False, "error": f"Search failed: {e}", "results": []}

    if not matches:
        return {
            "ok": True,
            "results": [],
            "message": "No strong matches. Try describing the mood, pacing, or atmosphere instead of a title.",
        }

    # Live enrichment — best effort. Failures degrade gracefully per-movie.
    if req.enrich:
        for m in matches:
            if m.get("tmdb_id"):
                try:
                    extra = enrich_movie(m["tmdb_id"], region=req.region)
                    m.update(extra)
                except Exception:
                    pass  # keep the semantic result even if enrichment dies

    return {"ok": True, "results": matches, "query": query}
