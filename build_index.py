"""
build_index.py — One-time index builder.

Reads tmdb_5000_movies.csv and produces:
  - cleaned_movies.csv   (metadata the API serves + popularity signal for re-ranking)
  - movie_embeddings.npy (precomputed, L2-normalized sentence embeddings)

Key quality fix vs. the original: we embed a RICH, vibe-loaded blob
(title + genres + keywords + tagline + overview) instead of the bare plot
overview. Genres and TMDB keywords carry the *mood* signal that vibe queries
like "mind-bending sci-fi that makes you question reality" are written in —
words that rarely appear in a plot synopsis. This is the single biggest lever
on recommendation quality.

Run once after any data change:
    python build_index.py
"""
import ast
import numpy as np
import pandas as pd
from sentence_transformers import SentenceTransformer

import config

SOURCE_CSV = "tmdb_5000_movies.csv"


def _names(json_like, limit=None):
    """Parse TMDB's JSON-string columns (genres, keywords) into a name list."""
    try:
        items = ast.literal_eval(json_like) if isinstance(json_like, str) else []
        names = [d.get("name", "").strip() for d in items if d.get("name")]
        return names[:limit] if limit else names
    except Exception:
        return []


def _year(release_date):
    try:
        return str(release_date)[:4] if pd.notna(release_date) else ""
    except Exception:
        return ""


def build_embed_text(row):
    """The text we actually embed. Order front-loads the strongest mood signal."""
    genres = ", ".join(_names(row["genres"]))
    keywords = ", ".join(_names(row["keywords"], limit=12))
    tagline = "" if pd.isna(row.get("tagline")) else str(row["tagline"]).strip()
    overview = "" if pd.isna(row.get("overview")) else str(row["overview"]).strip()
    parts = [str(row["title"]), genres, keywords, tagline, overview]
    return " — ".join(p for p in parts if p and p.lower() != "nan")


def main():
    print(f"[build] reading {SOURCE_CSV}")
    df = pd.read_csv(SOURCE_CSV)

    # Keep only rows with a usable overview and a real TMDB id.
    df = df[df["overview"].notna() & df["id"].notna()].copy()
    df["id"] = df["id"].astype(int)

    # Human-readable genres for display; rich blob for embedding.
    df["genres_display"] = df["genres"].apply(lambda j: ", ".join(_names(j)))
    df["embed_text"] = df.apply(build_embed_text, axis=1)
    df["year"] = df["release_date"].apply(_year)

    # Popularity signal for re-ranking. vote_count is the most reliable proxy
    # for "is this a film people actually know" — better than TMDB popularity,
    # which spikes with recent releases.
    df["vote_count"] = pd.to_numeric(df["vote_count"], errors="coerce").fillna(0).astype(int)
    df["vote_average"] = pd.to_numeric(df["vote_average"], errors="coerce").fillna(0.0)

    out = pd.DataFrame({
        "tmdb_id": df["id"].values,
        "title": df["title"].values,
        "overview": df["overview"].values,
        "genres": df["genres_display"].values,
        "year": df["year"].values,
        "vote_count": df["vote_count"].values,
        "vote_average": df["vote_average"].values,
        "embed_text": df["embed_text"].values,
    }).reset_index(drop=True)

    out.to_csv(config.MOVIES_CSV, index=False)
    print(f"[build] wrote {config.MOVIES_CSV} ({len(out)} films)")

    print(f"[build] loading model {config.EMBED_MODEL} (downloads ~90MB first run)")
    model = SentenceTransformer(config.EMBED_MODEL)

    print("[build] encoding embeddings…")
    emb = model.encode(
        out["embed_text"].tolist(),
        batch_size=64,
        show_progress_bar=True,
        convert_to_numpy=True,
        normalize_embeddings=True,  # store normalized so search is a pure dot product
    ).astype("float32")

    np.save(config.EMBEDDINGS_NPY, emb)
    print(f"[build] wrote {config.EMBEDDINGS_NPY} {emb.shape}")
    print("[build] done.")


if __name__ == "__main__":
    main()
