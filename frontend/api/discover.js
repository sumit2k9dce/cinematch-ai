// frontend/api/discover.js — popularity-sorted discovery by period + country + genre.
import { tmdb, normalize } from "./_tmdb.js";

function dateWindow(period) {
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const back = (days) => { const d = new Date(today); d.setDate(d.getDate() - days); return d; };
  if (period === "month") return [iso(back(30)), iso(today)];
  if (period === "6months") return [iso(back(182)), iso(today)];
  if (period === "year") return [iso(new Date(today.getFullYear(), 0, 1)), iso(today)];
  return [null, null];
}

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const media = q.media === "tv" ? "tv" : "movie";
    const period = q.period || "month";
    const country = q.country || "";
    const genre = q.genre || "";
    const page = Math.max(1, parseInt(q.page || "1", 10) || 1);
    const limit = Math.min(parseInt(q.limit || "20", 10) || 20, 40);

    const [gte, lte] = dateWindow(period);
    const dateField = media === "tv" ? "first_air_date" : "primary_release_date";
    const params = { sort_by: "popularity.desc", page, include_adult: "false", "vote_count.gte": 50 };
    if (gte) { params[`${dateField}.gte`] = gte; params[`${dateField}.lte`] = lte; }
    if (country) params.watch_region = country;
    if (genre) params.with_genres = genre;

    const d = await tmdb(`/discover/${media}`, params);
    const results = await Promise.all((d.results || []).map((x) => normalize(x, media)));
    res.status(200).json({ ok: true, media, period, country, results: results.slice(0, limit) });
  } catch (e) {
    res.status(200).json({ ok: false, error: `Discover unavailable: ${e.message}`, results: [] });
  }
}
