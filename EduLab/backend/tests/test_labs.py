"""Tests for labs API (ТЗ §8.2)."""
import pytest
from unittest.mock import AsyncMock

import app.services.rabbitmq_service as rmq


@pytest.mark.asyncio
async def test_list_labs(client, seed_data):
    """GET /labs — returns list of labs with statuses."""
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.get("/labs", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 1
    assert data[0]["title"] == "Test Lab"
    assert data[0]["language"] == "python"
    assert data[0]["status"] == "not_started"


@pytest.mark.asyncio
async def test_get_lab_detail(client, seed_data):
    """GET /labs/{id} — returns lab details."""
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.get(f"/labs/{seed_data['lab'].id}", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Test Lab"
    assert data["template_code"] == "print('hello')"
    assert "tests_json" in data


@pytest.mark.asyncio
async def test_get_lab_not_found(client, seed_data):
    """GET /labs/999 — returns 404."""
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.get("/labs/999", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_open_lab_publishes_to_rabbitmq(client, seed_data):
    """POST /labs/{id}/open — publishes container.start to RabbitMQ (ТЗ §3.2)."""
    rmq.publish = AsyncMock()

    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.post(f"/labs/{seed_data['lab'].id}/open", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    data = response.json()
    assert "ws_ticket" in data
    assert data["status"] in ("starting", "running")

    # Verify RabbitMQ publish was called
    rmq.publish.assert_called_once()
    call_args = rmq.publish.call_args
    assert call_args[1]["exchange_name"] == "edulab.direct"
    assert call_args[1]["routing_key"] == "container.start"
    msg = call_args[1]["message"]
    assert msg["student_id"] == seed_data["student"].id
    assert msg["lab_id"] == seed_data["lab"].id
    assert msg["language"] == "python"


@pytest.mark.asyncio
async def test_create_lab_teacher(client, seed_data):
    """POST /labs — teacher can create a lab."""
    login_resp = await client.post("/auth/login", json={
        "email": "teacher@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.post("/labs", json={
        "title": "New Lab",
        "description": "A new lab",
        "language": "python",
    }, headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "New Lab"


@pytest.mark.asyncio
async def test_create_lab_student_forbidden(client, seed_data):
    """POST /labs — student cannot create a lab."""
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.post("/labs", json={
        "title": "Hack Lab",
        "description": "Should fail",
    }, headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 403
