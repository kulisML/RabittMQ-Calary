"""Celery tasks for container lifecycle management (ТЗ §2.1, §5).

Container Manager consumes container.start and container.stop from RabbitMQ.
Uses Docker SDK to create/stop containers with security limits from ТЗ §5.1.
Writes container state to Redis (ТЗ §9.2).
"""
import logging
from datetime import datetime, timezone
import json

import docker
import redis
import httpx
import pika

from app.config import settings
from app.worker.celery_app import celery_app


logger = logging.getLogger(__name__)

# Sync Docker client (Celery tasks are sync)
docker_client = docker.from_env()

# Sync Redis client for Celery worker
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)


@celery_app.task(name="app.worker.tasks.start_container", bind=True, max_retries=3)
def start_container(self, room_id: int, lab_id: int, language: str,
                    image: str, template_code: str = "", **kwargs):
    """Start a Docker container for a room.

    1. Create Docker volume lab_room_{room_id}_{lab_id} if not exists
    2. Run container with security limits from ТЗ §5.1
    3. Write container info to Redis
    """
    try:
        volume_name = f"lab_room_{room_id}_{lab_id}"
        container_name = f"edulab-room-{room_id}-{lab_id}"


        # Stop existing container if any
        try:
            existing = docker_client.containers.get(container_name)
            existing.stop(timeout=5)
            existing.remove(force=True)
        except docker.errors.NotFound:
            pass

        # Ensure volume exists (ТЗ §9.3)
        try:
            docker_client.volumes.get(volume_name)
        except docker.errors.NotFound:
            docker_client.volumes.create(name=volume_name)
            logger.info(f"Created volume: {volume_name}")

        # Run container with limits (ТЗ §5.1)
        container = docker_client.containers.run(
            image=image,
            name=container_name,
            detach=True,
            # Resource limits (ТЗ §5.1)
            nano_cpus=int(settings.CONTAINER_CPU_LIMIT * 1e9),  # 50% of 1 core
            mem_limit=settings.CONTAINER_MEM_LIMIT,              # 256MB
            # Volume mount (ТЗ §5.2)
            volumes={
                volume_name: {"bind": "/workspace", "mode": "rw"},
            },
            # Working directory
            working_dir="/workspace",
            # Auto-remove on stop — NO, we keep volumes (ТЗ §3.5)
            auto_remove=False,
            # Environment
            environment={
                "ROOM_ID": str(room_id),
                "LAB_ID": str(lab_id),
            },
            # Publish ttyd port — maps 7681 to random host port
            ports={"7681/tcp": None},
        )

        # Get assigned port
        container.reload()
        ports = container.ports.get("7681/tcp", [])
        host_port = int(ports[0]["HostPort"]) if ports else 0

        # Write to Redis
        container_key = f"container:room:{room_id}:{lab_id}"
        redis_client.hset(container_key, mapping={
            "container_id": container.id[:12],
            "port": str(host_port),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
        })
        redis_client.expire(container_key, settings.CONTAINER_SESSION_MAX_HOURS * 3600)

        # Init stats in Redis
        stats_key = f"stats:room:{room_id}:{lab_id}"
        redis_client.hset(stats_key, mapping={
            "runs_count": "0",
            "errors_count": "0",
            "last_run": "",
        })
        redis_client.expire(stats_key, 86400)

        logger.info(
            f"Container started: {container_name} (port={host_port}) "
            f"for room={room_id} lab={lab_id}"
        )

        return {
            "container_id": container.id[:12],
            "port": host_port,
            "status": "running",
        }

    except Exception as exc:
        logger.error(f"Failed to start container: {exc}")
        # Update Redis status
        container_key = f"container:room:{room_id}:{lab_id}"
        redis_client.hset(container_key, "status", "error")
        redis_client.expire(container_key, 300)  # Keep error for 5 min
        raise self.retry(exc=exc, countdown=5)


@celery_app.task(name="app.worker.tasks.stop_container", bind=True, max_retries=3)
def stop_container(self, room_id: int, lab_id: int, reason: str = "manual",
                   **kwargs):
    """Stop a Docker container.

    1. Stop container (don't remove — code saved in Volume)
    2. Update Redis status to offline
    3. Remove from online set
    """
    try:
        container_name = f"edulab-room-{room_id}-{lab_id}"

        try:
            container = docker_client.containers.get(container_name)
            container.stop(timeout=10)
            container.remove(force=True)
            logger.info(f"Container stopped: {container_name} (reason={reason})")
        except docker.errors.NotFound:
            logger.warning(f"Container not found: {container_name}")

        # Update Redis
        container_key = f"container:room:{room_id}:{lab_id}"
        redis_client.hset(container_key, "status", "stopped")
        redis_client.expire(container_key, 300)  # Keep for 5 min

        return {"status": "stopped", "reason": reason}

    except Exception as exc:
        logger.error(f"Failed to stop container: {exc}")
        raise self.retry(exc=exc, countdown=5)


