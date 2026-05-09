import asyncio
import base64
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from gemini_webapi import GeminiClient

logger = logging.getLogger(__name__)

_cached_client: Optional[GeminiClient] = None
_cached_chat = None
_cached_psid: Optional[str] = None
_cached_psidts: Optional[str] = None


async def get_client(psid: str, psidts: str) -> GeminiClient:
    global _cached_client, _cached_chat, _cached_psid, _cached_psidts
    if _cached_client is None or _cached_psid != psid or _cached_psidts != psidts:
        client = GeminiClient(psid, psidts, proxy=None)
        await client.init(timeout=120, auto_close=False, auto_refresh=True)
        _cached_client = client
        _cached_chat = None  # reset chat when credentials change
        _cached_psid = psid
        _cached_psidts = psidts
    return _cached_client


async def get_chat(psid: str, psidts: str):
    global _cached_chat
    client = await get_client(psid, psidts)
    if _cached_chat is None:
        _cached_chat = client.start_chat()
    return _cached_chat


class ImageRequest(BaseModel):
    prompt: str
    psid: str
    psidts: str


class VideoRequest(BaseModel):
    prompt: str
    image_path: str
    psid: str
    psidts: str


app = FastAPI()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/reset-chat")
async def reset_chat():
    global _cached_chat
    _cached_chat = None
    return {"status": "chat session reset"}


@app.post("/generate-image")
async def generate_image(req: ImageRequest):
    global _cached_chat
    last_error = "Image generation failed"
    for attempt in range(3):
        try:
            chat = await get_chat(req.psid, req.psidts)
            response = await chat.send_message(f"Generate an image: {req.prompt}")
            images = list(response.images)
            if not images:
                raise HTTPException(status_code=500, detail="No images in Gemini response")
            with tempfile.TemporaryDirectory() as tmpdir:
                await images[0].save(path=tmpdir, filename="output.png")
                img_bytes = (Path(tmpdir) / "output.png").read_bytes()
            return {"image_base64": base64.b64encode(img_bytes).decode()}
        except HTTPException:
            raise
        except Exception as e:
            last_error = str(e)
            _cached_chat = None  # always reset chat after any error
            if attempt < 2:
                wait = (attempt + 1) * 5  # 5s then 10s
                logger.warning("generate_image attempt %d failed (%s) — retrying in %ds", attempt + 1, last_error[:80], wait)
                await asyncio.sleep(wait)
            else:
                logger.exception("generate_image failed after 3 attempts")
    raise HTTPException(status_code=500, detail=last_error)


@app.post("/generate-video")
async def generate_video(req: VideoRequest):
    try:
        image_path = Path(req.image_path)
        if not image_path.exists():
            raise HTTPException(status_code=400, detail=f"Image not found: {req.image_path}")
        uploads_root = Path(os.environ.get("UPLOADS_DIR", "uploads")).resolve()
        resolved = image_path.resolve()
        if not str(resolved).startswith(str(uploads_root)):
            raise HTTPException(status_code=400, detail="Invalid image path")
        client = await get_client(req.psid, req.psidts)
        response = await client.generate_content(
            f"Generate a short cinematic video: {req.prompt}",
            files=[str(image_path)],
        )
        videos = list(response.videos)
        if not videos:
            raise HTTPException(status_code=500, detail="No video in Gemini response")
        with tempfile.TemporaryDirectory() as tmpdir:
            await videos[0].save(path=tmpdir, filename="output.mp4")
            vid_bytes = (Path(tmpdir) / "output.mp4").read_bytes()
        return {"video_base64": base64.b64encode(vid_bytes).decode()}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("generate_video failed")
        raise HTTPException(status_code=500, detail="Video generation failed")
