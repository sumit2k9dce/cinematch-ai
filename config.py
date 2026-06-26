"""config.py — All settings in one place. No magic numbers scattered in code."""
import os

# --- Model ---
EMBED_MODEL = "all-MiniLM-L6-v2"

# --- Data files (produced by build_index.py) ---
MOVIES_CSV = "cleaned_movies.csv"
EMBEDDINGS_NPY = "movie_embeddings.npy"

# --- Search ---
DEFAULT_RESULTS = 5
MAX_RESULTS = 10
MIN_SCORE = 0.20  # below this, we don't pretend it's a match

# --- APIs (set as env vars / Streamlit secrets) ---
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "")
OMDB_API_KEY = os.environ.get("OMDB_API_KEY", "")

TMDB_BASE = "https://api.themoviedb.org/3"
TMDB_IMG = "https://image.tmdb.org/t/p/w500"
TMDB_IMG_SMALL = "https://image.tmdb.org/t/p/w200"
OMDB_BASE = "https://www.omdbapi.com/"

# --- Where to watch ---
DEFAULT_REGION = "IN"  # India default; overridden by user selection

# --- Example vibes shown as clickable chips ---
EXAMPLE_VIBES = [
    "A neon-drenched cyberpunk detective story with existential dread",
    "Cozy small-town romance that feels like a warm hug",
    "Slow-burn psychological thriller where nothing is as it seems",
    "Mind-bending sci-fi that makes you question reality",
    "A lonely midnight drive through an empty city",
    "Feel-good underdog sports story that makes you cheer",
]

# --- Cache TTL for live API enrichment (seconds) ---
ENRICH_CACHE_TTL = 60 * 60 * 24  # 24 hours
POPULARITY_WEIGHT = 0.30

LEXICAL_WEIGHT = 1.1
POPULARITY_WEIGHT = 0.0
