"""
core/search.py — Hybrid semantic + keyword search with light popularity tiebreak.

Interface matches app.py: SearchEngine(model, df, embeddings).

Why hybrid? Pure dense (embedding) retrieval under-weights exact keyword
matches: for "neon cyberpunk detective with existential dread", the model
ranks films with the literal word "detective" above Blade Runner, even though
Blade Runner is tagged cyberpunk / tech noir / neo-noir / dystopia. Adding a
sparse, IDF-weighted keyword score over the clean `tags` field (genres +
keywords, no plot prose) surfaces those canonical matches.

Final score = semantic + LEXICAL_WEIGHT * keyword_overlap + POP_WEIGHT * popularity
Results are sorted by (and display) this combined score, so ordering is monotonic.
"""
import re
import math
from collections import Counter

import numpy as np
import pandas as pd

import config

LEXICAL_WEIGHT = getattr(config, "LEXICAL_WEIGHT", 0.7)
POPULARITY_WEIGHT = getattr(config, "POPULARITY_WEIGHT", 0.05)
CANDIDATE_POOL = getattr(config, "CANDIDATE_POOL", 60)
LEXICAL_POOL = getattr(config, "LEXICAL_POOL", 40)
SOFT_FLOOR = getattr(config, "SOFT_FLOOR", 0.12)  # min semantic for a keyword-only hit

_TOKEN = re.compile(r"[a-z0-9]+")
_STOP = set(
    "the a an of to in on and or with for from is are was were be been being film movie "
    "story based novel his her him she who out now new into about as at by it its".split()
)


def _tokens(text):
    return [w for w in _TOKEN.findall(str(text).lower()) if len(w) >= 3 and w not in _STOP]


class SearchEngine:
    """Loads the model + precomputed embeddings once, serves fast hybrid search."""

    def __init__(self, model, df, embeddings):
        self.model = model
        self.df = df.reset_index(drop=True)

        # Dense: normalize once so cosine == dot product.
        emb = np.asarray(embeddings, dtype="float32")
        norms = np.linalg.norm(emb, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        self.emb = emb / norms

        # Popularity signal (log-scaled, [0,1]) for a gentle tiebreak.
        if "vote_count" in self.df.columns:
            votes = pd.to_numeric(self.df["vote_count"], errors="coerce").fillna(0).to_numpy()
        else:
            votes = np.zeros(len(self.df))
        logv = np.log1p(votes.astype("float64"))
        self.pop_norm = (logv / logv.max()) if logv.max() > 0 else np.zeros(len(self.df))

        # Sparse: tokenize the clean tag field (genres + keywords), build an
        # inverted index + IDF table. Falls back to genres if tags is absent.
        if "tags" in self.df.columns:
            tag_src = self.df["tags"].fillna("")
        else:
            tag_src = self.df.get("genres", pd.Series([""] * len(self.df))).fillna("")
        self.doc_tokens = [set(_tokens(t)) for t in tag_src]

        n = len(self.doc_tokens)
        dfreq = Counter()
        self.inverted = {}
        for i, toks in enumerate(self.doc_tokens):
            for t in toks:
                dfreq[t] += 1
                self.inverted.setdefault(t, []).append(i)
        self.idf = {t: math.log((n + 1) / (d + 1)) + 1.0 for t, d in dfreq.items()}
        self._default_idf = math.log(n + 1) + 1.0
        self.n = n

    def _lexical(self, query):
        qterms = list(dict.fromkeys(_tokens(query)))
        qidf = {t: self.idf.get(t, self._default_idf) for t in qterms}
        denom = sum(qidf.values()) or 1.0
        cands = set()
        for t in sorted(qterms, key=lambda x: -qidf[x])[:8]:
            cands.update(self.inverted.get(t, [])[:300])
        return qterms, qidf, denom, cands

    def search(self, query, top_k=None, min_score=None):
        top_k = top_k or config.DEFAULT_RESULTS
        min_score = config.MIN_SCORE if min_score is None else min_score

        # Dense scores.
        q = self.model.encode([query])[0].astype("float32")
        qn = np.linalg.norm(q)
        if qn > 0:
            q = q / qn
        sims = self.emb @ q  # (N,)

        # Candidate pools: top-by-semantic + keyword matches.
        pool = min(CANDIDATE_POOL, len(sims))
        sem_pool = set(np.argpartition(-sims, pool - 1)[:pool].tolist())
        qterms, qidf, denom, lex_cands = self._lexical(query)

        def lex_score(i):
            toks = self.doc_tokens[i]
            return sum(qidf[t] for t in qterms if t in toks) / denom

        lex_ranked = sorted(lex_cands, key=lex_score, reverse=True)[:LEXICAL_POOL]
        candidates = set()
        for i in sem_pool:
            if sims[i] >= min_score:
                candidates.add(i)
        for i in lex_ranked:
            if sims[i] >= SOFT_FLOOR and lex_score(i) > 0:
                candidates.add(i)
        if not candidates:
            return []

        scored = []
        for i in candidates:
            final = float(sims[i]) + LEXICAL_WEIGHT * lex_score(i) + POPULARITY_WEIGHT * float(self.pop_norm[i])
            scored.append((final, i))
        scored.sort(reverse=True)
        scored = scored[:top_k]

        results = []
        for final, i in scored:
            row = self.df.iloc[int(i)]
            results.append({
                "title": row["title"],
                "overview": row.get("overview", ""),
                "genres": row.get("genres", ""),
                "tmdb_id": int(row["tmdb_id"]),
                "match_score": round(min(final, 0.999), 4),
                "match_percent": int(round(min(final, 0.999) * 100)),
            })
        return results
