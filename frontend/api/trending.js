// frontend/api/trending.js — TMDB-native trending (movies + TV, day/week).
import { tmdb, normalize } from "./_tmdb.js";

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const media = ["all", "movie", "tv"].includes(q.media) ? q.media : "all";
    const window = ["day", "week"].includes(q.window) ? q.window : "week";
    const limit = Math.min(parseInt(q.limit || "20", 10) || 20, 40);

    const d = await tmdb(`/trending/${media}/${window}`);
    const items = (d.results || []).filter((x) => x.media_type !== "person");
    const results = await Promise.all(items.map((x) => normalize(x, media === "all" ? null : media)));
    res.status(200).json({ ok: true, media, window, results: results.slice(0, limit) });
  } catch (e) {
    res.status(200).json({ ok: false, error: `Trending unavailable: ${e.message}`, results: [] });
  }
}
