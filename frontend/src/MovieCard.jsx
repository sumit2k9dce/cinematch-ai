import { useState } from "react";

export default function MovieCard({ movie }) {
  const [showTrailer, setShowTrailer] = useState(false);

  const {
    title, year, runtime, genres, overview, match_percent,
    poster, trailer_key, trailer_url,
    imdb_rating, rt_rating, metacritic, tmdb_rating,
    imdb_url, tmdb_url, watch_providers = [], watch_link,
  } = movie;

  const genreList = (genres || "").split(",").map((g) => g.trim()).filter(Boolean).slice(0, 4);

  return (
    <div className="card">
      {poster ? (
        <img className="poster" src={poster} alt={title} loading="lazy" />
      ) : (
        <div className="poster placeholder">{title}</div>
      )}

      <div className="card-body">
        <div className="card-head">
          <div className="movie-title">
            {title} {year && <span className="movie-year">({year})</span>}
          </div>
          <div className="match">
            {match_percent}%<small>MATCH</small>
          </div>
        </div>

        <div className="meta">
          {runtime ? <span className="tag">{runtime} min</span> : null}
          {genreList.map((g) => (
            <span className="tag" key={g}>{g}</span>
          ))}
        </div>

        <div className="ratings">
          {imdb_rating && (
            <a className="rating" href={imdb_url} target="_blank" rel="noreferrer">
              <span className="src">IMDb</span>
              <span className="val imdb">{imdb_rating}</span>
            </a>
          )}
          {rt_rating && (
            <span className="rating">
              <span className="src">Rotten T.</span>
              <span className="val rt">{rt_rating}</span>
            </span>
          )}
          {metacritic && (
            <span className="rating">
              <span className="src">Metacritic</span>
              <span className="val meta">{metacritic}</span>
            </span>
          )}
          {!imdb_rating && tmdb_rating ? (
            <span className="rating">
              <span className="src">TMDB</span>
              <span className="val">{tmdb_rating}</span>
            </span>
          ) : null}
        </div>

        {overview && <p className="overview">{overview}</p>}

        {watch_providers.length > 0 && (
          <div className="watch">
            <div className="watch-label">Where to watch</div>
            <div className="providers">
              {watch_providers.slice(0, 6).map((p) => (
                <a
                  key={p.name}
                  className="provider"
                  href={watch_link || "#"}
                  target="_blank"
                  rel="noreferrer"
                  title={`${p.name} (${p.type})`}
                >
                  {p.logo && <img src={p.logo} alt={p.name} />}
                  {p.name}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="actions">
          {trailer_key && (
            <button className="btn primary" onClick={() => setShowTrailer((s) => !s)}>
              ▶ {showTrailer ? "Hide" : "Trailer"}
            </button>
          )}
          {tmdb_url && (
            <a className="btn" href={tmdb_url} target="_blank" rel="noreferrer">TMDB</a>
          )}
          {imdb_url && (
            <a className="btn" href={imdb_url} target="_blank" rel="noreferrer">IMDb</a>
          )}
          {!watch_providers.length && watch_link && (
            <a className="btn" href={watch_link} target="_blank" rel="noreferrer">Where to watch</a>
          )}
        </div>

        {showTrailer && trailer_key && (
          <div className="trailer-wrap">
            <iframe
              src={`https://www.youtube.com/embed/${trailer_key}`}
              title={`${title} trailer`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
      </div>
    </div>
  );
}
