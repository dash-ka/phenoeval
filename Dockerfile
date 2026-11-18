# PhenoEval: clinician validation app (Python standard library + SQLite, no other dependencies)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# the app: server, schema, browser files, draft information sheet
COPY app.py schema.sql information-sheet.html docker-entrypoint.py /app/
COPY static/ /app/static/
# the database the study starts from (articles, predictions, HPO; no annotators).
# It is copied into the data volume on the first start only.
COPY seed/phenoeval.db /app/seed/phenoeval.db
# the data volume: answers live here and survive container updates
COPY --chown=1000:1000 data/ /data/

# run as an ordinary user, not root
USER 1000:1000

EXPOSE 8000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/', timeout=4)"]

ENTRYPOINT ["python", "/app/docker-entrypoint.py"]
