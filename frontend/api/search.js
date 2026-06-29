// frontend/api/search.js
// CineMatch v2 search: vibe -> Gemini intent -> TMDB discover (popular + canonical) -> Gemini curate.

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_URL = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`;

function tmdbAuth() {
  const key = process.env.TMDB_API_KEY || "";
  return key.startsWith("eyJ")
    ? { headers: { Authorization: `Bearer ${key}` }, qkey: null }
    : { headers: {}, qkey: key };
}
async function tmdb(path, params = {}) {
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

const GENRE_CACHE = {};
async function genreMap(media) {
  const m = media === "tv" ? "tv" : "movie";
  if (!GENRE_CACHE[m]) {
    const d = await tmdb(`/genre/${m}/list`);
    GENRE_CACHE[m] = {};
    for (const g of d.genres || []) GENRE_CACHE[m][g.name.toLowerCase()] = g.id;
  }
  return GENRE_CACHE[m];
}
async function resolveKeywords(terms) {
  const ids = [];
  await Promise.all(
    (terms || []).slice(0, 8).map(async (t) => {
      try {
        const d = await tmdb(`/search/keyword`, { query: t });
        if (d.results && d.results[0]) ids.push(d.results[0].id);
      } catch {}
    })
  );
  return ids;
}
function normalize(item, mediaHint) {
  const media = item.media_type || mediaHint || "movie";
  const isTv = media === "tv";
  const date = isTv ? item.first_air_date : item.release_date;
  return {
    id: item.id,
    media_type: media,
    title: (isTv ? item.name : item.title) || "Untitled",
    year: date ? String(date).slice(0, 4) : "",
    overview: item.overview || "",
    poster: item.poster_path ? IMG + item.poster_path : null,
    backdrop: item.backdrop_path ? BACKDROP + item.backdrop_path : null,
    vote_average: Math.round((item.vote_average || 0) * 10) / 10,
    vote_count: item.vote_count || 0,
    original_language: item.original_language || "",
    tmdb_url: `https://www.themoviedb.org/${media}/${item.id}`,
  };
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Find a film/show by name. exact=true requires the query to equal a title
// (so "Blade Runner" matches but "neon cyberpunk" doesn't); exact=false takes
// the most popular hit (used for a Gemini-extracted reference title).
async function titleSearch(query, { exact }) {
  let d;
  try {
    d = await tmdb(`/search/multi`, { query, include_adult: "false" });
  } catch {
    return null;
  }
  const items = (d.results || []).filter((x) => x.media_type === "movie" || x.media_type === "tv");
  if (!items.length) return null;
  if (exact) {
    const nq = norm(query);
    const ex = items
      .filter((x) => norm(x.title || x.name) === nq)
      .sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
    return ex.length ? normalize(ex[0], ex[0].media_type) : null;
  }
  const top = items.sort((a, b) => (b.popularity || 0) - (a.popularity || 0))[0];
  return normalize(top, top.media_type);
}

// Build a "title / similar" response shared by exact-title and reference modes.
async function similarResponse(seed, excludeLangs, modeLabel) {
  let recs = await recommendationsFor(seed.media_type, seed.id);
  if (excludeLangs.length) recs = recs.filter((c) => !excludeLangs.includes(c.original_language));
  const seenT = new Set([`${seed.media_type}-${seed.id}`]);
  recs = recs.filter((c) => {
    const k = `${c.media_type}-${c.id}`;
    if (seenT.has(k)) return false;
    seenT.add(k);
    return true;
  });
  recs.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  return {
    ok: true,
    mode: modeLabel,
    seed_title: seed.title,
    intent: { mood: `Like ${seed.title}`, keywords: seed.genres || [] },
    results: [{ ...seed, reason: "The title your search references." }],
    more: recs.slice(0, 14),
  };
}

// TMDB's own "more like this" — recommendations + similar.
async function recommendationsFor(media, id) {
  const out = [];
  for (const ep of ["recommendations", "similar"]) {
    try {
      const d = await tmdb(`/${media}/${id}/${ep}`);
      out.push(...(d.results || []));
    } catch {}
  }
  return out.map((x) => normalize(x, media));
}

