// frontend/api/_tmdb.js — shared TMDB helpers for the serverless browse endpoints.
// Underscore prefix => Vercel does not expose this as a route.
const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p";

export function tmdbAuth() {
  const key = process.env.TMDB_API_KEY || "";
  return key.startsWith("eyJ")
    ? { headers: { Authorization: `Bearer ${key}` }, qkey: null }
    : { headers: {}, qkey: key };
}

export async function tmdb(path, params = {}) {
  const { headers, qkey } = tmdbAuth();
  const u = new URL(TMDB + path);
  if (qkey) u.searchParams.set("api_key", qkey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  const r = await fetch(u, { headers });
  if (!r.ok) throw new Error(`TMDB ${path} -> ${r.status}`);
  return r.json();
}

export function img(path, size = "w500") {
  return path ? `${IMG}/${size}${path}` : null;
}

const GENRE_CACHE = {};
export async function genreMap(media) {
  const m = media === "tv" ? "tv" : "movie";
  if (!GENRE_CACHE[m]) {
    const d = await tmdb(`/genre/${m}/list`);
    GENRE_CACHE[m] = {};
    for (const g of d.genres || []) GENRE_CACHE[m][g.id] = g.name;
  }
  return GENRE_CACHE[m];
}

export async function genreList(media) {
  const gm = await genreMap(media);
  return Object.entries(gm)
    .map(([id, name]) => ({ id: Number(id), name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function normalize(item, mediaHint) {
  const media = item.media_type || mediaHint || "movie";
  const isTv = media === "tv";
  const date = isTv ? item.first_air_date : item.release_date;
  const gm = await genreMap(media);
  const genres = (item.genre_ids || []).map((id) => gm[id]).filter(Boolean);
  return {
    id: item.id,
    media_type: media,
    title: (isTv ? item.name : item.title) || "Untitled",
    year: date ? String(date).slice(0, 4) : "",
    overview: item.overview || "",
    poster: img(item.poster_path),
    backdrop: img(item.backdrop_path, "w780"),
    vote_average: Math.round((item.vote_average || 0) * 10) / 10,
    vote_count: item.vote_count || 0,
    genres,
    origin_country: item.origin_country || [],
    tmdb_url: `https://www.themoviedb.org/${media}/${item.id}`,
  };
}
