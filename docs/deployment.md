# Deployment

## Docker

Compose location:

```text
infra/docker/docker-compose.yml
```

Run:

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

## Services
- mongodb
- redis
- backend
- frontend
- worker
- nginx
