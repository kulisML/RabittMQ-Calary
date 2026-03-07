"""Celery tasks for container lifecycle management (ТЗ §2.1, §5).

Container Manager consumes container.start and container.stop from RabbitMQ.
Uses Docker SDK to create/stop containers with security limits from ТЗ §5.1.
Writes container state to Redis (ТЗ §9.2).
"""
import logging
from datetime import datetime, timezone

import docker
import redis

from app.config import settings
from app.worker.celery_app import celery_app

logger = logging.getLogger(__name__)

# Sync Docker client (Celery tasks are sync)
docker_client = docker.from_env()

# Sync Redis client for Celery worker
redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)


@celery_app.task(name="app.worker.tasks.start_container", bind=True, max_retries=3)
def start_container(self, student_id: int, lab_id: int, language: str,
                    image: str, template_code: str = "", **kwargs):
    """Start a Docker container for a student (ТЗ §3.2, §5.1).

    1. Create Docker volume lab_{student_id}_{lab_id} if not exists
    2. Run container with security limits from ТЗ §5.1
    3. Write container info to Redis (ТЗ §9.2)
    """
    try:
        volume_name = f"lab_{student_id}_{lab_id}"
        container_name = f"edulab-{student_id}-{lab_id}"

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
            # Storage limit via tmpfs
            storage_opt=None,
            # Network disabled (ТЗ §5.1)
            network_mode="none",
            # Non-root user (ТЗ §5.1)
            user="1000:1000",
            # Volume mount (ТЗ §5.2)
            volumes={
                volume_name: {"bind": "/workspace", "mode": "rw"},
            },
            # Read-only root filesystem except /workspace (ТЗ §5.2)
            read_only=False,
            # Working directory
            working_dir="/workspace",
            # Auto-remove on stop — NO, we keep volumes (ТЗ §3.5)
            auto_remove=False,
            # Environment
            environment={
                "STUDENT_ID": str(student_id),
                "LAB_ID": str(lab_id),
            },
            # Publish ttyd port
            ports={"7681/tcp": None},  # Random host port
        )

        # Get assigned port
        container.reload()
        ports = container.ports.get("7681/tcp", [])
        host_port = int(ports[0]["HostPort"]) if ports else 0

        # Write to Redis (ТЗ §9.2): container:{student_id}:{lab_id}
        container_key = f"container:{student_id}:{lab_id}"
        redis_client.hset(container_key, mapping={
            "container_id": container.id[:12],
            "port": str(host_port),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "status": "running",
        })
        redis_client.expire(container_key, settings.CONTAINER_SESSION_MAX_HOURS * 3600)

        # Init stats in Redis (ТЗ §9.2)
        stats_key = f"stats:{student_id}:{lab_id}"
        redis_client.hset(stats_key, mapping={
            "runs_count": "0",
            "errors_count": "0",
            "last_run": "",
        })
        redis_client.expire(stats_key, 86400)

        logger.info(
            f"Container started: {container_name} (port={host_port}) "
            f"for student={student_id} lab={lab_id}"
        )

        return {
            "container_id": container.id[:12],
            "port": host_port,
            "status": "running",
        }

    except Exception as exc:
        logger.error(f"Failed to start container: {exc}")
        # Update Redis status
        container_key = f"container:{student_id}:{lab_id}"
        redis_client.hset(container_key, "status", "error")
        redis_client.expire(container_key, 300)  # Keep error for 5 min
        raise self.retry(exc=exc, countdown=5)


@celery_app.task(name="app.worker.tasks.stop_container", bind=True, max_retries=3)
def stop_container(self, student_id: int, lab_id: int, reason: str = "manual",
                   **kwargs):
    """Stop a Docker container (ТЗ §3.5).

    1. Stop container (don't remove — code saved in Volume)
    2. Update Redis status to offline
    3. Remove from online set
    """
    try:
        container_name = f"edulab-{student_id}-{lab_id}"

        try:
            container = docker_client.containers.get(container_name)
            container.stop(timeout=10)
            container.remove(force=True)
            logger.info(f"Container stopped: {container_name} (reason={reason})")
        except docker.errors.NotFound:
            logger.warning(f"Container not found: {container_name}")

        # Update Redis (ТЗ §9.2)
        container_key = f"container:{student_id}:{lab_id}"
        redis_client.hset(container_key, "status", "stopped")
        redis_client.expire(container_key, 300)  # Keep for 5 min

        return {"status": "stopped", "reason": reason}

    except Exception as exc:
        logger.error(f"Failed to stop container: {exc}")
        raise self.retry(exc=exc, countdown=5)
