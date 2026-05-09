import base64
import os
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport

from main import app


@pytest.fixture
def mock_image_bytes():
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest.mark.asyncio
async def test_generate_image_returns_base64(mock_image_bytes):
    mock_image = AsyncMock()
    mock_image.save = AsyncMock(
        side_effect=lambda path, filename: Path(os.path.join(path, filename)).write_bytes(mock_image_bytes)
    )

    mock_response = MagicMock()
    mock_response.images = [mock_image]

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", new=AsyncMock(return_value=mock_client)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-image", json={
                "prompt": "A medieval castle at sunset",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 200
    data = r.json()
    assert "image_base64" in data
    decoded = base64.b64decode(data["image_base64"])
    assert decoded == mock_image_bytes


@pytest.mark.asyncio
async def test_generate_image_no_images_returns_500():
    mock_response = MagicMock()
    mock_response.images = []

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", new=AsyncMock(return_value=mock_client)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-image", json={
                "prompt": "A scene",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 500
    assert "No images" in r.json()["detail"]


@pytest.mark.asyncio
async def test_generate_video_returns_base64(tmp_path, mock_image_bytes, monkeypatch):
    # Create a fake image file the sidecar can find
    fake_image = tmp_path / "1.png"
    fake_image.write_bytes(mock_image_bytes)

    fake_video_bytes = b"\x00\x00\x00\x18ftyp" + b"\x00" * 100

    mock_video = AsyncMock()

    async def save_video(path, filename):
        (Path(path) / filename).write_bytes(fake_video_bytes)

    mock_video.save = save_video

    mock_response = MagicMock()
    mock_response.videos = [mock_video]

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    # Set UPLOADS_DIR to tmp_path to pass the security check
    monkeypatch.setenv("UPLOADS_DIR", str(tmp_path))

    with patch("main.get_client", new=AsyncMock(return_value=mock_client)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-video", json={
                "prompt": "Camera slowly pans left",
                "image_path": str(fake_image),
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 200
    data = r.json()
    assert "video_base64" in data
    assert base64.b64decode(data["video_base64"]) == fake_video_bytes


@pytest.mark.asyncio
async def test_generate_video_missing_image_returns_400():
    mock_client = AsyncMock()

    with patch("main.get_client", new=AsyncMock(return_value=mock_client)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-video", json={
                "prompt": "Camera pan",
                "image_path": "/nonexistent/path/1.png",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 400
    assert "not found" in r.json()["detail"].lower()
