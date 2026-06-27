import { useState, useEffect } from "react";
import { REGIONS } from "./config";
import ResultCard from "./ResultCard";
import ChaiButton from "./ChaiButton";
import Browse from "./Browse";

const SEARCH_URL = "/api/search"; // same-origin Vercel serverless function

const FALLBACK_EXAMPLES = [
  "A neon-drenched cyberpunk detective story with existential dread",
  "Cozy small-town romance that feels like a warm hug",
  "Slow-burn psychological thriller where nothing is as it seems",
  "Mind-bending sci-fi that makes you question reality",
  "A tense slow-burn prestige TV crime drama",
];

export default function App() {
  const [view, setView] = useState("match"); // match | browse

  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("IN");

  const [intent, setIntent] = useState(null);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | loading | done | error | empty
  const [errorMsg, setErrorMsg] = useState("");

  // Rotating "thinking" copy so the 2-4s AI step feels intentional, not stuck.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (status !== "loading") return;
    const id = setInterval(() => setTick((t) => t + 1), 1400);
    return () => clearInterval(id);
  }, [status]);
  const THINKING = ["Reading the vibe…", "Searching the catalog…", "Curating the best matches…"];

  async function runSearch(q) {
    const vibe = (q ?? query).trim();
    if (!vibe) return;
    setStatus("loading");
    setErrorMsg("");
    setIntent(null);
    setTick(0);
    try {
      const res = await fetch(SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vibe, region }),
        signal: AbortSignal.timeout(60000),
      });
      const data = await res.json();
      if (!data.ok) {
        setStatus("error");
        setErrorMsg(data.error || "Something went wrong.");
        return;
      }
      setIntent(data.intent || null);
      if (!data.results?.length) {
        setStatus("empty");
        setErrorMsg(data.message || "No strong matches — try a different vibe.");
        return;
      }
      setResults(data.results);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(
        e.name === "TimeoutError"
          ? "That took too long. Try again in a moment."
          : "Couldn't reach the server. Check your connection and try again."
      );
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
          Describe a mood, not a genre. We'll find the films — and shows — that feel like it.
        </p>

        <div className="tabs">
          <button className={`tab ${view === "match" ? "on" : ""}`} onClick={() => setView("match")}>
            Match
          </button>
          <button className={`tab ${view === "browse" ? "on" : ""}`} onClick={() => setView("browse")}>
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
              {FALLBACK_EXAMPLES.map((ex) => (
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
          </>
        )}
      </header>

      {view === "match" ? (
        <main className="results">
          {status === "loading" && (
            <div className="state">
              <div className="big">{THINKING[tick % THINKING.length]}</div>
              <p>Gemini is reading your vibe and pulling live matches from the catalog.</p>
            </div>
          )}

          {status === "done" && (
            <>
              {intent && (
                <div className="intent-strip">
                  <div className="intent-label">We read this as</div>
                  {intent.mood && <div className="intent-mood">{intent.mood}</div>}
                  <div className="intent-chips">
                    {(intent.keywords || []).slice(0, 8).map((k) => (
                      <span className="ic" key={k}>{k}</span>
                    ))}
                  </div>
                </div>
              )}
              <div className="match-list">
                {results.map((m) => (
                  <ResultCard key={`${m.media_type}-${m.id}`} item={m} />
                ))}
              </div>
            </>
          )}

          {status === "error" && (
            <div className="state">
              <div className="big">Reel jammed.</div>
              <p>{errorMsg}</p>
              <div className="retry">
                <button className="btn primary" onClick={() => runSearch(query)}>Try again</button>
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
          Vibe search powered by Gemini · Live catalog &amp; trending via TMDB.<br />
          This product uses the TMDB API but is not endorsed or certified by TMDB.
        </p>
      </footer>

      <ChaiButton />
    </div>
  );
}
