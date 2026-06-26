import { useState, useEffect, useRef } from "react";
import { API_URL, REGIONS } from "./config";
import MovieCard from "./MovieCard";
import ChaiButton from "./ChaiButton";
import Browse from "./Browse";

const FALLBACK_EXAMPLES = [
  "A neon-drenched cyberpunk detective story with existential dread",
  "Cozy small-town romance that feels like a warm hug",
  "Slow-burn psychological thriller where nothing is as it seems",
  "Mind-bending sci-fi that makes you question reality",
];

export default function App() {
  const [view, setView] = useState("match"); // match | browse

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("IN");
  const [examples, setExamples] = useState(FALLBACK_EXAMPLES);

  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error | empty
  const [errorMsg, setErrorMsg] = useState("");
  const [waking, setWaking] = useState(false); // cold-start banner
  const lastQuery = useRef("");

  // Warm up backend + fetch examples on mount (handles Render cold start early)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`${API_URL}/examples`, { signal: AbortSignal.timeout(8000) });
        if (!cancelled && r.ok) {
          const data = await r.json();
          if (data.examples?.length) setExamples(data.examples);
        }
      } catch {
        // backend may be cold; ignore — we have fallbacks
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Re-warm the backend whenever the tab regains focus or becomes visible.
  useEffect(() => {
    const warm = () =>
      fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => {});
    const onVis = () => { if (document.visibilityState === "visible") warm(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", warm);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", warm);
    };
  }, []);

  async function runSearch(q) {
    const vibe = (q ?? query).trim();
    if (!vibe) return;
    lastQuery.current = vibe;
    setStatus("loading");
    setErrorMsg("");
    setWaking(false);

    const wakeTimer = setTimeout(() => setWaking(true), 4000);

    const attempt = async (timeoutMs) => {
      const res = await fetch(`${API_URL}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vibe, region, top_k: 5, enrich: true }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      return res.json();
    };

    try {
      setWaking(true);
      const data = await attempt(90000);

      clearTimeout(wakeTimer);
      setWaking(false);

      if (!data.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong.");
        return;
      }
      if (!data.results?.length) {
        setStatus("empty");
        setErrorMsg(data.message || "No strong matches found.");
        return;
      }
      setResults(data.results);
      setStatus("done");
    } catch (e) {
      clearTimeout(wakeTimer);
      setWaking(false);
      setStatus("error");
      if (e.name === "TimeoutError") {
        setErrorMsg("The server is waking up and took too long. Give it ~30s and try again.");
      } else {
        setErrorMsg("Couldn't reach the server. Check your connection and try again.");
      }
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      runSearch();
    }
  }

  return (
    <div className="wrap">
      <header className="hero">
        <div className="eyebrow">Semantic Film Discovery</div>
        <h1 className="title">CINEMATCH<span className="dot">.</span></h1>
        <p className="subtitle">
          Describe a mood, not a genre. We'll find the films that feel like it.
        </p>

        {/* Mode tabs */}
        <div className="tabs">
          <button
            className={`tab ${view === "match" ? "on" : ""}`}
            onClick={() => setView("match")}
          >
            Match
          </button>
          <button
            className={`tab ${view === "browse" ? "on" : ""}`}
            onClick={() => setView("browse")}
          >
            Browse
          </button>
        </div>

        {view === "match" && (
          <>
            <div className="searchcard">
              <div className="search-row">
                <textarea
                  className="vibe"
                  placeholder="e.g. a rain-soaked neo-noir where the detective is the real mystery…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                />
                <button
                  className="go"
                  onClick={() => runSearch()}
                  disabled={status === "loading" || !query.trim()}
                >
                  {status === "loading" ? "…" : "Match"}
                </button>
              </div>
            </div>

            <div className="chips">
              {examples.map((ex) => (
                <button key={ex} className="chip" onClick={() => { setQuery(ex); runSearch(ex); }}>
                  {ex.length > 48 ? ex.slice(0, 46) + "…" : ex}
                </button>
              ))}
            </div>

            <div className="controls">
              <span>Where to watch in</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            </div>

            {waking && (
              <div className="banner">
                ☕ The server runs on a free tier and was asleep. Waking it up — this first
                search may take ~30 seconds. Future searches are instant.
              </div>
            )}
          </>
        )}
      </header>

      {view === "match" ? (
        <main className="results">
          {status === "loading" &&
            Array.from({ length: 5 }).map((_, i) => (
              <div className="skeleton" key={i}>
                <div className="sk sk-poster" />
                <div style={{ flex: 1 }}>
                  <div className="sk sk-line w70" />
                  <div className="sk sk-line w40" />
                  <div className="sk sk-line w90" />
                  <div className="sk sk-line w90" />
                  <div className="sk sk-line w40" />
                </div>
              </div>
            ))}

          {status === "done" && results.map((m, i) => <MovieCard key={`${m.tmdb_id}-${i}`} movie={m} />)}

          {status === "error" && (
            <div className="state">
              <div className="big">Reel jammed.</div>
              <p>{errorMsg}</p>
              <div className="retry">
                <button className="btn primary" onClick={() => runSearch(lastQuery.current)}>
                  Try again
                </button>
              </div>
            </div>
          )}

          {status === "empty" && (
            <div className="state">
              <div className="big">No match found.</div>
              <p>{errorMsg}</p>
            </div>
          )}

          {status === "idle" && (
            <div className="state">
              <div className="big">What do you feel like watching?</div>
              <p>Describe the vibe, the atmosphere, the feeling — not the title. Tap an example above to see it work.</p>
            </div>
          )}
        </main>
      ) : (
        <main className="results">
          <Browse />
        </main>
      )}

      <footer className="footer">
        <p>
          Semantic search over 4,799 films · Live trending & discovery via TMDB · Data from TMDB & OMDb.<br />
          This product uses the TMDB and OMDb APIs but is not endorsed or certified by either.
        </p>
      </footer>

      <ChaiButton />
    </div>
  );
}
