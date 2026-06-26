"""
core/browse.py — Live TMDB browse/trending/discover client.

Pure passthrough to TMDB. No embeddings, no local dataset — always fresh.
Powers the Browse tab: trending today/this week, and popularity-sorted
discovery by period and country, for both movies and TV.

Reuses TMDB_API_KEY (the same key enrichment already uses). Supports both
v3 api_key auth and v4 bearer-token auth automatically.
"""
import os
import time
import datetime as dt

import requests

TMDB_BASE = "https://api.themoviedb.org/3"
IMG = "https://image.tmdb.org/t/p"
TIMEOUT = 6
RETRIES = 2

# Module-level caches (process-lifetime; fine for a single web worker).
_GENRE_CACHE = {}   # media_type -> {id: name}


def _api_key():
    return os.environ.get("TMDB_API_KEY", "") or getattr(__import__("config"), "TMDB_API_KEY", "")


def _headers_and_params(extra=None):
    """Return (headers, params) wired for whichever auth style the key uses."""
    key = _api_key()
    params = dict(extra or {})
    headers = {"accept": "application/json"}
    # v4 read-access tokens are JWTs (start with 'eyJ'); everything else is a v3 key.
    if key.startswith("eyJ"):
        headers["Authorization"] = f"Bearer {key}"
    else:
        params["api_key"] = key
    return headers, params


def _get(path, params=None):
    """GET a TMDB path with retries. Returns parsed JSON or raises."""
    headers, p = _headers_and_params(params)
    last = None
    for attempt in range(RETRIES + 1):
        try:
            r = requests.get(f"{TMDB_BASE}{path}", headers=headers, params=p, timeout=TIMEOUT)
            r.raise_for_status()
            return r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            if attempt < RETRIES:
                time.sleep(0.4 * (attempt + 1))
    raise last


def _genres(media_type):
    """Cached {genre_id: name} map for 'movie' or 'tv'."""
    mt = "tv" if media_type == "tv" else "movie"
    if mt not in _GENRE_CACHE:
        try:
            data = _get(f"/genre/{mt}/list")
            _GENRE_CACHE[mt] = {g["id"]: g["name"] for g in data.get("genres", [])}
        except Exception:
            _GENRE_CACHE[mt] = {}
    return _GENRE_CACHE[mt]


def _poster(path, size="w500"):
    return f"{IMG}/{size}{path}" if path else None


def _normalize(item, media_hint=None):
    """Flatten a TMDB movie/tv result into one common card shape."""
    media = item.get("media_type") or media_hint or "movie"
    is_tv = media == "tv"
    title = item.get("name") if is_tv else item.get("title")
    date = item.get("first_air_date") if is_tv else item.get("release_date")
    gmap = _genres(media)
    genres = [gmap.get(gid) for gid in item.get("genre_ids", []) if gmap.get(gid)]
    return {
        "id": item.get("id"),
        "media_type": media,
        "title": title or "Untitled",
        "year": (str(date)[:4] if date else ""),
        "overview": item.get("overview", ""),
        "poster": _poster(item.get("poster_path")),
        "backdrop": _poster(item.get("backdrop_path"), size="w780"),
        "vote_average": round(item.get("vote_average", 0) or 0, 1),
        "vote_count": item.get("vote_count", 0) or 0,
        "genres": genres,
        "origin_country": item.get("origin_country", []),
        "tmdb_url": f"https://www.themoviedb.org/{media}/{item.get('id')}",
    }


def trending(media="all", window="week", limit=20):
    """TMDB-native trending. media ∈ {all,movie,tv}; window ∈ {day,week}."""
    media = media if media in ("all", "movie", "tv") else "all"
    window = window if window in ("day", "week") else "week"
    data = _get(f"/trending/{media}/{window}")
    results = []
    for it in data.get("results", []):
        if it.get("media_type") == "person":
            continue  # skip people in 'all'
        results.append(_normalize(it, media_hint=(None if media == "all" else media)))
    return results[:limit]


