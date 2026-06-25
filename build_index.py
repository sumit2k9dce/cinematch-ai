"""build_index.py — Rebuild the semantic index from the TMDB 5000 dataset.

Fixes vs the original:
  - Keeps tmdb_id so we can enrich live (posters, ratings, trailers, where-to-watch)
  - Embeds richer text: title + genres + tagline + overview (not overview alone)
  - Normalizes nothing here; search.py normalizes once at load
  - NO fake streaming data (the original used np.random — that was a lie)
  - Carries year, rating, genres for instant display before live enrichment

Run once locally:  python build_index.py
Produces:  cleaned_movies.csv  +  movie_embeddings.npy
"""
import json
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer

SOURCE = "tmdb_5000_movies.csv"
MODEL = "all-MiniLM-L6-v2"


def parse_genres(raw):
    try:
        items = json.loads(raw)
        return ", ".join(g["name"] for g in items) if items else ""
    except Exception:
        return ""


def main():
    print("1. Loading TMDB dataset...")
    df = pd.read_csv(SOURCE)

    # Keep only rows with a usable overview
    df = df[df["overview"].notna() & (df["overview"].str.strip() != "")].copy()

    print("2. Cleaning fields...")
    df["genres"] = df["genres"].apply(parse_genres)
    df["tmdb_id"] = df["id"].astype(int)
    df["year"] = df["release_date"].astype(str).str[:4]
    df["tmdb_rating"] = df["vote_average"]
    df["tagline"] = df["tagline"].fillna("")

    # Richer embedding text: title + genres + tagline + overview
    df["embed_text"] = (
        df["title"].fillna("") + ". "
        + df["genres"].fillna("") + ". "
        + df["tagline"].fillna("") + ". "
        + df["overview"].fillna("")
    ).str.strip()

    keep = ["tmdb_id", "title", "overview", "genres", "year", "tmdb_rating"]
    clean = df[keep].reset_index(drop=True)

    print(f"3. Loading model '{MODEL}' and embedding {len(df)} movies...")
    model = SentenceTransformer(MODEL)
    embeddings = model.encode(
        df["embed_text"].tolist(),
        show_progress_bar=True,
        batch_size=64,
    )

    print("4. Saving cleaned_movies.csv + movie_embeddings.npy ...")
    clean.to_csv("cleaned_movies.csv", index=False)
    np.save("movie_embeddings.npy", np.asarray(embeddings, dtype=np.float32))

    print(f"Done. {len(clean)} movies indexed with real TMDB IDs. No fake data.")


if __name__ == "__main__":
    main()
