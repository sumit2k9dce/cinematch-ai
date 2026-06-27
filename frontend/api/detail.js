// frontend/api/detail.js — inline expand: trailer + where-to-watch (movies + TV).
import { tmdb, img } from "./_tmdb.js";

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const media = q.media === "tv" ? "tv" : "movie";
    const id = parseInt(q.id || "0", 10);
    const region = q.region || "US";
    if (!id) return res.status(400).json({ ok: false, error: "Missing id", detail: null });

    const data = await tmdb(`/${media}/${id}`, { append_to_response: "videos,watch/providers,external_ids" });

    const vids = (data.videos && data.videos.results) || [];
    const yt = vids.filter((v) => v.site === "YouTube");
    const trailer = yt.find((v) => v.type === "Trailer") || yt[0] || null;

    const wp = (data["watch/providers"] && data["watch/providers"].results) || {};
    const regionData = wp[region] || {};
    const seen = new Set();
    const providers = [];
    for (const kind of ["flatrate", "rent", "buy"]) {
      for (const p of regionData[kind] || []) {
        if (p.provider_name && !seen.has(p.provider_name)) {
          seen.add(p.provider_name);
          providers.push({ name: p.provider_name, logo: img(p.logo_path, "w92"), type: kind });
        }
      }
    }

    let runtime = data.runtime;
    if (!runtime && data.episode_run_time && data.episode_run_time.length) runtime = data.episode_run_time[0];

    const isTv = media === "tv";
    const date = isTv ? data.first_air_date : data.release_date;
    const imdb = (data.external_ids && data.external_ids.imdb_id) || null;

    res.status(200).json({
      ok: true,
      detail: {
        id, media_type: media,
        title: isTv ? data.name : data.title,
        year: date ? String(date).slice(0, 4) : "",
        tagline: data.tagline || "",
        overview: data.overview || "",
        runtime: runtime || null,
        genres: (data.genres || []).map((g) => g.name),
        vote_average: Math.round((data.vote_average || 0) * 10) / 10,
        vote_count: data.vote_count || 0,
        trailer_key: trailer ? trailer.key : null,
        trailer_url: trailer ? `https://www.youtube.com/watch?v=${trailer.key}` : null,
        watch_providers: providers,
        watch_link: regionData.link || null,
        watch_region: region,
        imdb_id: imdb,
        imdb_url: imdb ? `https://www.imdb.com/title/${imdb}/` : null,
        tmdb_url: `https://www.themoviedb.org/${media}/${id}`,
      },
    });
  } catch (e) {
    res.status(200).json({ ok: false, error: `Detail unavailable: ${e.message}`, detail: null });
  }
}
