# 🎬 Text-to-Video Studio

A lightweight AI-driven Text-to-Video pipeline and interactive Web Studio built with Python, FastAPI, YouTube Data API v3, yt-dlp, and FFmpeg.

Transform text scene descriptions into relevant video clips with automated searching, downloading, duration calculation, and intelligent randomized sub-clip extraction.

---

## ✨ Features

- **Prompt Studio**: Enter any text prompt or choose from style presets (Cartoon, Cinematic 4K, Anime, Nature Doc, Drone).
- **Automated YouTube Retrieval**: Discovers relevant videos matching your description via YouTube Data API v3.
- **Fast 360p Ingestion**: Downloads optimized stream using `yt-dlp`.
- **Intelligent FFmpeg Clipping**: Analyzes duration and cuts clean random clips (5s to 60s).
- **Studio Web Interface**:
  - Dark-mode glassmorphism interface with smooth micro-animations.
  - Built-in HTML5 video stage with byte-range HTTP streaming.
  - Live 5-stage pipeline tracker.
  - Full local media library with instant playback, download, and delete.
  - One-click trigger for Windows default media player.
- **Zero Configuration**: Ready to run with a single click.

---

## 📁 Project Structure

```
text-to-video/
├── app.py                 # Core text-to-video pipeline
├── server.py              # FastAPI server & streaming API
├── run_frontend.bat       # 1-click Windows launcher
├── requirements.txt       # Python dependencies
├── downloads/             # Video output directory
└── frontend/              # Web Studio UI
    ├── index.html         # Studio interface
    ├── style.css          # Obsidian neon glassmorphism styling
    └── app.js             # Client application logic
```

---

## 🚀 Quick Start

### 1. Prerequisites
- Python 3.10+
- FFmpeg installed and accessible in PATH

### 2. Install Dependencies
```bash
pip install -r requirements.txt
pip install fastapi uvicorn
```

### 3. Run the Studio

#### On Windows:
Double-click **`run_frontend.bat`** or run:
```bash
python server.py
```

Open your browser at [**http://localhost:8000**](http://localhost:8000).

---

## 🛠️ CLI Usage

You can also run the pipeline directly from the command line:

```bash
python app.py
```

---

## 📄 License
MIT License
