import base64
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def mock_image_bytes():
    return b"\x89PNG\r\n\x1a\n" + b"\x00" * 100


@pytest.mark.asyncio
async def test_generate_image_returns_base64(mock_image_bytes):
    mock_image = AsyncMock()
    mock_image.save = AsyncMock(side_effect=lambda path, filename: open(f"{path}/{filename}", "wb").write(mock_image_bytes))

    mock_response = MagicMock()
    mock_response.images = [mock_image]

    mock_client = AsyncMock()
    mock_client.generate_content = AsyncMock(return_value=mock_response)

    with patch("main.get_client", return_value=mock_client):
        from main import app
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

    with patch("main.get_client", return_value=mock_client):
        from main import app
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
            r = await ac.post("/generate-image", json={
                "prompt": "A scene",
                "psid": "test-psid",
                "psidts": "test-psidts",
            })
    assert r.status_code == 500
    assert "No images" in r.json()["detail"]
