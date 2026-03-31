"""Observer Service — monitors Docker container events (ТЗ §4, §10 Этап 2).

Subscribes to Docker Events API, detects container lifecycle events,
and publishes them to container.events queue in RabbitMQ.

Events monitored (ТЗ §4.3):
- container.start   → студент открыл лабу       → 🟢 активен
- container.stop    → закрыл браузер             → 🔴 офлайн (удаляется)
- container.exec    → команда в терминале        → ⚡ мигание
- container.oom     → превышен лимит памяти      → ⚠️ предупреждение
- container.die     → контейнер упал             → 🔴 + ошибка (удаляется)
- container.destroy → контейнер удален           → 🔴 (удаляется)
"""
import asyncio
import json
import logging
import os
import time

import aio_pika
import docker
import redis.asyncio as aioredis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [Observer] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://edulab:edulab_secret@rabbitmq:5672//")
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")

# Docker client (sync — events API is blocking)
docker_client = docker.from_env()


def parse_container_name(name: str) -> dict | None:
    """Extract room_id and lab_id from container name 'edulab-room-{rid}-{lid}'."""
    if not name.startswith("edulab-room-"):
        return None
    parts = name.replace("/", "").split("-")
    if len(parts) != 4:
        return None
    try:
        return {"room_id": int(parts[2]), "lab_id": int(parts[3])}
    except (ValueError, IndexError):
        return None



async def publish_event(channel, event_data: dict):
    """Publish event to container.events via RabbitMQ topic exchange."""
    exchange = await channel.get_exchange("edulab.topic")

    # Routing key: container.events.{room_id}
    routing_key = f"container.events.room.{event_data.get('room_id', 'unknown')}"

    await exchange.publish(
        aio_pika.Message(
            body=json.dumps(event_data, default=str).encode("utf-8"),
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
        ),
        routing_key=routing_key,
    )
    logger.info(f"Published event: {event_data['event_type']} for room={event_data.get('room_id')}")


async def update_redis_status(redis_client, room_id: int, lab_id: int, status: str, extra: dict = None):
    """Update container status in Redis for dashboard."""
    key = f"container:room:{room_id}:{lab_id}"
    await redis_client.hset(key, "status", status)
    if extra:
        await redis_client.hset(key, mapping=extra)

async def sync_redis_with_docker(redis_client):
    """Cleanup Redis keys that correspond to non-existent or stopped containers."""
    try:
        keys = []
        async for key in redis_client.scan_iter("container:*"):
            keys.append(key)
        for key in keys:
            data = await redis_client.hgetall(key)
            container_id = data.get("container_id")
            if not container_id or container_id == "pending":
                continue
            
            # Check docker API
            try:
                c = docker_client.containers.get(container_id)
                if c.status not in ("running", "restarting"):
                    await redis_client.delete(key)
                    logger.info(f"Sync: Deleted stopped container key {key}")
            except docker.errors.NotFound:
                await redis_client.delete(key)
                logger.info(f"Sync: Deleted missing container key {key}")
    except Exception as exc:
        logger.error(f"Failed to sync Redis with Docker: {exc}")


def watch_docker_events():
    """Generator: yields Docker events for EduLab containers (blocking)."""
    logger.info("Watching Docker events...")
    event_filters = {
        "type": ["container"],
        "event": ["start", "stop", "die", "oom", "exec_start", "destroy", "kill"],
    }
    for event in docker_client.events(decode=True, filters=event_filters):
        container_name = event.get("Actor", {}).get("Attributes", {}).get("name", "")
        parsed = parse_container_name(container_name)
        if parsed is None:
            continue  # Not an EduLab container

        event_type_map = {
            "start": "container.start",
            "stop": "container.stop",
            "die": "container.die",
            "destroy": "container.destroy",
            "kill": "container.kill",
            "oom": "container.oom",
            "exec_start": "container.exec",
        }

        docker_action = event.get("Action", "").split(":")[0]
        event_type = event_type_map.get(docker_action)
        if event_type is None:
            continue

        yield {
            "room_id": parsed["room_id"],
            "lab_id": parsed["lab_id"],
            "event_type": event_type,
            "container_name": container_name,
            "timestamp": event.get("time", int(time.time())),
            "details": event.get("Actor", {}).get("Attributes", {}),
        }


async def main():
    """Main loop: connect to RabbitMQ, watch Docker events, publish updates."""
    logger.info("Observer Service starting...")

    # Connect to RabbitMQ with retry
    connection = None
    for attempt in range(1, 11):
        try:
            connection = await aio_pika.connect_robust(RABBITMQ_URL)
            logger.info("RabbitMQ connected on attempt %d", attempt)
            break
        except Exception as exc:
            logger.warning("RabbitMQ attempt %d failed: %s", attempt, exc)
            await asyncio.sleep(3)

    if connection is None:
        logger.error("Could not connect to RabbitMQ. Exiting.")
        return

    channel = await connection.channel()

    # Ensure exchange exists
    await channel.declare_exchange("edulab.topic", aio_pika.ExchangeType.TOPIC, durable=True)

    # Connect to Redis
    redis_client = aioredis.from_url(REDIS_URL, decode_responses=True)

    # Status map for Redis updates
    status_map = {
        "container.start": "running",
        "container.stop": "stopped",
        "container.die": "crashed",
        "container.destroy": "deleted",
        "container.kill": "killed",
        "container.oom": "oom_killed",
        "container.exec": "running",  # exec doesn't change status
    }

    # Perform initial sync
    await sync_redis_with_docker(redis_client)

    logger.info("Observer Service ready. Listening for Docker events...")

    # Watch events in a thread (Docker SDK is synchronous)
    loop = asyncio.get_event_loop()

    def blocking_watch():
        """Run blocking Docker event watcher and put events in queue."""
        for event in watch_docker_events():
            asyncio.run_coroutine_threadsafe(
                handle_event(channel, redis_client, event, status_map),
                loop,
            )

    await loop.run_in_executor(None, blocking_watch)


async def handle_event(channel, redis_client, event: dict, status_map: dict):
    """Handle a single Docker event: update Redis and publish to RabbitMQ."""
    try:
        room_id = event["room_id"]
        lab_id = event["lab_id"]
        event_type = event["event_type"]

        # Update Redis status or remove key
        new_status = status_map.get(event_type, "unknown")
        key = f"container:room:{room_id}:{lab_id}"
        
        if event_type in ("container.stop", "container.die", "container.destroy", "container.kill"):
            await redis_client.delete(key)
        elif event_type != "container.exec":  # exec doesn't change status
            await update_redis_status(redis_client, room_id, lab_id, new_status)

        # Publish to RabbitMQ
        await publish_event(channel, event)

        logger.info(
            f"Event: {event_type} | room={room_id} lab={lab_id} | status→{new_status}"
        )
    except Exception as exc:
        logger.error(f"Error handling event: {exc}")


if __name__ == "__main__":
    asyncio.run(main())
