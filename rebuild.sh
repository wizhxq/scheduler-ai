#!/usr/bin/env bash
# Run this from the project root after pulling the latest code
# to rebuild and restart all containers.
set -e

echo "\n=== Pulling latest code ==="
git pull origin main

echo "\n=== Stopping containers ==="
docker-compose down

echo "\n=== Rebuilding images (no cache) ==="
docker-compose build --no-cache

echo "\n=== Starting containers ==="
docker-compose up -d

echo "\n✅ Done. Frontend: http://localhost:3000  Backend: http://localhost:8000"