@celery_app.task(name="app.worker.tasks.reap_idle_containers", bind=True)
def reap_idle_containers(self):
    """Periodic task to stop idle containers (Garbage Collector).
    
    1. Scan Redis for all container:*:* keys
    2. Check if their status is 'running'
    3. If there is no corresponding 'container_ping' key, stop the container.
    """
    logger.info("Running idle container reaper (garbage collection)...")
    try:
        keys = redis_client.keys("container:room:*:*")
        for key in keys:
            parts = key.split(":")
            if len(parts) != 4:
                continue
            
            room_id = parts[2]
            lab_id = parts[3]
            
            container_data = redis_client.hgetall(key)
            if container_data.get("status") in ("running", "starting"):
                # Check for ping heartbeat
                ping_key = f"container_ping_room:{room_id}:{lab_id}"
                if not redis_client.exists(ping_key):
                    logger.warning(
                        f"Container for room {room_id} lab {lab_id} "
                        "has no active ping. Stopping..."
                    )
                    # Use Celery ID to invoke stop_container asynchronously
                    stop_container.delay(int(room_id), int(lab_id), reason="idle_timeout")
                else:
                    logger.debug(f"Container room {room_id}:{lab_id} is active.")
                    
    except Exception as exc:
        logger.error(f"Error in reap_idle_containers: {exc}")

@celery_app.task(name="app.worker.tasks.analyze_code_ai", bind=True)
def analyze_code_ai(self, room_id: int, lab_id: int, code: str, language: str):
    """Analyze code using OpenRouter and publish suggestions as Plaques via RabbitMQ."""
    if not code or len(code.strip()) < 10:
        return {"status": "skipped", "reason": "code_too_short"}

    openrouter_api_key = os.environ.get("OPENROUTER_API_KEY", "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")
    if not openrouter_api_key:
        logger.error("OPENROUTER_API_KEY missing.")
        return {"status": "error", "reason": "missing_api_key"}

    prompt = f"""You are an expert AI code reviewer and pair programming assistant.
Analyze the following {language} code. Focus on:
1. Identifying syntax errors or logical bugs.
2. Suggesting clean code improvements.
3. If it looks like multiple people edited and caused a conflict, suggest a merge.

Respond with a JSON object containing a 'plaques' array.
Each plaque should have:
- type: 'info', 'warning', 'error', or 'success'
- message: A short, concise message (max 2 sentences)
- recommendation: (Optional) specific code snippet or action to fix it.
- line: (Optional) the approximate line number.

Code:
```
{code}
```
"""

    try:
        response = httpx.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openrouter_api_key}",
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "EduLab AI",
            },
            json={
                "model": "liquid/lfm-2.5-1.2b-thinking:free",
                "messages": [{"role": "user", "content": prompt}],
                "response_format": {"type": "json_object"}
            },
            timeout=15.0
        )
        response.raise_for_status()
        data = response.json()
        content = data["choices"][0]["message"]["content"]
        
        # Parse JSON
        result = json.loads(content)
        plaques = result.get("plaques", [])

        if not plaques:
            return {"status": "success", "plaques": 0}

        # Publish to RabbitMQ
        rabbitmq_url = os.environ.get("RABBITMQ_URL", "amqp://edulab:edulab_secret@rabbitmq:5672//")
        params = pika.URLParameters(rabbitmq_url)
        connection = pika.BlockingConnection(params)
        channel = connection.channel()
        channel.exchange_declare(exchange="edulab.topic", exchange_type="topic", durable=True)

        routing_key = f"ai.plaques.room.{room_id}"
        event_data = {
            "room_id": room_id,
            "lab_id": lab_id,
            "event_type": "ai.plaque",
            "plaques": plaques,
            "timestamp": int(datetime.now(timezone.utc).timestamp())
        }

        channel.basic_publish(
            exchange="edulab.topic",
            routing_key=routing_key,
            body=json.dumps(event_data),
            properties=pika.BasicProperties(
                delivery_mode=2,  # make message persistent
            )
        )
        redis_client.setex(
            f"ai_plaques:room:{room_id}:{lab_id}",
            600, # 10 minutes cache
            json.dumps({"plaques": plaques, "timestamp": int(datetime.now(timezone.utc).timestamp())})
        )

        logger.info(f"Published {len(plaques)} AI plaques for room {room_id}")
        return {"status": "success", "plaques": len(plaques)}

    except Exception as exc:
        logger.error(f"Failed to analyze code: {exc}")
        return {"status": "error", "details": str(exc)}


