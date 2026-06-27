import { useState, useEffect, useCallback, Fragment } from "react";
import { REGIONS } from "./config";
import "./browse.css";

// "trending" -> TMDB-native (worldwide). "discover" -> popularity by period + country.
const TABS = [
  { key: "day", label: "Today", kind: "trending" },
  { key: "week", label: "This Week", kind: "trending" },
  { key: "month", label: "This Month", kind: "discover" },
  { key: "6months", label: "Last 6 Months", kind: "discover" },
  { key: "year", label: "This Year", kind: "discover" },
];
const MEDIA = [
  { k: "all", l: "All" },
  { k: "movie", l: "Movies" },
  { k: "tv", l: "TV" },
];

export default function Browse() {
  const [media, setMedia] = useState("all");
  const [tab, setTab] = useState("week");
  const [country, setCountry] = useState("IN");
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | done | empty | error
  const [expanded, setExpanded] = useState(null);
  const [details, setDetails] = useState({});

  const current = TABS.find((t) => t.key === tab);
  const countryActive = current.kind === "discover";

  const load = useCallback(async () => {
    setStatus("loading");
    setItems([]);
    setExpanded(null);
    try {
      let results = [];
      if (current.kind === "trending") {
        const r = await fetch(`/api/trending?media=${media}&window=${tab}&limit=20`, {
          signal: AbortSignal.timeout(30000),
        });
        const d = await r.json();
        results = d.results || [];
      } else {
        const fetchOne = async (m) => {
          const r = await fetch(`/api/discover?media=${m}&period=${tab}&country=${country}&limit=20`, {
            signal: AbortSignal.timeout(30000),
          });
          const d = await r.json();
          return d.results || [];
        };
        if (media === "all") {
          const [mv, tv] = await Promise.all([fetchOne("movie"), fetchOne("tv")]);
          results = [...mv, ...tv].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 20);
        } else {
          results = await fetchOne(media);
        }
      }
      setItems(results);
      setStatus(results.length ? "done" : "empty");
    } catch (e) {
      setStatus("error");
    }
  }, [media, tab, country, current.kind]);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (item) => {
    if (expanded === item.id) { setExpanded(null); return; }
    setExpanded(item.id);
    if (!details[item.id]) {
      try {
        const r = await fetch(`/api/detail?media=${item.media_type}&id=${item.id}&region=${country || "US"}`, {
          signal: AbortSignal.timeout(30000),
        });
        const d = await r.json();
        setDetails((prev) => ({ ...prev, [item.id]: d.ok ? d.detail : { error: true } }));
      } catch {
        setDetails((prev) => ({ ...prev, [item.id]: { error: true } }));
      }
    }
  };

  return (
    <div className="browse">
      <div className="browse-controls">
        <div className="seg">
          {MEDIA.map((m) => (
            <button key={m.k} className={`seg-btn ${media === m.k ? "on" : ""}`} onClick={() => setMedia(m.k)}>
              {m.l}
            </button>
          ))}
        </div>

        <div className="pills">
          {TABS.map((t) => (
            <button key={t.key} className={`pill ${tab === t.key ? "on" : ""}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className={`country ${countryActive ? "" : "muted"}`}>
          <span>{countryActive ? "Popular in" : "🌍 Worldwide"}</span>
          {countryActive && (
            <select value={country} onChange={(e) => setCountry(e.target.value)}>
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          )}
        </div>
      </div>

      {status === "loading" && (
        <div className="browse-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <div className="browse-card sk" key={i}><div className="poster-sk" /></div>
          ))}
        </div>
      )}

      {status === "error" && <div className="browse-state">Couldn't reach the server. Try again in a moment.</div>}
      {status === "empty" && <div className="browse-state">Nothing found for this filter. Try another period or country.</div>}

      {status === "done" && (
        <div className="browse-grid">
          {items.map((item) => (
            <Fragment key={`${item.media_type}-${item.id}`}>
              <button
                className={`browse-card ${expanded === item.id ? "active" : ""}`}
                onClick={() => toggleExpand(item)}
              >
                {item.poster ? (
                  <img src={item.poster} alt={item.title} loading="lazy" />
                ) : (
                  <div className="poster-none">{item.title}</div>
                )}
                <span className={`badge ${item.media_type}`}>{item.media_type === "tv" ? "TV" : "FILM"}</span>
                <div className="card-meta">
                  <div className="card-title">{item.title}</div>
                  <div className="card-sub">
                    {item.year}{item.vote_average ? ` · ★ ${item.vote_average}` : ""}
                  </div>
                </div>
              </button>

              {expanded === item.id && (
                <div className="browse-detail">
                  <DetailPanel detail={details[item.id]} fallback={item} country={country} />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPanel({ detail, fallback, country }) {
  if (!detail) return <div className="detail-loading">Loading trailer & where to watch…</div>;
  if (detail.error) {
    return (
      <div className="detail-loading">
        Couldn't load extra details.{" "}
        <a href={`https://www.themoviedb.org/${fallback.media_type}/${fallback.id}`} target="_blank" rel="noreferrer">View on TMDB ↗</a>
      </div>
    );
  }
  const regionLabel = (REGIONS.find((r) => r.code === country) || {}).label || country;
  return (
    <div className="detail-grid">
      <div className="detail-media">
        {detail.trailer_key ? (
          <iframe
            className="trailer"
            src={`https://www.youtube.com/embed/${detail.trailer_key}`}
            title="Trailer"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <div className="trailer none">No trailer available</div>
        )}
      </div>
      <div className="detail-info">
        <h3>{detail.title} <span className="dim">{detail.year}</span></h3>
        {detail.tagline ? <p className="tagline">“{detail.tagline}”</p> : null}
        <div className="detail-stats">
          {detail.runtime ? <span>{detail.runtime} min</span> : null}
          {detail.vote_average ? <span>★ {detail.vote_average} ({detail.vote_count.toLocaleString()})</span> : null}
          {detail.genres?.length ? <span>{detail.genres.slice(0, 3).join(", ")}</span> : null}
        </div>
        <p className="detail-overview">{detail.overview}</p>
        <div className="watch">
          <div className="watch-label">Where to watch in {regionLabel}</div>
          {detail.watch_providers?.length ? (
            <div className="providers">
              {detail.watch_providers.map((p) => (
                <span className="prov" key={p.name} title={`${p.name} (${p.type})`}>
                  {p.logo ? <img src={p.logo} alt={p.name} /> : p.name}
                </span>
              ))}
            </div>
          ) : (
            <div className="watch-none">Not currently on streaming in {regionLabel}.</div>
          )}
          <div className="detail-links">
            {detail.watch_link ? <a href={detail.watch_link} target="_blank" rel="noreferrer">All options ↗</a> : null}
            {detail.imdb_url ? <a href={detail.imdb_url} target="_blank" rel="noreferrer">IMDb ↗</a> : null}
            {detail.tmdb_url ? <a href={detail.tmdb_url} target="_blank" rel="noreferrer">TMDB ↗</a> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
