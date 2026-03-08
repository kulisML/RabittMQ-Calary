import asyncio
import sys
import os

from app.services.lab_service import init_redis, close_redis

async def test():
    await init_redis()
    from app.services.lab_service import redis_client
    print("Redis connected?", redis_client is not None)
    
    keys = []
    async for key in redis_client.scan_iter("container:*"):
        keys.append(key)
    print("Found keys:", keys)
    
    for key in keys:
        data = await redis_client.hgetall(key)
        print(f"Data for {key}:", data)
        status = data.get("status")
        print(f"Status for {key}:", repr(status))
    
    await close_redis()

if __name__ == "__main__":
    asyncio.run(test())
