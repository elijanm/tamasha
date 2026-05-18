FROM python:3.11-slim-bookworm AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml ./
RUN pip install --no-cache-dir -e .

COPY worker/ ./worker/

CMD ["celery", "-A", "worker.celery_app", "worker", "--loglevel=info", "--concurrency=4", "-Q", "default,transcoding,sync,email,backup"]
