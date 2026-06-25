"""core/search.py — Semantic search engine. Pure logic, no web framework."""
import numpy as np
import pandas as pd
from functools import lru_cache


class SearchEngine:
    """Loads the model + precomputed embeddings once, serves fast vector search."""

    def __init__(self, model, df: pd.DataFrame, embeddings: np.ndarray):
        self.model = model
        self.df = df
        # Normalize embeddings ONCE at load (not per-search). Big speedup.
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1e-9  # guard against divide-by-zero
        self.embeddings = embeddings / norms

    def search(self, query: str, top_k: int = 5, min_score: float = 0.20):
        """Return top_k matches above min_score. Each result is a dict."""
        query = (query or "").strip()
        if not query:
            return []

        # Encode + normalize the query vector
        q = self.model.encode([query])[0]
        qn = np.linalg.norm(q)
        if qn == 0:
            return []
        q = q / qn

        # Cosine similarity = dot product of normalized vectors
        scores = self.embeddings @ q  # vectorized, fast

        # Top-k indices, sorted high to low
        k = min(top_k, len(scores))
        top_idx = np.argpartition(-scores, range(k))[:k]
        top_idx = top_idx[np.argsort(-scores[top_idx])]

        results = []
        for i in top_idx:
            score = float(scores[i])
            if score < min_score:
                continue
            row = self.df.iloc[int(i)]
            results.append({
                "title": str(row.get("title", "Unknown")),
                "overview": str(row.get("overview", "")),
                "genres": str(row.get("genres", "")),
                "tmdb_id": int(row["tmdb_id"]) if "tmdb_id" in row and pd.notna(row["tmdb_id"]) else None,
                "match_score": round(score, 4),
                "match_percent": int(round(score * 100)),
            })
        return results
