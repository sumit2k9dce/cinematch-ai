"""
core/search.py — Vectorized semantic search engine with popularity re-ranking.

Two changes vs. the original pure-cosine version, both aimed at recommendation
quality:

1. CANDIDATE POOL + RE-RANK. Pure cosine lets a 55-vote unknown beat a
   13,000-vote classic on a 1% text edge. Instead we pull a wider pool by
   semantic similarity, then re-rank with a blend of semantic score and a
   popularity signal so recognizable, well-regarded films surface first.

2. RELEVANCE GATE on the *semantic* score (not the blend), so a popular film
   can't be dragged into results it isn't actually a semantic match for.

Embeddings are L2-normalized at build time, so cosine similarity == dot product.
The query is normalized once per search. Everything is vectorized.
"""
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer

import config

# How much the popularity signal nudges ordering. Small on purpose: semantics
# lead, popularity breaks ties among near-equal matches. Override in config.py
# by setting POPULARITY_WEIGHT if you want to tune it.
POPULARITY_WEIGHT = getattr(config, "POPULARITY_WEIGHT", 0.15)
# Pull this many semantic candidates before re-ranking.
CANDIDATE_POOL = getattr(config, "CANDIDATE_POOL", 40)


class SearchEngine:
    def __init__(self):
        self.model = None
        self.df = None
        self.emb = None          # (N, D) float32, L2-normalized
        self.pop_norm = None     # (N,) float in [0,1], log-scaled vote_count
        self.ready = False

    def load(self):
        """Load model, metadata, and embeddings once at startup."""
        self.model = SentenceTransformer(config.EMBED_MODEL)
        self.df = pd.read_csv(config.MOVIES_CSV)
        self.emb = np.load(config.EMBEDDINGS_NPY).astype("float32")

        # Defensive: re-normalize in case the .npy wasn't normalized at build.
        norms = np.linalg.norm(self.emb, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self.emb = self.emb / norms

        # Log-scaled popularity, normalized to [0,1]. log compresses the long
        # tail so a blockbuster doesn't completely dominate a solid mid-tier film.
        votes = self.df.get("vote_count", pd.Series(np.zeros(len(self.df)))).fillna(0).to_numpy()
        logv = np.log1p(votes.astype("float64"))
        self.pop_norm = (logv / logv.max()) if logv.max() > 0 else np.zeros(len(self.df))

        self.ready = True

    def search(self, query, top_k=None, min_score=None):
        if not self.ready:
            raise RuntimeError("SearchEngine not loaded")

        top_k = top_k or config.DEFAULT_RESULTS
        min_score = config.MIN_SCORE if min_score is None else min_score

        # Encode + normalize the query, then cosine == dot against all movies.
        q = self.model.encode([query], convert_to_numpy=True, normalize_embeddings=True)[0].astype("float32")
        sims = self.emb @ q  # (N,)

        # Wider candidate pool by raw semantic similarity.
        pool = min(CANDIDATE_POOL, len(sims))
        pool_idx = np.argpartition(-sims, pool - 1)[:pool]

        # Relevance gate on the semantic score — keep only genuine matches.
        pool_idx = pool_idx[sims[pool_idx] >= min_score]
        if pool_idx.size == 0:
            return []

        # Blend: semantics lead, popularity breaks near-ties.
        blended = (1 - POPULARITY_WEIGHT) * sims[pool_idx] + POPULARITY_WEIGHT * self.pop_norm[pool_idx]

        order = pool_idx[np.argsort(-blended)][:top_k]

        results = []
        for i in order:
            row = self.df.iloc[int(i)]
            sem = float(sims[int(i)])
            results.append({
                "title": row["title"],
                "overview": row.get("overview", ""),
                "genres": row.get("genres", ""),
                "tmdb_id": int(row["tmdb_id"]),
                # Displayed % stays the honest semantic match, not the blend.
                "match_score": round(sem, 4),
                "match_percent": int(round(sem * 100)),
            })
        return results


# Singleton the API imports and loads at startup (matches existing app.py usage).
engine = SearchEngine()
