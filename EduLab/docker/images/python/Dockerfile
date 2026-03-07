# edulab-python:3.11 (ТЗ §7)
# Базовый образ для лабораторных работ на Python.
# Содержит: Python 3.11, pytest, numpy, pandas, pip, ttyd.

FROM python:3.11-slim

# Install ttyd for WebSocket terminal access (ТЗ §7)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && curl -sL https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.x86_64 \
    -o /usr/local/bin/ttyd \
    && chmod +x /usr/local/bin/ttyd \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages (ТЗ §7)
RUN pip install --no-cache-dir \
    pytest==8.3.0 \
    numpy==1.26.4 \
    pandas==2.2.0

# Create non-root user (ТЗ §5.1: запуск от root запрещён)
RUN groupadd -g 1000 student && \
    useradd -u 1000 -g student -m -s /bin/bash student

# Create workspace directory
RUN mkdir -p /workspace && chown student:student /workspace

# Copy test runner script (ТЗ §7)
COPY runner.py /usr/local/bin/runner.py
RUN chmod +x /usr/local/bin/runner.py

# Switch to non-root user
USER student
WORKDIR /workspace

# Expose ttyd port
EXPOSE 7681

# Start ttyd (ТЗ §7: WebSocket-обёртка над bash)
ENTRYPOINT ["ttyd", "--writable", "--port", "7681", "bash"]