async function extractIntent(query) {
  const schema = {
    type: "object",
    properties: {
      media_type: { type: "string", enum: ["movie", "tv", "any"] },
      genres: { type: "array", items: { type: "string" } },
      keywords: { type: "array", items: { type: "string" } },
      min_year: { type: "integer" },
      max_year: { type: "integer" },
      mood: { type: "string" },
      reference_title: { type: "string" },
    },
    required: ["media_type", "genres", "keywords"],
  };
  const prompt =
    `You translate a viewer's mood/vibe into structured film & TV search intent.\n` +
    `- media_type: "movie", "tv", or "any" (use "any" unless the vibe clearly implies one).\n` +
    `- genres: 1-3 standard TMDB genres.\n` +
    `- keywords: 3-8 concrete TMDB-style keywords capturing the vibe (e.g. "cyberpunk","neo-noir","dystopia","slow burn"). Prefer specific over generic.\n` +
    `- min_year/max_year: only if the vibe implies an era; otherwise omit.\n` +
    `- mood: a short label.\n` +
    `- reference_title: if the user references a specific existing film or show to find similar titles to (e.g. "movies like Inception", "sholay like story"), put its canonical title here; otherwise leave empty.\n\n` +
    `Vibe: """${query}"""`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.3 },
  };
  const r = await fetch(GEMINI_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini intent ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
}

// Discover candidates.
// KEY FIX: genres are OR (pipe), not AND (comma). Blade Runner is Sci-Fi/Thriller/Drama
// but NOT "Mystery", so an AND of 3 Gemini genres excluded it from every pass.
// Pass A: the most distinctive keywords by vote count -> surfaces the canon.
// Pass B: genre OR + keyword OR by popularity -> fresh / current matches.
async function discoverFor(media, intent, opts) {
  const m = media === "tv" ? "tv" : "movie";
  const gmap = await genreMap(m);
  const genreIds = (intent.genres || []).map((g) => gmap[String(g).toLowerCase()]).filter(Boolean);
  const kwIds = await resolveKeywords(intent.keywords);
  const dateField = m === "tv" ? "first_air_date" : "primary_release_date";

  const common = { include_adult: "false" };
  if (intent.min_year) common[`${dateField}.gte`] = `${intent.min_year}-01-01`;
  if (intent.max_year) common[`${dateField}.lte`] = `${intent.max_year}-12-31`;
  if (opts.region) common.watch_region = opts.region;
  if (opts.includeLang) common.with_original_language = opts.includeLang;

  const coreKw = kwIds.slice(0, 3).join("|"); // most distinctive (Gemini lists specific-first)
  const allKw = kwIds.join("|");
  const genresOR = genreIds.join("|");

  const calls = [];
  if (coreKw) {
    calls.push(tmdb(`/discover/${m}`, { ...common, with_keywords: coreKw, sort_by: "vote_count.desc", "vote_count.gte": 400 }));
  }
  calls.push(
    tmdb(`/discover/${m}`, {
      ...common,
      with_genres: genresOR,
      ...(allKw ? { with_keywords: allKw } : {}),
      sort_by: "popularity.desc",
      "vote_count.gte": 50,
    })
  );
  let lists = await Promise.all(calls.map((p) => p.then((d) => d.results || []).catch(() => [])));
  let merged = [].concat(...lists);
  if (merged.length < 10 && genresOR) {
    const d = await tmdb(`/discover/${m}`, { ...common, with_genres: genresOR, sort_by: "vote_count.desc", "vote_count.gte": 300 }).catch(() => ({ results: [] }));
    merged = merged.concat(d.results || []);
  }
  return merged.map((x) => normalize(x, m));
}

