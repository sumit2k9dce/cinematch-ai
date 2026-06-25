import streamlit as st
import pandas as pd
import numpy as np
from sentence_transformers import SentenceTransformer

st.set_page_config(page_title="CineMatch.ai", page_icon="🍿", layout="centered")

@st.cache_resource
def load_system():
    model = SentenceTransformer('all-MiniLM-L6-v2')
    df = pd.read_csv("cleaned_movies.csv")
    embeddings = np.load("movie_embeddings.npy")
    return model, df, embeddings

model, df, movie_embeddings = load_system()

st.title("🍿 CineMatch.ai")
st.subheader("Search 5,000+ movies by describing your exact vibe.")

user_vibe = st.text_area(
    "What kind of cinematic mood are you craving?", 
    placeholder="e.g., A gritty, neon-lit cyberpunk detective story...",
    height=100
)

if st.button("Analyze Vibe 🔍", type="primary"):
    if user_vibe.strip():
        with st.spinner("Searching 5,000+ movies..."):
            user_vector = model.encode([user_vibe])
            
            norms_movies = np.linalg.norm(movie_embeddings, axis=1)
            norm_user = np.linalg.norm(user_vector)
            scores = np.dot(movie_embeddings, user_vector.T).flatten() / (norms_movies * norm_user)
            
            df['match_score'] = scores
            results = df.sort_values(by='match_score', ascending=False).head(5)
            
            st.write("---")
            for idx, row in results.iterrows():
                match_percentage = int(row['match_score'] * 100)
                st.markdown(f"### {row['title']} — **{match_percentage}% Match**")
                st.markdown(f"🎭 **Genre:** {row['genres']} | 📺 **Available on:** `{row['streaming_on']}`")
                st.write(f"_{row['overview']}_")
                st.markdown("---")
