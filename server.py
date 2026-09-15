import os
import sys
import json
import asyncio
from pathlib import Path
from typing import Optional

# Ensure UTF-8 output encoding for console on Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Import existing backend modules without modifying app.py
import app

BASE_DIR = Path(__file__).parent.resolve()
FRONTEND_DIR = BASE_DIR / "frontend"
DOWNLOADS_DIR = app.DOWNLOAD_DIR.resolve()
DOWNLOADS_DIR.mkdir(exist_ok=True)

server_app = FastAPI(
    title="Text to Video Studio API",
    version="1.0.0",
    description="Studio backend wrapping text-to-video pipeline"
)

# Mount frontend directory for static assets
if FRONTEND_DIR.exists():
    server_app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


class GenerateRequest(BaseModel):
    prompt: str
    style_prefix: Optional[str] = "cartoon video of"
    clip_length: Optional[int] = 15
    open_local: Optional[bool] = False


class OpenLocalRequest(BaseModel):
    filename: str


def get_video_metadata(file_path: Path):
    """Retrieve metadata for a downloaded video."""
    try:
        stat = file_path.stat()
        duration = None
        try:
            duration = round(app.get_video_duration(file_path), 2)
        except Exception:
            pass

        is_clip = "_clip" in file_path.stem
        video_id = file_path.stem.replace("_clip", "")

        return {
            "filename": file_path.name,
            "stem": file_path.stem,
            "video_id": video_id,
            "is_clip": is_clip,
            "duration": duration,
            "size_bytes": stat.st_size,
            "size_mb": round(stat.st_size / (1024 * 1024), 2),
            "created_at": stat.st_mtime,
            "stream_url": f"/api/stream/{file_path.name}",
            "download_url": f"/api/stream/{file_path.name}?download=1"
        }
    except Exception as e:
        return {
            "filename": file_path.name,
            "error": str(e)
        }


def format_query(prompt: str, style_prefix: Optional[str] = None) -> str:
    """Format user prompt with chosen style."""
    clean_prompt = prompt.strip()
    if not style_prefix:
        return clean_prompt

    style = style_prefix.strip()
    if "{prompt}" in style:
        return style.replace("{prompt}", clean_prompt)
    return f"{style} {clean_prompt}"


@server_app.get("/", response_class=HTMLResponse)
async def serve_index():
    """Serve the studio index.html."""
    index_path = FRONTEND_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse("<h1>Frontend assets not found</h1>", status_code=404)
    return HTMLResponse(content=index_path.read_text(encoding="utf-8"))


@server_app.get("/api/status")
async def get_status():
    """Health and status check."""
    ffmpeg_ok = False
    try:
        import subprocess
        res = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True)
        ffmpeg_ok = res.returncode == 0
    except Exception:
        pass

    video_files = list(DOWNLOADS_DIR.glob("*.mp4")) + list(DOWNLOADS_DIR.glob("*.webm"))
    total_size = sum(f.stat().st_size for f in video_files if f.is_file())

    return {
        "status": "online",
        "api_key_configured": bool(app.YOUTUBE_API_KEY),
        "ffmpeg_ready": ffmpeg_ok,
        "downloads_dir": str(DOWNLOADS_DIR),
        "total_files": len(video_files),
        "total_storage_mb": round(total_size / (1024 * 1024), 2)
    }


@server_app.get("/api/history")
async def get_history():
    """List previously generated videos and clips."""
    files = []
    for ext in ["*.mp4", "*.mkv", "*.webm"]:
        for f in DOWNLOADS_DIR.glob(ext):
            if f.is_file() and not f.name.endswith(".part"):
                files.append(f)

    files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    items = [get_video_metadata(f) for f in files]
    return {"items": items, "count": len(items)}


