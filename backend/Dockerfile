# API FastAPI billetterie (Render : dockerContext=backend, target runtime par defaut).
#   cd backend && docker build --target runtime -t billetterie-api .
#
# Variante avec UI embarquee (monorepo, dossier frontend/ a la racine) :
#   docker build -f backend/Dockerfile --target with-ui -t billetterie-api:ui ..

FROM python:3.12-slim-bookworm AS runtime
# No apt-get here: keeps builds working when Debian mirrors are unreachable in CI/sandbox.
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 --create-home --shell /usr/sbin/nologin app

WORKDIR /app

COPY pyproject.toml README.md ./
COPY auth ./auth/
COPY checkin ./checkin/
COPY events ./events/
COPY http_layer ./http_layer/
COPY money ./money/
COPY notify ./notify/
COPY orders ./orders/
COPY payments ./payments/
COPY scan ./scan/
COPY store ./store/
COPY tickets ./tickets/
COPY cli.py config.py bootstrap.py spa.py seed_festival.py __init__.py __main__.py ./
COPY migrations ./migrations
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

RUN pip install --no-cache-dir .

RUN mkdir -p /srv/data/media && chown -R app:app /srv/data /app

USER app
WORKDIR /srv/data

ENV CHANTIER3A_ADDR=":8080" \
    CHANTIER3A_DATA_DIR="/srv/data" \
    CHANTIER3A_MEDIA_DIR="/srv/data/media"

VOLUME ["/srv/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=45s --retries=5 \
    CMD python -c "import os, urllib.request; p=os.environ.get('PORT','8080'); urllib.request.urlopen(f'http://127.0.0.1:{p.lstrip(\":\")}/healthz?db=0', timeout=3)"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["serve"]

FROM node:22-bookworm-slim AS web
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM runtime AS with-ui
USER root
COPY --from=web --chown=app:app /build/frontend/dist /app/frontend/dist
USER app
