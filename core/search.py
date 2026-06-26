"""
core/search.py — Vectorized semantic search engine with popularity re-ranking.

Interface matches app.py exactly: the app builds the model, dataframe, and
embeddings at startup and passes them in via SearchEngine(model, df, embeddings).

Quality improvements over pure cosine:
1. CANDIDATE POOL + RE-RANK — pull a wider semantic pool, then re-rank with a
   blend of semantic score and a popularity signal so recognizable, well-regarded
   films surface first instead of obscure near-text-matches.
2. RELEVANCE GATE on the *semantic* score (not the blend), so a popular film can't
   be dragged into results it isn't actually a semantic match for.

The rich vibe-loaded embedding text (title + genres + keywords + tagline +
overview) is baked into movie_embeddings.npy by build_index.py.
"""
import numpy as np
import pandas as pd

import config

# Popularity nudges ordering; semantics lead. Tunable from config.py.
POPULARITY_WEIGHT = getattr(config, "POPULARITY_WEIGHT", 0.15)
# Semantic candidates pulled before re-ranking.
CANDIDATE_POOL = getattr(config, "CANDIDATE_POOL", 40)


class SearchEngine:
    """Loads the model + precomputed embeddings once, serves fast vector search."""

    def __init__(self, model, df: pd.DataFrame, embeddings: np.ndarray):
        self.model = model
        self.df = df.reset_index(drop=True)

        # Normalize embeddings once so cosine similarity == dot product.
        emb = np.asarray(embeddings, dtype="float32")
        norms = np.linalg.norm(emb, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self.emb = emb / norms

        # Log-scaled, [0,1]-normalized popularity signal for re-ranking.
        # vote_count is the most reliable "do people know this film" proxy.
        if "vote_count" in self.df.columns:
            votes = pd.to_numeric(self.df["vote_count"], errors="coerce").fillna(0).to_numpy()
        else:
            votes = np.zeros(len(self.df))
        logv = np.log1p(votes.astype("float64"))
        self.pop_norm = (logv / logv.max()) if logv.max() > 0 else np.zeros(len(self.df))

    def search(self, query, top_k=None, min_score=None):
        top_k = top_k or config.DEFAULT_RESULTS
        min_score = config.MIN_SCORE if min_score is None else min_score

        # Encode + normalize the query, then cosine == dot against all movies.
        q = self.model.encode([query])[0].astype("float32")
        qn = np.linalg.norm(q)
        if qn > 0:
            q = q / qn
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
