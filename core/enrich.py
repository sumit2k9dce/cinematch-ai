"""core/enrich.py — Live metadata enrichment from TMDB + OMDb.

Every external call is wrapped so a failure NEVER breaks a search.
If TMDB is down, you still get semantic results (just without posters).
If OMDb is down, you still get TMDB data (just without RT/Metacritic).
"""
import requests
from config import (
    TMDB_API_KEY, OMDB_API_KEY, TMDB_BASE, TMDB_IMG, OMDB_BASE, DEFAULT_REGION,
)

TIMEOUT = 6  # seconds — fail fast, don't hang the user


def _safe_get(url, params=None):
    """GET with timeout + one retry. Returns dict or None. Never raises."""
    for attempt in range(2):
        try:
            r = requests.get(url, params=params, timeout=TIMEOUT)
            if r.status_code == 200:
                return r.json()
            # 401/404 etc — no point retrying
            if r.status_code in (401, 404):
                return None
        except requests.RequestException:
            if attempt == 0:
                continue  # retry once
    return None


def enrich_movie(tmdb_id: int, region: str = DEFAULT_REGION):
    """Fetch posters, ratings, trailer, where-to-watch for one movie.

    Returns a dict of whatever succeeded. Missing pieces are simply absent.
    """
    out = {}
    if not tmdb_id or not TMDB_API_KEY:
        return out

    # --- TMDB: details + videos + watch providers in one call ---
    data = _safe_get(
        f"{TMDB_BASE}/movie/{tmdb_id}",
        params={
            "api_key": TMDB_API_KEY,
            "append_to_response": "videos,watch/providers",
        },
    )

    if data:
        out["title"] = data.get("title")
        out["year"] = (data.get("release_date") or "")[:4]
        out["runtime"] = data.get("runtime")
        out["tmdb_rating"] = round(data.get("vote_average", 0), 1) or None
        out["tmdb_votes"] = data.get("vote_count")
        out["tagline"] = data.get("tagline")
        out["imdb_id"] = data.get("imdb_id")
        out["tmdb_url"] = f"https://www.themoviedb.org/movie/{tmdb_id}"

        if data.get("poster_path"):
            out["poster"] = TMDB_IMG + data["poster_path"]
        if data.get("backdrop_path"):
            out["backdrop"] = TMDB_IMG + data["backdrop_path"]

        # Trailer: first YouTube "Trailer" type video
        videos = (data.get("videos") or {}).get("results", [])
        trailer = next(
            (v for v in videos if v.get("site") == "YouTube" and v.get("type") == "Trailer"),
            None,
        ) or next((v for v in videos if v.get("site") == "YouTube"), None)
        if trailer:
            out["trailer_key"] = trailer["key"]
            out["trailer_url"] = f"https://www.youtube.com/watch?v={trailer['key']}"

        # Where to watch — region-aware, with TMDB/JustWatch deeplink page
        providers = (data.get("watch/providers") or {}).get("results", {})
        region_data = providers.get(region) or providers.get("US") or {}
        watch = []
        seen = set()
        for kind in ("flatrate", "rent", "buy"):
            for p in region_data.get(kind, []):
                name = p.get("provider_name")
                if name and name not in seen:
                    seen.add(name)
                    watch.append({
                        "name": name,
                        "logo": TMDB_IMG + p["logo_path"] if p.get("logo_path") else None,
                        "type": kind,
                    })
        out["watch_providers"] = watch
        out["watch_link"] = region_data.get("link")  # TMDB watch page (JustWatch-powered)
        out["watch_region"] = region

    # --- OMDb: IMDb + Rotten Tomatoes + Metacritic in one call ---
    imdb_id = out.get("imdb_id")
    if imdb_id and OMDB_API_KEY:
        omdb = _safe_get(OMDB_BASE, params={"apikey": OMDB_API_KEY, "i": imdb_id})
        if omdb and omdb.get("Response") == "True":
            out["imdb_rating"] = omdb.get("imdbRating") if omdb.get("imdbRating") != "N/A" else None
            out["imdb_votes"] = omdb.get("imdbVotes") if omdb.get("imdbVotes") != "N/A" else None
            out["rated"] = omdb.get("Rated") if omdb.get("Rated") != "N/A" else None
            out["director"] = omdb.get("Director") if omdb.get("Director") != "N/A" else None
            out["actors"] = omdb.get("Actors") if omdb.get("Actors") != "N/A" else None
            out["awards"] = omdb.get("Awards") if omdb.get("Awards") != "N/A" else None
            if imdb_id:
                out["imdb_url"] = f"https://www.imdb.com/title/{imdb_id}/"

            # Ratings array has RT + Metacritic
            for rating in omdb.get("Ratings", []):
                src = rating.get("Source", "")
                val = rating.get("Value", "")
                if src == "Rotten Tomatoes":
                    out["rt_rating"] = val  # e.g. "87%"
                elif src == "Metacritic":
                    out["metacritic"] = val.split("/")[0] if "/" in val else val

    return out
