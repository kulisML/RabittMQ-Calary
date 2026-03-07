from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://edulab:edulab_secret@postgres:5432/edulab"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # RabbitMQ
    RABBITMQ_URL: str = "amqp://edulab:edulab_secret@rabbitmq:5672//"

    # JWT
    JWT_SECRET: str = "change-me-in-production-super-secret-key-2024"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    # Container limits (ТЗ §5.1)
    CONTAINER_CPU_LIMIT: float = 0.5        # 50% одного ядра
    CONTAINER_MEM_LIMIT: str = "256m"       # 256 МБ
    CONTAINER_DISK_LIMIT: str = "512m"      # 512 МБ
    CONTAINER_SESSION_MAX_HOURS: int = 4    # Максимум 4 часа

    # Container image
    DEFAULT_PYTHON_IMAGE: str = "edulab-python:3.11"

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
