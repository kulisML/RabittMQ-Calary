"""RabbitMQ service — publish messages to queues (ТЗ §2.2)."""
import json
import logging
from datetime import datetime, timezone

import aio_pika

from app.config import settings

logger = logging.getLogger(__name__)

# Global connection (initialized on app startup)
_connection: aio_pika.abc.AbstractRobustConnection | None = None
_channel: aio_pika.abc.AbstractChannel | None = None


async def connect() -> None:
    """Establish connection to RabbitMQ and declare exchanges/queues."""
    global _connection, _channel

    _connection = await aio_pika.connect_robust(settings.RABBITMQ_URL)
    _channel = await _connection.channel()

    # Declare exchanges (ТЗ §2.2)
    direct_exchange = await _channel.declare_exchange(
        "edulab.direct", aio_pika.ExchangeType.DIRECT, durable=True
    )
    topic_exchange = await _channel.declare_exchange(
        "edulab.topic", aio_pika.ExchangeType.TOPIC, durable=True
    )
    dlx_exchange = await _channel.declare_exchange(
        "edulab.dlx", aio_pika.ExchangeType.FANOUT, durable=True
    )

    # Dead letter queue
    dlq = await _channel.declare_queue("lab.dead-letter", durable=True)
    await dlq.bind(dlx_exchange)

    # Declare queues with DLQ support
    dlq_args = {"x-dead-letter-exchange": "edulab.dlx"}

    # container.start — API Gateway → Container Manager
    q_start = await _channel.declare_queue(
        "container.start", durable=True, arguments=dlq_args
    )
    await q_start.bind(direct_exchange, routing_key="container.start")

    # container.stop — Container Gateway → Container Manager
    q_stop = await _channel.declare_queue(
        "container.stop", durable=True, arguments=dlq_args
    )
    await q_stop.bind(direct_exchange, routing_key="container.stop")

    # container.events — Observer Service → WebSocket Server (Этап 2)
    q_events = await _channel.declare_queue(
        "container.events", durable=True, arguments=dlq_args
    )
    await q_events.bind(topic_exchange, routing_key="container.events.*")

    # lab.submit — API Gateway → Result Service (Этап 3)
    q_submit = await _channel.declare_queue(
        "lab.submit", durable=True, arguments=dlq_args
    )
    await q_submit.bind(direct_exchange, routing_key="lab.submit")

    # lab.results — Result Service → Notifier (Этап 3)
    q_results = await _channel.declare_queue(
        "lab.results", durable=True, arguments=dlq_args
    )
    await q_results.bind(direct_exchange, routing_key="lab.results")

    logger.info("RabbitMQ connected. Exchanges and queues declared.")


async def disconnect() -> None:
    """Close connection to RabbitMQ."""
    global _connection, _channel
    if _connection:
        await _connection.close()
        _connection = None
        _channel = None
    logger.info("RabbitMQ disconnected.")


async def publish(exchange_name: str, routing_key: str, message: dict) -> None:
    """Publish a JSON message to a RabbitMQ exchange.

    Args:
        exchange_name: Name of exchange (edulab.direct, edulab.topic)
        routing_key: Routing key for the message
        message: Dict payload (will be JSON-serialized)
    """
    if _channel is None:
        raise RuntimeError("RabbitMQ not connected. Call connect() first.")

    exchange = await _channel.get_exchange(exchange_name)

    body = json.dumps(message, default=str).encode("utf-8")

    await exchange.publish(
        aio_pika.Message(
            body=body,
            content_type="application/json",
            delivery_mode=aio_pika.DeliveryMode.PERSISTENT,
            timestamp=datetime.now(timezone.utc),
        ),
        routing_key=routing_key,
    )
    logger.info(f"Published to {exchange_name}/{routing_key}: {message}")