async function curate(query, candidates, n) {
  const slim = candidates.slice(0, 24).map((c) => ({
    id: c.id, media: c.media_type, title: c.title, year: c.year,
    overview: (c.overview || "").slice(0, 220),
  }));
  const schema = {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "integer" }, media: { type: "string" }, reason: { type: "string" } },
          required: ["id", "media", "reason"],
        },
      },
    },
    required: ["picks"],
  };
  const prompt =
    `A viewer wants: """${query}"""\n\n` +
    `From the candidates below, choose the ${n} best matches for the VIBE (mood, tone, atmosphere). ` +
    `Order best-first. Prioritize genre-defining or iconic titles for this vibe as well as strong matches — ` +
    `don't skip a landmark film just because it's older. For each, give a reason of at most 12 words. ` +
    `Only use ids from the list.\n\nCandidates:\n${JSON.stringify(slim)}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.4 },
  };
  const r = await fetch(GEMINI_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini curate ${r.status}`);
  const data = await r.json();
  return JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"picks":[]}').picks || [];
}

export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? req.body || {} : req.query || {};
    const query = (body.query || body.q || "").toString().trim();
    const region = (body.region || "").toString().trim() || null;
    const includeLang = (body.lang || "").toString().trim() || null;
    const excludeLangs = (body.exclude_langs || "").toString().split(",").map((s) => s.trim()).filter(Boolean);

    if (!query) return res.status(400).json({ ok: false, error: "Missing query" });
    if (!process.env.GEMINI_API_KEY || !process.env.TMDB_API_KEY) {
      return res.status(500).json({ ok: false, error: "Server missing GEMINI_API_KEY or TMDB_API_KEY" });
    }

    // Title mode: user typed an exact film/show name -> return it + similar.
    const exactSeed = await titleSearch(query, { exact: true });
    if (exactSeed) {
      return res.status(200).json(await similarResponse(exactSeed, excludeLangs, "title"));
    }

    const intent = await extractIntent(query);

    // Reference mode: "movies like X" / "X like story" -> X + its recommendations.
    if (intent.reference_title && norm(intent.reference_title)) {
      const refSeed = await titleSearch(intent.reference_title, { exact: false });
      if (refSeed) {
        return res.status(200).json(await similarResponse(refSeed, excludeLangs, "similar"));
      }
    }

    // Explicit movie/tv filter from the UI overrides Gemini's guess.
    const mediaParam = (body.media || "").toString().trim().toLowerCase();
    let wants;
    if (mediaParam === "movie" || mediaParam === "tv") wants = [mediaParam];
    else if (mediaParam === "all") wants = ["movie", "tv"];
    else wants = intent.media_type === "any" ? ["movie", "tv"] : [intent.media_type];
    const opts = { region, includeLang };

    let candidates = [];
    for (const m of wants) candidates = candidates.concat(await discoverFor(m, intent, opts));
    if (excludeLangs.length) candidates = candidates.filter((c) => !excludeLangs.includes(c.original_language));

    // de-dupe
    const seen = new Set();
    candidates = candidates.filter((c) => {
      const k = `${c.media_type}-${c.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // order: blend of popularity (current) and recognizability (vote_count)
    candidates.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));

    if (!candidates.length) {
      return res.status(200).json({ ok: true, intent, results: [], more: [], message: "No matches — try a different vibe." });
    }

    let results, picksIds = new Set();
    try {
      const picks = await curate(query, candidates, 8);
      const byId = new Map(candidates.map((c) => [`${c.media_type}-${c.id}`, c]));
      results = picks
        .map((p) => {
          const c = byId.get(`${p.media}-${p.id}`) || byId.get(`movie-${p.id}`) || byId.get(`tv-${p.id}`);
          if (c) picksIds.add(`${c.media_type}-${c.id}`);
          return c ? { ...c, reason: p.reason } : null;
        })
        .filter(Boolean)
        .slice(0, 8);
      if (!results.length) results = candidates.slice(0, 8);
    } catch {
      results = candidates.slice(0, 8);
    }
    if (!picksIds.size) results.forEach((c) => picksIds.add(`${c.media_type}-${c.id}`));

    // "More like this": next candidates not already picked
    const more = candidates.filter((c) => !picksIds.has(`${c.media_type}-${c.id}`)).slice(0, 12);

    return res.status(200).json({ ok: true, intent, results, more });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e), results: [], more: [] });
  }
}
