// frontend/api/search.js
// Vercel serverless function. CineMatch v2 search:
//   vibe -> Gemini (structured intent) -> TMDB discover -> Gemini (curate top 5)
// No embeddings, no model server. Live, fresh, movies + TV, language-aware.
//
// Env vars (set in Vercel project settings):
//   GEMINI_API_KEY  - Google AI Studio key
//   TMDB_API_KEY    - TMDB v3 key OR v4 read token (auto-detected)

const TMDB = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const BACKDROP = "https://image.tmdb.org/t/p/w780";
const GEMINI_MODEL = "gemini-2.5-flash"; // bump to gemini-3.5-flash when you want
const GEMINI_URL = (m) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${process.env.GEMINI_API_KEY}`;

// ── TMDB helpers ───────────────────────────────────────────────────────────
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

// genre name -> id, cached for the lifetime of the warm function
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
      } catch {
        /* ignore individual keyword misses */
      }
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

// ── Gemini: vibe -> structured intent ──────────────────────────────────────
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
    },
    required: ["media_type", "genres", "keywords"],
  };
  const prompt =
    `You translate a viewer's mood/vibe into structured film & TV search intent.\n` +
    `- media_type: "movie", "tv", or "any" (use "any" unless the vibe clearly implies one).\n` +
    `- genres: 1-3 standard TMDB genres (e.g. "Science Fiction", "Thriller", "Romance").\n` +
    `- keywords: 3-8 concrete TMDB-style keywords capturing the vibe (e.g. "cyberpunk", "neo-noir", "dystopia", "slow burn"). Prefer specific over generic.\n` +
    `- min_year/max_year: only if the vibe implies an era; otherwise omit.\n` +
    `- mood: a short label.\n\n` +
    `Vibe: """${query}"""`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.3,
    },
  };
  const r = await fetch(GEMINI_URL(GEMINI_MODEL), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Gemini intent ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  return JSON.parse(text);
}

// ── TMDB discover from intent ──────────────────────────────────────────────
async function discoverFor(media, intent, opts) {
  const m = media === "tv" ? "tv" : "movie";
  const gmap = await genreMap(m);
  const genreIds = (intent.genres || [])
    .map((g) => gmap[String(g).toLowerCase()])
    .filter(Boolean);
  const kwIds = await resolveKeywords(intent.keywords);
  const dateField = m === "tv" ? "first_air_date" : "primary_release_date";

  const base = {
    sort_by: "popularity.desc",
    include_adult: "false",
    "vote_count.gte": 30,
    with_genres: genreIds.join(","),
  };
  if (intent.min_year) base[`${dateField}.gte`] = `${intent.min_year}-01-01`;
  if (intent.max_year) base[`${dateField}.lte`] = `${intent.max_year}-12-31`;
  if (opts.region) base.watch_region = opts.region;
  if (opts.includeLang) base.with_original_language = opts.includeLang;

  // Try with keywords (OR) first; fall back to genres-only if too sparse.
  let results = [];
  if (kwIds.length) {
    const d = await tmdb(`/discover/${m}`, { ...base, with_keywords: kwIds.join("|") });
    results = d.results || [];
  }
  if (results.length < 8) {
    const d = await tmdb(`/discover/${m}`, base);
    const seen = new Set(results.map((x) => x.id));
    results = results.concat((d.results || []).filter((x) => !seen.has(x.id)));
  }
  return results.map((x) => normalize(x, m));
}

// ── Gemini: curate the best 5 from candidates, with reasons ─────────────────
async function curate(query, candidates) {
  const slim = candidates.slice(0, 18).map((c) => ({
    id: c.id,
    media: c.media_type,
    title: c.title,
    year: c.year,
    overview: (c.overview || "").slice(0, 240),
  }));
  const schema = {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer" },
            media: { type: "string" },
            reason: { type: "string" },
          },
          required: ["id", "media", "reason"],
        },
      },
    },
    required: ["picks"],
  };
  const prompt =
    `A viewer wants: """${query}"""\n\n` +
    `From the candidate list below, choose the 5 that best match the vibe (mood, tone, atmosphere — not just genre). ` +
    `Order best-first. For each, give a reason of at most 12 words on why it fits. ` +
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
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{"picks":[]}';
  return JSON.parse(text).picks || [];
}

// ── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  try {
    const body = req.method === "POST" ? req.body || {} : req.query || {};
    const query = (body.query || body.q || "").toString().trim();
    const region = (body.region || "").toString().trim() || null;
    const includeLang = (body.lang || "").toString().trim() || null; // e.g. "en"
    const excludeLangs = (body.exclude_langs || "") // e.g. "hi,ta"
      .toString()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!query) return res.status(400).json({ ok: false, error: "Missing query" });
    if (!process.env.GEMINI_API_KEY || !process.env.TMDB_API_KEY) {
      return res.status(500).json({ ok: false, error: "Server missing GEMINI_API_KEY or TMDB_API_KEY" });
    }

    // 1) understand the vibe
    const intent = await extractIntent(query);

    // 2) which media to pull
    const wants = intent.media_type === "any" ? ["movie", "tv"] : [intent.media_type];
    const opts = { region, includeLang };

    // 3) discover candidates
    let candidates = [];
    for (const m of wants) {
      candidates = candidates.concat(await discoverFor(m, intent, opts));
    }
    // language exclusion (e.g. drop Bollywood when the user opted out)
    if (excludeLangs.length) {
      candidates = candidates.filter((c) => !excludeLangs.includes(c.original_language));
    }
    // de-dupe + cap
    const seen = new Set();
    candidates = candidates.filter((c) => {
      const k = `${c.media_type}-${c.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    candidates.sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
    candidates = candidates.slice(0, 18);

    if (!candidates.length) {
      return res.status(200).json({ ok: true, intent, results: [], message: "No matches — try a different vibe." });
    }

    // 4) curate the final 5 with reasons (graceful fallback to popularity order)
    let results;
    try {
      const picks = await curate(query, candidates);
      const byId = new Map(candidates.map((c) => [`${c.media_type}-${c.id}`, c]));
      results = picks
        .map((p) => {
          const c = byId.get(`${p.media}-${p.id}`) || byId.get(`movie-${p.id}`) || byId.get(`tv-${p.id}`);
          return c ? { ...c, reason: p.reason } : null;
        })
        .filter(Boolean)
        .slice(0, 5);
      if (!results.length) results = candidates.slice(0, 5);
    } catch {
      results = candidates.slice(0, 5);
    }

    return res.status(200).json({ ok: true, intent, results });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message ? e.message : e), results: [] });
  }
}
