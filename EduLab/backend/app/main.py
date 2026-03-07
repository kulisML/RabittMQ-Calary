"""EduLab FastAPI application (ТЗ §2.1 — API Gateway)."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.labs import router as labs_router
from app.api.dashboard import router as dashboard_router
from app.services import lab_service, rabbitmq_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def _connect_rabbitmq_with_retry(max_retries: int = 10, delay: float = 3.0):
    """Try to connect to RabbitMQ with retries."""
    for attempt in range(1, max_retries + 1):
        try:
            await rabbitmq_service.connect()
            logger.info("RabbitMQ connected on attempt %d", attempt)
            return
        except Exception as exc:
            logger.warning(
                "RabbitMQ connection attempt %d/%d failed: %s",
                attempt, max_retries, exc,
            )
            if attempt < max_retries:
                await asyncio.sleep(delay)
    logger.error("Could not connect to RabbitMQ after %d attempts. "
                 "API will work, but container start will fail.", max_retries)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Startup
    logger.info("EduLab API Gateway starting...")

    # Create database tables
    from app.database import engine, Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ensured.")

    # Connect Redis (fault-tolerant)
    try:
        await lab_service.init_redis()
        logger.info("Redis connected.")
    except Exception as exc:
        logger.warning("Redis connection failed: %s", exc)

    # Connect RabbitMQ with retries (don't crash if it fails)
    await _connect_rabbitmq_with_retry()

    logger.info("EduLab API Gateway ready.")

    yield

    # Shutdown
    logger.info("EduLab API Gateway shutting down...")
    try:
        await rabbitmq_service.disconnect()
    except Exception:
        pass
    try:
        await lab_service.close_redis()
    except Exception:
        pass


app = FastAPI(
    title="EduLab API",
    description="Система запуска лабораторных работ в изолированных контейнерах",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers (ТЗ §8)
app.include_router(auth_router)
app.include_router(labs_router)
app.include_router(dashboard_router)  # Этап 2


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "service": "edulab-api"}
