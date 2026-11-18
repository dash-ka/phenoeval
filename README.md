# PhenoEval

Clinician validation of patient-level phenotype profiles extracted by an LLM pipeline from
published case reports. Clinicians check each predicted HPO term and patient assignment in
the article text, add missed phenotypes, and submit; every answer is stored in a SQLite
database and can be exported as CSV.

The app is one Python program (standard library only) plus a browser interface. It runs in a
Docker container, so the only thing to install is Docker. It can also run without Docker,
with Python alone (section 10).

> In the commands below, replace **`YOUR-GITHUB-ACCOUNT`** with the GitHub account or
> organisation that owns this repository.

---

## 1. Requirements

* **Docker**: [Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS or
  Windows, or Docker Engine with the Compose plugin on Linux. Check with:

  ```
  docker --version
  docker compose version
  ```
* About 300 MB of disk space.
* Access to this repository (it is private: ask the study team to add you).

## 2. Install and start

Choose **one** of the two options.

### Option A: from the repository (simplest)

```
git clone https://github.com/YOUR-GITHUB-ACCOUNT/phenoeval.git
cd phenoeval
docker compose up -d
```

The first start builds the image (about a minute) and creates the database. Then open
**http://localhost:8000** in a browser.

### Option B: the ready-made image from GitHub

Every push to `main` builds an image and publishes it to the GitHub Container Registry.
For a private repository, log in once with a GitHub
[personal access token](https://github.com/settings/tokens) that has the `read:packages`
scope:

```
docker login ghcr.io -u YOUR-GITHUB-USERNAME        # paste the token as password
docker run -d --name phenoeval --restart unless-stopped \
  -p 127.0.0.1:8000:8000 -v phenoeval-data:/data \
  ghcr.io/YOUR-GITHUB-ACCOUNT/phenoeval:latest
```

Open **http://localhost:8000**.

On Windows PowerShell, write the `docker run` command on one line (or replace each `\` with a
backtick `` ` ``).

## 3. Using it

* **Sign in** with a name and email. The first time, the welcome page asks for consent; then
  the guidelines, then the list of 50 articles.
* To test as several clinicians, sign in with different emails (sign out from
  *My assignments*, or use a private browser window).
* Answers are saved on every click, in the Docker volume `phenoeval-data`. They survive
  stopping, restarting and updating the container. They are deleted only by
  `docker compose down -v` or `docker volume rm phenoeval-data`: **never run those unless you
  have a backup.**

| Task | Option A (compose) | Option B (docker run) |
|---|---|---|
| Stop | `docker compose stop` | `docker stop phenoeval` |
| Start again | `docker compose start` | `docker start phenoeval` |
| See the log | `docker compose logs -f` | `docker logs -f phenoeval` |
| Status | `docker compose ps` | `docker ps` |

The container restarts by itself after a reboot, as long as Docker is running.

## 4. Export the answers

```
docker exec phenoeval python /app/app.py --db /data/phenoeval.db --export /data/answers.csv
docker cp phenoeval:/data/answers.csv ./answers.csv
```

`answers.csv` has one row per mention (and per added phenotype) per clinician: the predicted
and final HPO term, the decision, the final patient, the pipeline provenance and the time.
This works while the app is running.

## 5. Back up and restore

Back up (safe while the app is running):

```
docker exec phenoeval python -c "import sqlite3; s=sqlite3.connect('/data/phenoeval.db'); d=sqlite3.connect('/data/backup.db'); s.backup(d); d.close()"
docker cp phenoeval:/data/backup.db ./phenoeval-backup-$(date +%Y%m%d).db
```

Restore a backup:

```
docker stop phenoeval
docker cp ./phenoeval-backup-YYYYMMDD.db phenoeval:/data/phenoeval.db
docker start phenoeval
```

To look inside the database, open a backup copy read-only in DataGrip or DB Browser for SQLite.

## 6. Information sheet

The consent page links to the study information sheet. The image contains a draft
(`information-sheet.html`, with the parts to fill in highlighted). To use your own:

* a web address: set it in `docker-compose.yml` (`PHENOEVAL_INFO_SHEET: "https://..."`) and run
  `docker compose up -d`; with `docker run`, add `-e PHENOEVAL_INFO_SHEET=https://...`;
* or a file: `docker cp information-sheet.pdf phenoeval:/data/information-sheet.pdf`
  (an `information-sheet.html` works too). No restart needed.

## 7. Update to a new version

Answers are kept: they live in the volume, not in the image.

* Option A: `git pull` then `docker compose up -d --build`
* Option B: `docker pull ghcr.io/YOUR-GITHUB-ACCOUNT/phenoeval:latest`, then
  `docker rm -f phenoeval` and the same `docker run` command as in section 2.

An older database is upgraded automatically at start (columns are added or dropped; answers
are kept).

## 8. Letting other computers use it

By default only the computer running Docker can open the app (`127.0.0.1:8000`).

**The app has no passwords**: anyone who can reach it can sign in with any email. Before
clinicians use it from their own computers, put it behind access control: for example your
institution's VPN, or a reverse proxy (nginx, Caddy, Traefik) with HTTPS and a login. Then
change the port line in `docker-compose.yml` to `"8000:8000"` (or the proxy's network), and
give clinicians the proxy's address.

## 9. A new run of the pipeline

The articles and predictions come from `seed/phenoeval.db`, built from the pipeline output by
the converter in `converter/` (see `converter/README.md`). After a new pipeline run:

1. Convert it (needs Python 3.9+ and `pip install jsonschema`):

   ```
   cd converter
   python3 tools/convert_pipeline.py path/to/new_run -o data_new \
       --hpo-release 2026-09-01 --hpo path/to/hp.json
   ```
   Check the summary it prints and `data_new/conversion_report.tsv`.
2. Build a new database inside the container (put `hp.json` in `data_new/` first):

   ```
   docker run --rm -v phenoeval-data:/data -v "$(pwd)/data_new:/in:ro" \
     --entrypoint python phenoeval:local /app/app.py \
     --db /data/phenoeval_run2.db --data /in --hpo /in/hp.json --build-only
   ```
   (Option B: use `ghcr.io/YOUR-GITHUB-ACCOUNT/phenoeval:latest` instead of `phenoeval:local`.)
3. Switch the app to it: add `PHENOEVAL_DB: "phenoeval_run2.db"` under `environment` in
   `docker-compose.yml` (or `-e PHENOEVAL_DB=phenoeval_run2.db` with `docker run`) and restart.

Answers given on the previous run stay in `phenoeval.db` and are not carried over: mention IDs
are renumbered in every conversion. Export them first. To make a new run the default for fresh
installations, replace `seed/phenoeval.db` with the new database and push.

## 10. Without Docker (Python only)

Useful where Docker is not available or not allowed (for example a shared university server
where your account is not in the `docker` group). Needs **Python 3.9 or later** and nothing
else: no packages to install, no admin rights.

```
git clone https://github.com/YOUR-GITHUB-ACCOUNT/phenoeval.git
cd phenoeval
cp seed/phenoeval.db data/phenoeval.db        # first time only: the working database
python3 app.py --db data/phenoeval.db --port 8000
```

Open **http://localhost:8000**. Stop with Ctrl+C. Answers are saved in
`data/phenoeval.db` (never pushed to GitHub: `.gitignore` excludes it).

* **Port in use?** Check with `ss -ltn | grep ':8000 '` and pick another, e.g. `--port 8090`.
* **Keep it running after you log out:**

  ```
  nohup python3 app.py --db data/phenoeval.db --port 8000 > app.log 2>&1 &
  ```
  Stop it later with `pkill -f "app.py --db data/phenoeval.db"`.
* **On a remote server**, the app listens only on the server itself. Open it from your own
  computer through an SSH tunnel, then browse to http://localhost:8000 on your computer:

  ```
  ssh -L 8000:localhost:8000 your-username@server.address
  ```
* **Export:** `python3 app.py --db data/phenoeval.db --export answers.csv`
* **Back up:** `python3 -c "import sqlite3; s=sqlite3.connect('data/phenoeval.db'); d=sqlite3.connect('data/backup.db'); s.backup(d); d.close()"`
  (safe while the app is running).
* **Information sheet:** put `information-sheet.pdf` (or `.html`) in `data/`, next to the
  database, or start with `--info-sheet https://...`.
* **Update:** `git pull`, then restart the app. Your `data/phenoeval.db` is kept and upgraded
  automatically if needed.
* **New pipeline run:** convert it (section 9, step 1), then
  `python3 app.py --db data/phenoeval_run2.db --data converter/data_new --hpo path/to/hp.json --build-only`
  and start the app with `--db data/phenoeval_run2.db`.

The same caution as section 8 applies: the app has no passwords, so do not start it with
`--host 0.0.0.0` on a machine others can reach without access control.

---

## For the maintainer: publishing on GitHub

1. Create a **private** repository named `phenoeval` on GitHub (the seed database contains the
   full text of the 50 articles: keep it private).
2. From this folder:

   ```
   git init -b main
   git add .
   git commit -m "PhenoEval app with Docker"
   git remote add origin https://github.com/YOUR-GITHUB-ACCOUNT/phenoeval.git
   git push -u origin main
   ```
3. The workflow in `.github/workflows/docker-image.yml` builds the image for Intel/AMD and ARM
   (Apple silicon) and publishes `ghcr.io/YOUR-GITHUB-ACCOUNT/phenoeval:latest`. Follow it under
   the repository's **Actions** tab (a few minutes).
4. The image is a private package by default. Give your PI access to the repository
   (*Settings → Collaborators*), and to the package if needed (*your profile → Packages →
   phenoeval → Package settings → Manage access*).
5. To mark a version: `git tag v1.0.0 && git push --tags` publishes `:1.0.0` as well.

## What is in this repository

| Path | What it is |
|---|---|
| `app.py`, `schema.sql`, `static/` | The app: server, database schema, browser interface |
| `information-sheet.html` | Draft information sheet (fill in the highlighted parts) |
| `seed/phenoeval.db` | Starting database: 50 articles, 276 patients, 2,767 mentions, HPO 2026-09-01; no answers |
| `Dockerfile`, `docker-entrypoint.py`, `docker-compose.yml` | Container set-up |
| `.github/workflows/docker-image.yml` | Builds and publishes the image on GitHub |
| `converter/` | Turns pipeline output into app input (not part of the image) |
| `data/` | Empty; becomes the data volume inside the container |
