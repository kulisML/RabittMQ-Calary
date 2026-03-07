"""Tests for auth API (ТЗ §8.1)."""
import pytest


@pytest.mark.asyncio
async def test_login_success(client, seed_data):
    """POST /auth/login — correct credentials."""
    response = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client, seed_data):
    """POST /auth/login — wrong password."""
    response = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "wrong",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client, seed_data):
    """POST /auth/login — user doesn't exist."""
    response = await client.post("/auth/login", json={
        "email": "nobody@test.ru",
        "password": "password123",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me(client, seed_data):
    """GET /auth/me — returns current user data."""
    # Login first
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    # Get user info
    response = await client.get("/auth/me", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "student@test.ru"
    assert data["role"] == "student"
    assert data["name"] == "Test Student"


@pytest.mark.asyncio
async def test_get_me_no_token(client):
    """GET /auth/me — no token returns 403."""
    response = await client.get("/auth/me")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_logout(client, seed_data):
    """POST /auth/logout — terminates session."""
    login_resp = await client.post("/auth/login", json={
        "email": "student@test.ru",
        "password": "password123",
    })
    token = login_resp.json()["access_token"]

    response = await client.post("/auth/logout", headers={
        "Authorization": f"Bearer {token}",
    })
    assert response.status_code == 200
