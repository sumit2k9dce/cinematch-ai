# 🎬 CineMatch

Semantic film discovery. Describe a *vibe* — "a rain-soaked neo-noir where the detective is the real mystery" — and get the films that feel like it, ranked by semantic similarity, enriched with posters, IMDb / Rotten Tomatoes / Metacritic scores, trailers, and where-to-watch.

Not genre filters. Not keyword matching. Actual meaning, via sentence embeddings.

---

## How it works

```
        ┌─────────────┐      embeddings        ┌──────────────┐
 vibe → │  React (UI) │ ───────────────────→   │ FastAPI (API)│
        └─────────────┘   POST /search         └──────┬───────┘
                                                       │
                          ┌────────────────────────────┼───────────────┐
                          │                             │               │
                  all-MiniLM-L6-v2              TMDB API          OMDb API
               (cosine similarity over      posters, trailers,   IMDb / RT /
                4,799 movie vectors)         where-to-watch       Metacritic
```

- **Semantic search** runs locally (no paid vector DB). Embeddings are precomputed once.
- **Enrichment** (posters, ratings, trailers, where-to-watch) is fetched live for the top 5 only, so we stay well under OMDb's 1,000/day free limit.
- **Graceful degradation:** if TMDB or OMDb is down, you still get semantic matches with whatever data is available. Nothing crashes.

---

## Project layout

```
cinematch/
├── app.py                 # FastAPI backend (/search, /health, /examples)
├── build_index.py         # One-time: builds embeddings from TMDB dataset
├── config.py              # All backend settings
├── core/
│   ├── search.py          # Vectorized semantic search engine
│   └── enrich.py          # Resilient TMDB + OMDb enrichment
├── cleaned_movies.csv     # Movie metadata WITH real TMDB IDs
├── movie_embeddings.npy   # Precomputed vectors (you generate this once)
├── tmdb_5000_movies.csv   # Source dataset
├── requirements.txt
├── render.yaml            # One-click Render deploy
└── frontend/              # React + Vite app
    ├── src/
    │   ├── App.jsx        # Main app, all the resilience logic
    │   ├── MovieCard.jsx  # Rich result card
    │   ├── ChaiButton.jsx # UPI "buy me a chai" support
    │   ├── config.js      # API URL + UPI ID
    │   └── styles.css     # "Projector booth" noir design system
    └── vercel.json
```

---

## Run locally

### 1. Build the search index (once, ~2 min)

```bash
pip install -r requirements.txt
python build_index.py          # creates cleaned_movies.csv + movie_embeddings.npy
```

### 2. Start the backend

```bash
export TMDB_API_KEY=your_key
export OMDB_API_KEY=your_key
uvicorn app:app --reload --port 8000
```

Check it: open http://localhost:8000/health → should say `"ready": true`.

### 3. Start the frontend

```bash
cd frontend
npm install
echo "VITE_API_URL=http://localhost:8000" > .env
npm run dev
```

Open http://localhost:5173.

---

## Deploy (all free)

### Backend → Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com): **New → Blueprint** → pick your repo (it reads `render.yaml`).
3. Set env vars in the Render dashboard: `TMDB_API_KEY`, `OMDB_API_KEY`, and `FRONTEND_ORIGIN` (your Vercel URL, added after step below).
4. Deploy. Note your backend URL, e.g. `https://cinematch-api.onrender.com`.

> Render's free tier sleeps after 15 min idle. The frontend handles this with a "waking up" banner and auto-retry, so the first search after a nap just takes ~30s.

### Frontend → Vercel

1. On [vercel.com](https://vercel.com): **New Project** → pick your repo → set **Root Directory** to `frontend`.
2. Add env var `VITE_API_URL` = your Render backend URL.
3. Deploy. Copy the Vercel URL back into Render's `FRONTEND_ORIGIN`.

Done.

---

## Free API limits

| Service | Free limit | We use |
|---|---|---|
| TMDB | ~50 req/sec, no daily cap | 1 call per result (top 5) |
| OMDb | 1,000 req/day | 1 call per result (top 5) |

At 5 enrichments per search, OMDb's 1,000/day covers ~200 searches/day. Plenty for a portfolio demo. To scale, cache enrichment results (24h) or upgrade OMDb.

---

## Support

If CineMatch helped you, there's a **Buy me a chai ☕** button (UPI). Zero fees, zero middleman.

---

*This product uses the TMDB and OMDb APIs but is not endorsed or certified by either. Movie data © their respective owners.*
