"""Celery application configuration (ТЗ §2.1 — Container Manager)."""
from celery import Celery

from app.config import settings

celery_app = Celery(
    "edulab",
    broker=settings.RABBITMQ_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    # Task serialization
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",

    # Timezone
    timezone="UTC",
    enable_utc=True,

    # Task routing — Celery consumes from these RabbitMQ queues
    task_routes={
        "app.worker.tasks.start_container": {"queue": "container.start"},
        "app.worker.tasks.stop_container": {"queue": "container.stop"},
    },

    # Reliability
    task_acks_late=True,
    worker_prefetch_multiplier=1,

    # Results
    result_expires=3600,
)
