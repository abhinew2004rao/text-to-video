import os
import random
import subprocess
from pathlib import Path

from dotenv import load_dotenv
from googleapiclient.discovery import build
import yt_dlp


# ============================================================
# CONFIG
# ============================================================

load_dotenv()

YOUTUBE_API_KEY = "AIzaSyBDbdYTLj-9uaTF959q0Kk7yVDtRCAj8x8"

DOWNLOAD_DIR = Path("downloads")
DOWNLOAD_DIR.mkdir(exist_ok=True)


# ============================================================
# SEARCH YOUTUBE
# ============================================================

def search_youtube(query):
    """Search YouTube and return the top video URL and video ID."""

    youtube = build(
        "youtube",
        "v3",
        developerKey=YOUTUBE_API_KEY
    )

    response = youtube.search().list(
        part="id,snippet",
        q=query,
        type="video",
        maxResults=1,
        order="relevance"
    ).execute()

    items = response.get("items", [])

    if not items:
        print("No video found.")
        return None, None

    video_id = items[0]["id"]["videoId"]
    title = items[0]["snippet"]["title"]

    url = f"https://www.youtube.com/watch?v={video_id}"

    print("\n==============================")
    print("YouTube Result")
    print("==============================")
    print(f"Title    : {title}")
    print(f"Video ID : {video_id}")
    print(f"URL      : {url}")

    return url, video_id


# ============================================================
# DOWNLOAD VIDEO
# ============================================================

def download_360p(url, video_id):
    """
    Download the best available quality up to 360p.
    Video is saved using the YouTube video ID so old files
    don't get confused with new downloads.
    """

    output_template = str(
        DOWNLOAD_DIR / f"{video_id}.%(ext)s"
    )

    ydl_opts = {
        # Best video <= 360p + best audio
        # Otherwise best combined <= 360p
        "format": (
            "bestvideo[height<=360]+bestaudio/"
            "best[height<=360]"
        ),

        "outtmpl": output_template,

        # Merge video/audio into MP4
        "merge_output_format": "mp4",

        # Never download playlist
        "noplaylist": True,

        "quiet": False,
    }

    print("\n==============================")
    print("Downloading")
    print("==============================")

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([url])

    # Expected merged file
    output_file = DOWNLOAD_DIR / f"{video_id}.mp4"

    if output_file.exists():
        return output_file

    # Fallback: find downloaded file
    files = list(
        DOWNLOAD_DIR.glob(f"{video_id}.*")
    )

    # Ignore temporary files
    files = [
        file for file in files
        if not file.name.endswith(".part")
    ]

    if not files:
        raise FileNotFoundError(
            f"Downloaded video for {video_id} was not found."
        )

    return files[0]


# ============================================================
# GET VIDEO DURATION
# ============================================================

def get_video_duration(video_path):
    """Get video duration in seconds using ffprobe."""

    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(video_path)
        ],
        capture_output=True,
        text=True,
        check=True
    )

    return float(result.stdout.strip())


# ============================================================
# CREATE RANDOM 15 SECOND CLIP
# ============================================================

def create_random_clip(
    input_path,
    video_id,
    clip_length=15
):
    """Create a random 15-second clip."""

    duration = get_video_duration(input_path)

    if duration < clip_length:
        raise ValueError(
            f"Video is only {duration:.2f}s long."
        )

    # Maximum possible starting position
    max_start = duration - clip_length

    # Pick random starting point
    start_time = random.uniform(
        0,
        max_start
    )

    output_path = (
        DOWNLOAD_DIR /
        f"{video_id}_clip.mp4"
    )

    # Remove old clip if it exists
    if output_path.exists():
        output_path.unlink()

    print("\n==============================")
    print("Creating Random Clip")
    print("==============================")
    print(f"Video duration : {duration:.2f}s")
    print(f"Random start   : {start_time:.2f}s")
    print(f"Clip duration  : {clip_length}s")

    subprocess.run(
        [
            "ffmpeg",
            "-y",

            # Start position
            "-ss", str(start_time),

            # Input file
            "-i", str(input_path),

            # Clip length
            "-t", str(clip_length),

            # Re-encode for accurate cutting
            "-c:v", "libx264",
            "-c:a", "aac",

            # Output
            str(output_path)
        ],
        check=True
    )

    return output_path


# ============================================================
# OPEN VIDEO
# ============================================================

def open_video(video_path):
    """Open video using Windows default video player."""

    absolute_path = os.path.abspath(video_path)

    os.startfile(absolute_path)


# ============================================================
# MAIN PROCESS
# ============================================================

def process_video(query):

    print("\n======================================")
    print(f"Searching: {query}")
    print("======================================")

    # --------------------------------------------------------
    # 1. Search top 1 YouTube result
    # --------------------------------------------------------

    url, video_id = search_youtube(query)

    if not url:
        return

    # --------------------------------------------------------
    # 2. Download video
    # --------------------------------------------------------

    video_path = download_360p(
        url,
        video_id
    )

    print(f"\nDownloaded file:")
    print(video_path)

    # --------------------------------------------------------
    # 3. Check duration
    # --------------------------------------------------------

    duration = get_video_duration(video_path)

    print(f"\nVideo duration: {duration:.2f} seconds")

    # --------------------------------------------------------
    # 4. If shorter than 15 sec → play whole video
    # --------------------------------------------------------

    if duration < 15:

        print(
            "Video is shorter than 15 seconds."
        )

        print(
            "Playing the original video..."
        )

        open_video(video_path)

        return

    # --------------------------------------------------------
    # 5. Otherwise → create random 15 sec clip
    # --------------------------------------------------------

    print(
        "Video is 15+ seconds. "
        "Creating random 15-second clip..."
    )

    clip_path = create_random_clip(
        video_path,
        video_id,
        clip_length=15
    )

    # --------------------------------------------------------
    # 6. Open clip
    # --------------------------------------------------------

    print("\nOpening clip...")

    open_video(clip_path)


# ============================================================
# RUN
# ============================================================

if __name__ == "__main__":
    text="childrens are playing in the park"
    process_video(
        f"cartoon video of {text}"
    )