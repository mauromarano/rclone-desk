FROM node:22-alpine AS frontend
WORKDIR /web
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates unzip curl && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip -o /tmp/rclone.zip \
    && unzip -q /tmp/rclone.zip -d /tmp && cp /tmp/rclone-*-linux-amd64/rclone /usr/local/bin/rclone \
    && chmod +x /usr/local/bin/rclone && rm -rf /tmp/rclone*
WORKDIR /app
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /web/dist ./frontend/dist
ENV APP_DATA=/data FRONTEND_DIST=/app/frontend/dist PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
