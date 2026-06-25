import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer
import json

print("1. Loading TMDB Dataset...")
df = pd.read_csv("tmdb_5000_movies.csv")
df = df[['title', 'overview', 'genres']].dropna(subset=['overview'])

def extract_genre(genre_str):
    try:
        genres = json.loads(genre_str)
        return genres[0]['name'] if genres else "Unknown"
    except:
        return "Unknown"

df['genres'] = df['genres'].apply(extract_genre)
df['streaming_on'] = np.random.choice(['Netflix', 'Hulu', 'Max', 'Prime'], len(df))

print(f"2. Initializing local AI model to process {len(df)} movies...")
model = SentenceTransformer('all-MiniLM-L6-v2')

print("3. Generating Vector Embeddings (This will take 1-3 minutes on your Mac)...")
embeddings = model.encode(df['overview'].tolist(), show_progress_bar=True)

print("4. Saving optimized files for the web app...")
df.to_csv("cleaned_movies.csv", index=False)
np.save("movie_embeddings.npy", embeddings)

print("✅ Success! You are ready to run the app.")
