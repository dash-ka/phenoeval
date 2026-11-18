#!/usr/bin/env python3
"""Container start-up for PhenoEval.

First start: copy the seed database (articles, predictions, HPO) into the data volume.
Every start: run the app on the database in the volume, reachable from outside the container.
Any arguments given to the container are passed on to app.py (e.g. --info-sheet URL).
"""
import os
import shutil
import sys

DATA = os.environ.get("PHENOEVAL_DATA", "/data")
DB = os.path.join(DATA, os.environ.get("PHENOEVAL_DB", "phenoeval.db"))
SEED = "/app/seed/phenoeval.db"
PORT = os.environ.get("PHENOEVAL_PORT", "8000")

args = sys.argv[1:]

# commands that do their own thing (export, building a database) run as given
if any(a in ("--export", "--data") for a in args):
    if "--db" not in args:
        args = ["--db", DB] + args
    os.execvp("python", ["python", "/app/app.py"] + args)

if not os.path.exists(DB):
    os.makedirs(DATA, exist_ok=True)
    shutil.copyfile(SEED, DB)
    print(f"first start: created {DB} from the seed database", flush=True)

info = os.environ.get("PHENOEVAL_INFO_SHEET", "").strip()
if info and "--info-sheet" not in args:
    args += ["--info-sheet", info]

os.execvp("python", ["python", "/app/app.py", "--db", DB, "--host", "0.0.0.0", "--port", PORT] + args)