def _date_window(period):
    """Map a period keyword to (gte, lte) ISO dates, or (None, None) for all-time."""
    today = dt.date.today()
    if period == "month":
        return (today - dt.timedelta(days=30)).isoformat(), today.isoformat()
    if period == "6months":
        return (today - dt.timedelta(days=182)).isoformat(), today.isoformat()
    if period == "year":
        return dt.date(today.year, 1, 1).isoformat(), today.isoformat()
    return None, None  # all-time


def discover(media="movie", period="month", country=None, genre=None, page=1, limit=20):
    """
    Popularity-sorted discovery with optional period + country + genre filters.

    period  ∈ {month, 6months, year, all}  → release-date window
    country : ISO-3166-1 (e.g. 'IN') → watch_region (what's popular where you are)
    genre   : a TMDB genre id (int) for the chosen media type
    """
    media = "tv" if media == "tv" else "movie"
    gte, lte = _date_window(period)
    date_field = "first_air_date" if media == "tv" else "primary_release_date"

    params = {
        "sort_by": "popularity.desc",
        "page": max(1, int(page)),
        "include_adult": "false",
        "vote_count.gte": 50,  # filter out unrated noise
    }
    if gte:
        params[f"{date_field}.gte"] = gte
        params[f"{date_field}.lte"] = lte
    if country:
        params["watch_region"] = country
    if genre:
        params["with_genres"] = str(genre)

    data = _get(f"/discover/{media}", params)
    return [_normalize(it, media_hint=media) for it in data.get("results", [])][:limit]


def detail(media, tmdb_id, region="US"):
    """
    Full detail for inline expand: trailer + where-to-watch + ratings.
    One TMDB call via append_to_response. Works for both movies and TV.
    """
    media = "tv" if media == "tv" else "movie"
    data = _get(
        f"/{media}/{tmdb_id}",
        {"append_to_response": "videos,watch/providers,external_ids"},
    )

    # Trailer: prefer an official YouTube trailer, else any YouTube clip.
    vids = (data.get("videos") or {}).get("results", [])
    yt = [v for v in vids if v.get("site") == "YouTube"]
    trailer = next((v for v in yt if v.get("type") == "Trailer"), None) or (yt[0] if yt else None)

    # Where-to-watch for the requested region (JustWatch data).
    region_data = ((data.get("watch/providers") or {}).get("results") or {}).get(region) or {}
    providers, seen = [], set()
    for kind in ("flatrate", "rent", "buy"):
        for p in region_data.get(kind, []):
            name = p.get("provider_name")
            if name and name not in seen:
                seen.add(name)
                providers.append({"name": name, "logo": _poster(p.get("logo_path"), "w92"), "type": kind})

    runtime = data.get("runtime")
    if not runtime and data.get("episode_run_time"):
        runtime = data["episode_run_time"][0]

    title = data.get("name") if media == "tv" else data.get("title")
    date = data.get("first_air_date") if media == "tv" else data.get("release_date")

    return {
        "id": tmdb_id,
        "media_type": media,
        "title": title,
        "year": (str(date)[:4] if date else ""),
        "tagline": data.get("tagline", ""),
        "overview": data.get("overview", ""),
        "runtime": runtime,
        "genres": [g.get("name") for g in data.get("genres", [])],
        "vote_average": round(data.get("vote_average", 0) or 0, 1),
        "vote_count": data.get("vote_count", 0) or 0,
        "trailer_key": trailer.get("key") if trailer else None,
        "trailer_url": (f"https://www.youtube.com/watch?v={trailer['key']}" if trailer else None),
        "watch_providers": providers,
        "watch_link": region_data.get("link"),
        "watch_region": region,
        "imdb_id": (data.get("external_ids") or {}).get("imdb_id"),
        "imdb_url": (
            f"https://www.imdb.com/title/{data['external_ids']['imdb_id']}/"
            if (data.get("external_ids") or {}).get("imdb_id") else None
        ),
        "tmdb_url": f"https://www.themoviedb.org/{media}/{tmdb_id}",
    }


def genre_list(media="movie"):
    """Expose the genre map for the frontend filter dropdown."""
    gmap = _genres(media)
    return [{"id": gid, "name": name} for gid, name in sorted(gmap.items(), key=lambda x: x[1])]
