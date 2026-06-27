export default function ResultCard({ item }) {
  return (
    <article className="match-card">
      <div className="mc-poster">
        {item.poster ? (
          <img src={item.poster} alt={item.title} loading="lazy" />
        ) : (
          <div className="mc-noposter">{item.title}</div>
        )}
        <span className={`mc-badge ${item.media_type}`}>
          {item.media_type === "tv" ? "TV" : "FILM"}
        </span>
      </div>

      <div className="mc-body">
        <h3 className="mc-title">
          {item.title} <span className="mc-year">{item.year}</span>
        </h3>

        <div className="mc-meta">
          {item.vote_average ? <span className="mc-rating">★ {item.vote_average}</span> : null}
          {item.original_language ? (
            <span className="mc-lang">{String(item.original_language).toUpperCase()}</span>
          ) : null}
        </div>

        {item.reason ? <p className="mc-reason">{item.reason}</p> : null}
        {item.overview ? <p className="mc-overview">{item.overview}</p> : null}

        <div className="mc-links">
          <a href={item.tmdb_url} target="_blank" rel="noreferrer">View on TMDB ↗</a>
        </div>
      </div>
    </article>
  );
}
