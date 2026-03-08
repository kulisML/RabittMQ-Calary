import asyncio
from fastapi.testclient import TestClient
from app.main import app
from app.services import auth_service
from app.models.user import User, UserRole

def test():
    user = User(id=1, email="teacher@edulab.local", role=UserRole.teacher)
    token = auth_service.create_user_token(user)
    
    with TestClient(app) as client:
        headers = {"Authorization": f"Bearer {token}"}
        print("Sending request to /dashboard/containers")
        response = client.get("/dashboard/containers", headers=headers)
        print("Status:", response.status_code)
        import json
        print("Response:", json.dumps(response.json(), indent=2))

if __name__ == "__main__":
    test()