@server_app.post("/api/generate")
async def generate_video(payload: GenerateRequest):
    """Run the generation pipeline."""
    if not payload.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")

    query = format_query(payload.prompt, payload.style_prefix)

    # 1. Search YouTube
    try:
        url, video_id = app.search_youtube(query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"YouTube search error: {str(e)}")

    if not url or not video_id:
        raise HTTPException(status_code=404, detail="No video found matching your query on YouTube")

    # 2. Download 360p
    try:
        video_path = app.download_360p(url, video_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")

    # 3. Check duration
    try:
        duration = app.get_video_duration(video_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Duration calculation error: {str(e)}")

    clip_length = payload.clip_length or 15
    is_clipped = False
    clip_path = video_path

    # 4. Create clip if duration >= clip_length
    if duration >= clip_length:
        try:
            clip_path = app.create_random_clip(video_path, video_id, clip_length=clip_length)
            is_clipped = True
        except Exception as e:
            clip_path = video_path
            is_clipped = False

    # 5. Optionally open in local Windows player
    if payload.open_local:
        try:
            app.open_video(clip_path)
        except Exception:
            pass

    return {
        "success": True,
        "query": query,
        "prompt": payload.prompt,
        "video_id": video_id,
        "youtube_url": url,
        "duration": round(duration, 2),
        "clip_length": clip_length,
        "is_clipped": is_clipped,
        "clip_filename": clip_path.name,
        "video_filename": video_path.name,
        "clip_stream_url": f"/api/stream/{clip_path.name}",
        "video_stream_url": f"/api/stream/{video_path.name}",
        "clip_metadata": get_video_metadata(clip_path),
        "video_metadata": get_video_metadata(video_path)
    }


@server_app.get("/api/generate-stream")
async def generate_video_sse(
    prompt: str,
    style_prefix: str = "cartoon video of",
    clip_length: int = 15,
    open_local: bool = False
):
    """Server-Sent Events endpoint for real-time generation progress."""

    async def event_generator():
        try:
            clean_prompt = prompt.strip()
            if not clean_prompt:
                yield f"data: {json.dumps({'status': 'error', 'message': 'Empty prompt'})}\n\n"
                return

            query = format_query(clean_prompt, style_prefix)

            # Step 1: Search
            yield f"data: {json.dumps({'stage': 1, 'message': f'Searching YouTube: {query}...' })}\n\n"
            await asyncio.sleep(0.1)

            loop = asyncio.get_event_loop()
            url, video_id = await loop.run_in_executor(None, app.search_youtube, query)

            if not url or not video_id:
                yield f"data: {json.dumps({'status': 'error', 'message': 'No video found for query'})}\n\n"
                return

            yield f"data: {json.dumps({'stage': 2, 'message': f'Found video ID: {video_id}. Downloading 360p stream...', 'video_id': video_id, 'url': url})}\n\n"

            # Step 2: Download
            video_path = await loop.run_in_executor(None, app.download_360p, url, video_id)
            yield f"data: {json.dumps({'stage': 3, 'message': 'Download complete. Analyzing video duration...'})}\n\n"

            # Step 3: Duration
            duration = await loop.run_in_executor(None, app.get_video_duration, video_path)
            yield f"data: {json.dumps({'stage': 4, 'message': f'Duration is {duration:.2f}s. Generating clip...', 'duration': duration})}\n\n"

            # Step 4: Clip
            is_clipped = False
            clip_path = video_path
            if duration >= clip_length:
                yield f"data: {json.dumps({'stage': 4, 'message': f'Creating {clip_length}s random clip with FFmpeg...'})}\n\n"
                clip_path = await loop.run_in_executor(None, app.create_random_clip, video_path, video_id, clip_length)
                is_clipped = True
            else:
                yield f"data: {json.dumps({'stage': 4, 'message': f'Video is under {clip_length}s. Using full video.'})}\n\n"

            if open_local:
                await loop.run_in_executor(None, app.open_video, clip_path)

            result = {
                "stage": 5,
                "status": "complete",
                "message": "Clip generated successfully!",
                "success": True,
                "query": query,
                "video_id": video_id,
                "youtube_url": url,
                "duration": round(duration, 2),
                "is_clipped": is_clipped,
                "clip_filename": clip_path.name,
                "video_filename": video_path.name,
                "clip_stream_url": f"/api/stream/{clip_path.name}",
                "video_stream_url": f"/api/stream/{video_path.name}",
                "clip_metadata": get_video_metadata(clip_path),
                "video_metadata": get_video_metadata(video_path)
            }
            yield f"data: {json.dumps(result)}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'status': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@server_app.api_route("/api/stream/{filename}", methods=["GET", "HEAD"])
async def stream_video(filename: str, request: Request, download: Optional[int] = 0):
    """Stream video with HTTP Range header support for seeking and playback."""
    file_path = (DOWNLOADS_DIR / filename).resolve()

    if not str(file_path).startswith(str(DOWNLOADS_DIR)) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4" if file_path.suffix.lower() == ".mp4" else "video/webm"
    }

    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    if not range_header:
        headers["Content-Length"] = str(file_size)
        def iterfile():
            with open(file_path, "rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk
        return StreamingResponse(iterfile(), headers=headers, status_code=200)

    try:
        byte_range = range_header.strip().replace("bytes=", "").split("-")
        start = int(byte_range[0]) if byte_range[0] else 0
        end = int(byte_range[1]) if len(byte_range) > 1 and byte_range[1] else file_size - 1
        end = min(end, file_size - 1)
        length = end - start + 1
    except Exception:
        start = 0
        end = file_size - 1
        length = file_size

    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(length)

    def iter_range():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk_size = min(remaining, 1024 * 512)
                data = f.read(chunk_size)
                if not data:
                    break
                remaining -= len(data)
                yield data

    return StreamingResponse(iter_range(), headers=headers, status_code=206)


@server_app.post("/api/open-local")
async def open_in_local_player(payload: OpenLocalRequest):
    """Open a video in the Windows media player."""
    file_path = (DOWNLOADS_DIR / payload.filename).resolve()
    if not str(file_path).startswith(str(DOWNLOADS_DIR)) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")

    try:
        app.open_video(file_path)
        return {"success": True, "message": f"Opened {payload.filename} in Windows player"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@server_app.delete("/api/video/{filename}")
async def delete_video(filename: str):
    """Delete a video file from downloads folder."""
    file_path = (DOWNLOADS_DIR / filename).resolve()
    if not str(file_path).startswith(str(DOWNLOADS_DIR)) or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Video not found")

    try:
        file_path.unlink()
        return {"success": True, "message": f"Deleted {filename}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    port = 8000
    print("\n" + "=" * 60)
    print("🎬 TEXT-TO-VIDEO STUDIO SERVER")
    print(f"🚀 Studio UI: http://localhost:{port}")
    print(f"📁 Downloads: {DOWNLOADS_DIR}")
    print("=" * 60 + "\n")
    uvicorn.run(server_app, host="127.0.0.1", port=port, log_level="info")
