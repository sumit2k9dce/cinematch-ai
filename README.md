<div align="center">

# 🍿 CineMatch.ai
**Semantic "Vibe-Based" Movie Discovery Engine**

[![Live Demo](https://img.shields.io/badge/Demo-Live_Now-FF4B4B?style=for-the-badge&logo=streamlit&logoColor=white)](https://cinematch-ai-portfolio.streamlit.app/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)

*Find movies based on complex moods, lighting, and pacing, rather than rigid genres.*

---

![CineMatch Hero Image](assets/hero-screenshot.png)
*> "A neon-drenched cyberpunk detective story with heavy existential dread."*

</div>

## 📖 The Vision

Traditional streaming discovery relies on rigid, boolean categorical filtering (e.g., `Genre = "Sci-Fi" AND Year > 2010`). This architecture fails to capture highly nuanced human moods, atmospheric cravings, or specific artistic aesthetics ("vibes").

**CineMatch.ai** completely bypasses keyword matching. It allows users to submit completely unedited, hyper-specific natural language queries describing their exact emotional and visual appetite. The engine maps this unstructured text to a mathematically compressed vector space to find the closest semantic matches across a database of 5,000+ films.

## 🛠️ Tech Stack

CineMatch is built entirely on open-source, zero-cost infrastructure.

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend UI** | ![Streamlit](https://img.shields.io/badge/Streamlit-FF4B4B?style=flat-square&logo=Streamlit&logoColor=white) | Rapid prototyping and reactive UI handling. |
| **NLP & Vectors** | ![Hugging Face](https://img.shields.io/badge/Hugging%20Face-F9AB00?style=flat-square&logo=huggingface&logoColor=white) ![PyTorch](https://img.shields.io/badge/PyTorch-EE4C2C?style=flat-square&logo=pytorch&logoColor=white) | `all-MiniLM-L6-v2` via `sentence-transformers` for embedding generation. |
| **Data Engine** | ![NumPy](https://img.shields.io/badge/NumPy-013243?style=flat-square&logo=numpy&logoColor=white) ![Pandas](https://img.shields.io/badge/Pandas-150458?style=flat-square&logo=pandas&logoColor=white) | High-speed Cosine Similarity matrix calculations in RAM. |
| **Hosting** | ![Linux](https://img.shields.io/badge/Linux-FCC624?style=flat-square&logo=linux&logoColor=black) | Streamlit Community Cloud (1GB RAM Container). |

## 🏗️ System Architecture

This project was intentionally engineered to operate at **$0 cloud compute cost**, completely bypassing paid APIs (like OpenAI) and expensive managed vector databases (like Pinecone).

```text
[User Prompt: "Lonely midnight drive"] 
          │
          ▼
[Hugging Face: all-MiniLM-L6-v2] ──► (Generates 384-dimensional Vector)
          │
          ▼
[Pre-computed NumPy Vector Index] ◄── (5,000 TMDB Movie Vectors)
          │
          ▼
[Cosine Similarity Calculation] ──► (Yields Top 5 Matches in < 0.5s)