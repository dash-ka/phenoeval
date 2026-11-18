#!/usr/bin/env python3
"""
PhenoEval: local annotation app (working core).

  python3 app.py --data review50_input_v12 --hpo hp.json        # first run: builds phenoeval.db
  python3 app.py                                                # later runs: reuses phenoeval.db

Then open http://localhost:8000 in a browser.

Only the Python standard library is used (no installs). The database is SQLite (WAL mode),
created from schema.sql. Every click in the browser is saved at once.
The gold standard is never read.
"""
import argparse
import glob
import http.cookies
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

HERE = Path(__file__).resolve().parent
STATIC = HERE / "static"
ROOT_TERM = "HP:0000118"  # Phenotypic abnormality
DB_PATH = None
HPO_INDEX = []            # [(hpo_id, label, label_lower, [synonyms], [synonyms_lower])] for search
HPO_LOCK = threading.Lock()


# ------------------------------------------------------------------ database
# columns removed from the schema; an older database is upgraded in place at start-up (data is kept)
DROPPED = [("article", "journal"), ("article", "year"), ("article", "doi"), ("article", "source_file"), ("article", "loaded_at"),
           ("annotator", "role"), ("session", "created_at"), ("event", "client_at")]


INFO_SHEET = ""
# columns added to the schema since the first version (added to an older database at start-up)
ADDED_COLS = [("added_phenotype", "cell_row"), ("added_phenotype", "cell_col")]


def upgrade_db():
    if not os.path.exists(DB_PATH):
        return
    db = connect()
    try:
        for t, c in DROPPED:
            if c in [r[1] for r in db.execute(f"PRAGMA table_info({t})")]:
                db.execute(f"ALTER TABLE {t} DROP COLUMN {c}")
                print(f"  upgraded database: dropped {t}.{c}", flush=True)
        for t, c in ADDED_COLS:
            if c not in [r[1] for r in db.execute(f"PRAGMA table_info({t})")]:
                db.execute(f"ALTER TABLE {t} ADD COLUMN {c} INTEGER")
                print(f"  upgraded database: added {t}.{c}", flush=True)
        db.commit()
    finally:
        db.close()


def connect():
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def create_db(data_dir, hpo_path):
    if os.path.exists(DB_PATH):
        sys.exit(f"{DB_PATH} already exists. Delete it to rebuild, or run without --data/--hpo.")
    db = sqlite3.connect(DB_PATH)
    db.executescript((HERE / "schema.sql").read_text(encoding="utf-8"))
    print("loading HPO ...", flush=True)
    load_hpo(db, hpo_path)
    files = sorted(glob.glob(os.path.join(data_dir, "PMID_*.json")))
    if not files:
        sys.exit(f"no PMID_*.json files in {data_dir}")
    n_m = 0
    for f in files:
        n_m += load_article(db, f)
    db.commit()
    print(f"loaded {len(files)} articles, {n_m} mentions into {DB_PATH}")
    db.close()


def load_hpo(db, path):
    data = json.load(open(path, encoding="utf-8"))
    g = data["graphs"][0]
    terms, parents = {}, {}
    for n in g.get("nodes", []):
        iri = n.get("id", "")
        if "/HP_" not in iri or not n.get("lbl"):
            continue
        hid = "HP:" + iri.rsplit("/HP_", 1)[1]
        meta = n.get("meta", {})
        terms[hid] = {
            "label": n["lbl"],
            "obsolete": 1 if meta.get("deprecated") else 0,
            "def": (meta.get("definition") or {}).get("val"),
            "syn": [s["val"] for s in meta.get("synonyms", []) if s.get("val")],
        }
    for e in g.get("edges", []):
        if e.get("pred") != "is_a":
            continue
        s, o = e["sub"], e["obj"]
        if "/HP_" in s and "/HP_" in o:
            s = "HP:" + s.rsplit("/HP_", 1)[1]
            o = "HP:" + o.rsplit("/HP_", 1)[1]
            parents.setdefault(s, []).append(o)
    systems = {}

    def sys_of(t, seen=()):
        if t in systems:
            return systems[t]
        out = set()
        for p in parents.get(t, []):
            if p == ROOT_TERM:
                out.add(t)
            elif p not in seen:
                out |= sys_of(p, seen + (t,))
        systems[t] = out
        return out

    sys.setrecursionlimit(10000)
    rows = []
    for hid, t in terms.items():
        rows.append((hid, t["label"], t["obsolete"], t["def"], json.dumps(t["syn"]),
                     json.dumps(parents.get(hid, [])), json.dumps(sorted(sys_of(hid)))))
    db.executemany("INSERT INTO hpo_term VALUES (?,?,?,?,?,?,?)", rows)
    print(f"  {len(rows)} HPO terms")


def load_article(db, path):
    d = json.load(open(path, encoding="utf-8"))
    a, pm = d["article"], d["article"]["pmid"]
    db.execute("INSERT INTO article(pmid,title,hpo_release) VALUES (?,?,?)", (pm, a["title"], d["hpo_release"]))
    for i, s in enumerate(d["sections"]):
        tj = json.dumps({k: s[k] for k in ("rows", "header_rows", "caption") if k in s}) if s["kind"] == "table" else None
        db.execute("INSERT INTO section VALUES (?,?,?,?,?,?,?)", (pm, s["id"], i, s["kind"], s.get("title"), s.get("text"), tj))
    for i, p in enumerate(d["patients"]):
        db.execute("INSERT INTO patient VALUES (?,?,?,?,?)",
                   (pm, p["id"], p["label"], json.dumps(p["aliases"]) if p.get("aliases") else None, i))
    for m in d["mentions"]:
        pv, c = m.get("provenance") or {"term_source": "linker"}, m.get("cell") or {}
        db.execute("INSERT INTO mention VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   (pm, m["id"], m["patient_id"], m["section_id"], m.get("start"), m.get("end"), c.get("row"), c.get("col"),
                    c.get("start"), c.get("end"),
                    m["text"], m.get("extracted_as"), (m.get("predicted") or {}).get("hpo_id"), pv["term_source"],
                    pv.get("lookup_id"), pv.get("linker_id"), pv.get("linker_confidence"), pv.get("no_code_reason")))
        for cd in m["candidates"]:
            db.execute("INSERT INTO candidate VALUES (?,?,?,?)", (pm, m["id"], cd["rank"], cd["hpo_id"]))
    return len(d["mentions"])


def is_phenotype(db, hid):
    r = db.execute("SELECT systems_json, obsolete FROM hpo_term WHERE hpo_id = ?", (hid,)).fetchone()
    return bool(r) and r["systems_json"] != "[]" and not r["obsolete"]


def build_search_index():
    db = connect()
    idx = []
    # only terms under Phenotypic abnormality can be searched and chosen (not inheritance, onset, frequency, ...)
    for r in db.execute("SELECT hpo_id, label, synonyms_json FROM hpo_term WHERE obsolete = 0 AND systems_json <> '[]'"):
        syn = json.loads(r["synonyms_json"] or "[]")
        idx.append((r["hpo_id"], r["label"], r["label"].lower(), syn, [s.lower() for s in syn]))
    db.close()
    HPO_INDEX[:] = idx


# ------------------------------------------------------------------ helpers
def now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def term_info(db, ids, full=True):
    out = {}
    ids = [i for i in set(ids) if i]
    if not ids:
        return out
    q = ",".join("?" * len(ids))
    for r in db.execute(f"SELECT * FROM hpo_term WHERE hpo_id IN ({q})", ids):
        out[r["hpo_id"]] = {"id": r["hpo_id"], "label": r["label"], "def": r["definition"],
                            "syn": json.loads(r["synonyms_json"] or "[]"),
                            "parents": json.loads(r["parents_json"] or "[]"),
                            "systems": json.loads(r["systems_json"] or "[]"), "obsolete": r["obsolete"]}
    if full:
        extra = set()
        for t in out.values():
            extra.update(t["parents"])
            extra.update(t["systems"])
        labels = {r["hpo_id"]: r["label"] for r in db.execute(
            f"SELECT hpo_id, label FROM hpo_term WHERE hpo_id IN ({','.join('?' * len(extra))})", list(extra))} if extra else {}
        for t in out.values():
            t["parents"] = [{"id": p, "label": labels.get(p, p)} for p in t["parents"]]
            t["systems"] = [{"id": p, "label": labels.get(p, p)} for p in t["systems"]]
    return out


def children_of(db, hid):
    # parents_json holds a JSON list; a LIKE on the quoted ID is enough for the small number of lookups we do
    rows = db.execute("SELECT hpo_id, label FROM hpo_term WHERE obsolete = 0 AND parents_json LIKE ?", (f'%"{hid}"%',))
    return [{"id": r["hpo_id"], "label": r["label"]} for r in rows]


def search_hpo(q, limit=30):
    q = q.strip().lower()
    if len(q) < 2:
        return [], 0
    hits = []
    for hid, lab, labl, syn, synl in HPO_INDEX:
        if q == hid.lower() or q == labl:
            hits.append((0, len(lab), hid, ""))
        elif labl.startswith(q):
            hits.append((1, len(lab), hid, ""))
        elif q in labl:
            hits.append((2, len(lab), hid, ""))
        elif q in hid.lower():
            hits.append((3, len(lab), hid, ""))
        else:
            for s, sl in zip(syn, synl):
                if q in sl:
                    hits.append((4, len(lab), hid, s))
                    break
    hits.sort()
    return hits[:limit], len(hits)


# ------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "PhenoEval/0.1"

    def log_message(self, fmt, *args):
        if os.environ.get("PHENOEVAL_LOG"):
            super().log_message(fmt, *args)

    # ---- plumbing
    def send_json(self, obj, code=200, headers=None):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def user(self, db):
        c = http.cookies.SimpleCookie(self.headers.get("Cookie") or "")
        tok = c["pe_token"].value if "pe_token" in c else None
        if not tok:
            return None
        r = db.execute("SELECT a.* FROM session s JOIN annotator a USING (annotator_id) WHERE s.token = ?", (tok,)).fetchone()
        return r

    def do_GET(self):
        self.route("GET")

    def do_POST(self):
        self.route("POST")

    def do_DELETE(self):
        self.route("DELETE")

    def route(self, method):
        url = urlparse(self.path)
        path = unquote(url.path)
        if not path.startswith("/api/"):
            return self.static(path)
        db = connect()
        try:
            if path == "/api/login" and method == "POST":
                return self.login(db)
            me = self.user(db)
            if me is None:
                return self.send_json({"error": "not signed in"}, 401)
            qs = parse_qs(url.query)
            parts = path.strip("/").split("/")[1:]  # after 'api'
            if parts == ["me"]:
                return self.send_json({"id": me["annotator_id"], "name": me["display_name"], "email": me["email"], "consent_at": me["consent_at"]})
            if parts == ["consent"] and method == "POST":
                # welcome page: the clinician ticked the consent box (the first time counts)
                db.execute("UPDATE annotator SET consent_at = COALESCE(consent_at, ?) WHERE annotator_id = ?", (now(), me["annotator_id"]))
                db.commit()
                return self.send_json({"ok": True})
            if parts == ["logout"] and method == "POST":
                return self.send_json({"ok": True}, headers={"Set-Cookie": "pe_token=; Path=/; Max-Age=0"})
            if parts == ["articles"]:
                return self.articles(db, me)
            if len(parts) == 2 and parts[0] == "articles" and method == "GET":
                return self.article(db, me, parts[1])
            if len(parts) == 3 and parts[0] == "articles" and parts[2] == "decision":
                return self.decision(db, me, parts[1], method)
            if len(parts) == 3 and parts[0] == "articles" and parts[2] == "added" and method == "POST":
                return self.added_save(db, me, parts[1])
            if len(parts) == 4 and parts[0] == "articles" and parts[2] == "added" and method == "DELETE":
                return self.added_delete(db, me, parts[1], int(parts[3]))
            if len(parts) == 3 and parts[0] == "articles" and parts[2] == "review":
                return self.review(db, me, parts[1])
            if len(parts) == 3 and parts[0] == "articles" and parts[2] == "submit" and method == "POST":
                return self.submit(db, me, parts[1])
            if len(parts) == 3 and parts[0] == "articles" and parts[2] == "event" and method == "POST":
                return self.client_event(db, me, parts[1])
            if parts == ["hpo", "search"]:
                return self.hpo_search(db, (qs.get("q") or [""])[0], (qs.get("limit") or ["30"])[0])
            if parts == ["hpo", "lineage"]:
                return self.hpo_lineage(db, [i for i in (qs.get("ids") or [""])[0].split(",") if i])
            if len(parts) == 3 and parts[:2] == ["hpo", "term"]:
                t = term_info(db, [parts[2]]).get(parts[2])
                if not t:
                    return self.send_json({"error": "unknown term"}, 404)
                t["children"] = children_of(db, parts[2])
                return self.send_json(t)
            return self.send_json({"error": "not found"}, 404)
        except ValueError as e:
            db.rollback()
            return self.send_json({"error": str(e)}, 400)
        except sqlite3.IntegrityError as e:
            db.rollback()
            return self.send_json({"error": "rejected by the database: " + str(e)}, 400)
        finally:
            db.close()

    def info_sheet(self):
        # the study's information sheet: a URL given with --info-sheet, or a file
        # information-sheet.pdf / information-sheet.html next to the database or in the app folder
        if INFO_SHEET.startswith(("http://", "https://")):
            self.send_response(302)
            self.send_header("Location", INFO_SHEET)
            self.end_headers()
            return
        # looked for next to the database first (e.g. the Docker data volume), then in the app folder
        places = [Path(DB_PATH).resolve().parent, HERE]
        for name, ctype in (("information-sheet.pdf", "application/pdf"), ("information-sheet.html", "text/html; charset=utf-8")):
            f = next((d / name for d in places if (d / name).is_file()), None)
            if f:
                data = f.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
                return
        data = ('<!doctype html><meta charset="utf-8"><title>Information sheet</title>'
                '<body style="font-family:Inter,system-ui,sans-serif;max-width:640px;margin:80px auto;padding:0 20px;color:#1F2328;line-height:1.6">'
                '<h1 style="font-size:22px">Information sheet</h1><p style="color:#4A5059">The study team has not added the information sheet yet. '
                'Please contact them before giving your consent.</p></body>').encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def static(self, path):
        if path == "/information-sheet":
            return self.info_sheet()
        if path in ("/", "") or not Path(path).suffix:
            path = "/index.html"
        f = (STATIC / path.lstrip("/")).resolve()
        if STATIC not in f.parents or not f.is_file():
            self.send_response(404)
            self.end_headers()
            return
        ctype = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"}.get(f.suffix, "application/octet-stream")
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    # ---- API
    def login(self, db):
        b = self.body()
        name, email = (b.get("name") or "").strip(), (b.get("email") or "").strip().lower()
        if not name or not re.match(r"^[^@\s]+@[^@\s]+$", email):
            raise ValueError("enter your name and a valid email")
        r = db.execute("SELECT annotator_id FROM annotator WHERE email = ?", (email,)).fetchone()
        if r:
            aid = r[0]
        else:
            aid = db.execute("INSERT INTO annotator(display_name, email) VALUES (?,?)", (name, email)).lastrowid
        # every annotator gets every article (same set for agreement)
        for i, (pm,) in enumerate(db.execute("SELECT pmid FROM article ORDER BY CAST(pmid AS INTEGER)").fetchall()):
            db.execute("INSERT OR IGNORE INTO assignment(annotator_id, pmid, position) VALUES (?,?,?)", (aid, pm, i + 1))
        tok = secrets.token_urlsafe(24)
        db.execute("INSERT INTO session(token, annotator_id) VALUES (?,?)", (tok, aid))
        db.commit()
        self.send_json({"ok": True}, headers={"Set-Cookie": f"pe_token={tok}; Path=/; HttpOnly; SameSite=Lax"})

    def articles(self, db, me):
        rows = db.execute("""
            SELECT a.pmid, a.title, s.position, s.started_at, s.submitted_at,
                   (SELECT COUNT(*) FROM patient p WHERE p.pmid = a.pmid) AS patients,
                   (SELECT COUNT(*) FROM mention m WHERE m.pmid = a.pmid) AS total,
                   (SELECT COUNT(*) FROM decision d WHERE d.pmid = a.pmid AND d.annotator_id = s.annotator_id AND d.decision IS NOT NULL) AS done
            FROM assignment s JOIN article a USING (pmid)
            WHERE s.annotator_id = ? ORDER BY s.position""", (me["annotator_id"],)).fetchall()
        self.send_json([dict(r) for r in rows])

    def check_assigned(self, db, me, pm):
        r = db.execute("SELECT * FROM assignment WHERE annotator_id = ? AND pmid = ?", (me["annotator_id"], pm)).fetchone()
        if not r:
            raise ValueError("article not assigned")
        return r

    def article(self, db, me, pm):
        asg = self.check_assigned(db, me, pm)
        if not asg["started_at"]:
            db.execute("UPDATE assignment SET started_at = ? WHERE annotator_id = ? AND pmid = ?", (now(), me["annotator_id"], pm))
            db.commit()
        a = dict(db.execute("SELECT pmid, title, hpo_release FROM article WHERE pmid = ?", (pm,)).fetchone())
        secs = []
        for r in db.execute("SELECT * FROM section WHERE pmid = ? ORDER BY position", (pm,)):
            s = {"id": r["section_id"], "kind": r["kind"], "title": r["title"]}
            if r["table_json"]:
                s.update(json.loads(r["table_json"]))
            else:
                s["text"] = r["text"]
            secs.append(s)
        pats = [{"id": r["patient_id"], "label": r["label"], "aliases": json.loads(r["aliases_json"] or "[]")}
                for r in db.execute("SELECT * FROM patient WHERE pmid = ? ORDER BY position", (pm,))]
        cands = {}
        # candidates offered for Revise: only current terms under Phenotypic abnormality
        for r in db.execute("""SELECT c.mention_id, c.hpo_id FROM candidate c JOIN hpo_term t USING (hpo_id)
                               WHERE c.pmid = ? AND t.systems_json <> '[]' AND t.obsolete = 0
                               ORDER BY c.mention_id, c.rank""", (pm,)):
            cands.setdefault(r["mention_id"], []).append(r["hpo_id"])
        ments, ids = [], set()
        # provenance (lookup/linker, confidence) is deliberately not sent: annotators judge the term, not its source
        for r in db.execute("SELECT * FROM mention WHERE pmid = ? ORDER BY mention_id", (pm,)):
            m = {"id": r["mention_id"], "pt": r["patient_id"], "sec": r["section_id"], "text": r["text"],
                 "x": r["extracted_as"], "t": r["predicted_hpo_id"], "c": cands.get(r["mention_id"], [])}
            if m["t"] and m["t"] not in m["c"]:
                m["c"] = [m["t"]] + m["c"]  # the prediction is always shown (as the current term), even outside the branch
            if r["cell_row"] is not None:
                m["cell"] = [r["cell_row"], r["cell_col"], r["cell_start"], r["cell_end"]]
            else:
                m["start"], m["end"] = r["start_offset"], r["end_offset"]
            ments.append(m)
            ids.add(r["predicted_hpo_id"])
            ids.update(m["c"])
        decs = {r["mention_id"]: {k: r[k] for k in ("decision", "final_hpo_id", "revise_via", "reassigned_to", "decided_at")}
                for r in db.execute("SELECT * FROM decision WHERE annotator_id = ? AND pmid = ?", (me["annotator_id"], pm))}
        ids.update(d["final_hpo_id"] for d in decs.values())
        added = [dict(r) for r in db.execute(
            "SELECT added_id, patient_id, span_text, hpo_id, section_id, cell_row, cell_col, start_offset, end_offset FROM added_phenotype WHERE annotator_id = ? AND pmid = ? ORDER BY added_id",
            (me["annotator_id"], pm))]
        ids.update(x["hpo_id"] for x in added)
        self.send_json({"article": a, "sections": secs, "patients": pats, "mentions": ments, "decisions": decs,
                        "added": added, "terms": term_info(db, list(ids)),
                        "submitted_at": asg["submitted_at"], "comment": asg["comment"]})

    def decision(self, db, me, pm, method):
        self.check_assigned(db, me, pm)
        b = self.body()
        mid = b.get("mention_id")
        m = db.execute("SELECT * FROM mention WHERE pmid = ? AND mention_id = ?", (pm, mid)).fetchone()
        if not m:
            raise ValueError("unknown mention")
        aid = me["annotator_id"]
        if method == "DELETE":
            # Clear removes the decision; a patient reassignment, if any, stays
            db.execute("""UPDATE decision SET decision = NULL, final_hpo_id = NULL, revise_via = NULL, decided_at = ?
                          WHERE annotator_id = ? AND pmid = ? AND mention_id = ? AND reassigned_to IS NOT NULL""", (now(), aid, pm, mid))
            db.execute("DELETE FROM decision WHERE annotator_id = ? AND pmid = ? AND mention_id = ? AND reassigned_to IS NULL", (aid, pm, mid))
            self.log(db, aid, pm, mid, None, "clear", {}, b.get("client_at"))
            db.commit()
            return self.send_json({"ok": True})
        dec = b.get("decision")
        if dec not in ("accept", "revise", "no_code", "reject", None):
            raise ValueError("decision must be accept, revise, no_code or reject")
        if dec is None and not (b.get("reassigned_to") or "").strip():
            # removing the only content of a reassignment-only row: drop the row
            db.execute("DELETE FROM decision WHERE annotator_id = ? AND pmid = ? AND mention_id = ? AND decision IS NULL", (aid, pm, mid))
            self.log(db, aid, pm, mid, None, "reassign", {"reassigned_to": None}, b.get("client_at"))
            db.commit()
            return self.send_json({"ok": True, "decision": None, "terms": {}})
        final = None
        if dec == "accept":
            if not m["predicted_hpo_id"]:
                raise ValueError("this mention has no predicted term to accept")
            final = m["predicted_hpo_id"]
        elif dec == "revise":
            final = b.get("final_hpo_id")
            if not is_phenotype(db, final):
                raise ValueError("choose a current HPO term under Phenotypic abnormality")
        via = b.get("revise_via") if dec == "revise" else None
        old = db.execute("SELECT reassigned_to FROM decision WHERE annotator_id = ? AND pmid = ? AND mention_id = ?", (aid, pm, mid)).fetchone()
        re_to = b["reassigned_to"] if "reassigned_to" in b else (old["reassigned_to"] if old else None)
        if dec == "reject":
            re_to = None
        re_to = (re_to or "").strip() or None
        db.execute("""INSERT INTO decision(annotator_id, pmid, mention_id, decision, final_hpo_id, revise_via, reassigned_to, decided_at)
                      VALUES (?,?,?,?,?,?,?,?)
                      ON CONFLICT(annotator_id, pmid, mention_id) DO UPDATE SET
                        decision = excluded.decision, final_hpo_id = excluded.final_hpo_id, revise_via = excluded.revise_via,
                        reassigned_to = excluded.reassigned_to, decided_at = excluded.decided_at""",
                   (aid, pm, mid, dec, final, via, re_to, now()))
        action = "reassign" if b.get("action") == "reassign" else dec
        self.log(db, aid, pm, mid, None, action, {"final_hpo_id": final, "via": via, "reassigned_to": re_to}, b.get("client_at"))
        db.commit()
        r = db.execute("SELECT decision, final_hpo_id, revise_via, reassigned_to, decided_at FROM decision WHERE annotator_id = ? AND pmid = ? AND mention_id = ?",
                       (aid, pm, mid)).fetchone()
        self.send_json({"ok": True, "decision": dict(r), "terms": term_info(db, [final])})

    def added_save(self, db, me, pm):
        self.check_assigned(db, me, pm)
        b = self.body()
        aid = me["annotator_id"]
        hid, pt = b.get("hpo_id"), b.get("patient_id")
        if not hid:
            raise ValueError("an added phenotype needs an HPO term")
        if not is_phenotype(db, hid):
            raise ValueError("choose a current HPO term under Phenotypic abnormality")
        if not db.execute("SELECT 1 FROM patient WHERE pmid = ? AND patient_id = ?", (pm, pt)).fetchone():
            raise ValueError("unknown patient")
        # the evidence is the exact place the clinician selected in the article: a prose section,
        # or one table cell; the stored text is read from the article itself
        sec_id, cell = b.get("section_id"), b.get("cell")
        try:
            a0, a1 = int(b.get("start")), int(b.get("end"))
        except (TypeError, ValueError):
            raise ValueError("select the evidence in the article text")
        sec = db.execute("SELECT text, table_json FROM section WHERE pmid = ? AND section_id = ?", (pm, sec_id)).fetchone()
        if not sec:
            raise ValueError("select the evidence in the article text")
        if cell is not None:
            try:
                r_, c_ = int(cell[0]), int(cell[1])
                src = json.loads(sec["table_json"] or "{}")["rows"][r_][c_]
            except (ValueError, TypeError, KeyError, IndexError):
                raise ValueError("select the evidence in the article text")
        else:
            r_ = c_ = None
            src = sec["text"]
        if src is None or not (0 <= a0 < a1 <= len(src)) or not src[a0:a1].strip():
            raise ValueError("select the evidence in the article text")
        span = src[a0:a1]
        loc = (sec_id, r_, c_, a0, a1)
        if b.get("added_id"):
            n = db.execute("""UPDATE added_phenotype SET span_text = ?, hpo_id = ?, section_id = ?, cell_row = ?, cell_col = ?, start_offset = ?, end_offset = ?, updated_at = ?
                              WHERE added_id = ? AND annotator_id = ? AND pmid = ?""",
                           (span, hid, *loc, now(), int(b["added_id"]), aid, pm)).rowcount
            if not n:
                raise ValueError("unknown added phenotype")
            xid, action = int(b["added_id"]), "edit_added"
        else:
            xid = db.execute("""INSERT INTO added_phenotype(annotator_id, pmid, patient_id, span_text, section_id, cell_row, cell_col, start_offset, end_offset, hpo_id)
                                VALUES (?,?,?,?,?,?,?,?,?,?)""", (aid, pm, pt, span, *loc, hid)).lastrowid
            action = "add"
        self.log(db, aid, pm, None, xid, action, {"span_text": span, "hpo_id": hid, "patient_id": pt}, b.get("client_at"))
        db.commit()
        self.send_json({"ok": True, "added": {"added_id": xid, "patient_id": pt, "span_text": span, "hpo_id": hid,
                                              "section_id": loc[0], "cell_row": loc[1], "cell_col": loc[2], "start_offset": loc[3], "end_offset": loc[4]},
                        "terms": term_info(db, [hid])})

    def added_delete(self, db, me, pm, xid):
        aid = me["annotator_id"]
        n = db.execute("DELETE FROM added_phenotype WHERE added_id = ? AND annotator_id = ? AND pmid = ?", (xid, aid, pm)).rowcount
        if not n:
            raise ValueError("unknown added phenotype")
        self.log(db, aid, pm, None, xid, "remove_added", {}, None)
        db.commit()
        self.send_json({"ok": True})

    def review(self, db, me, pm):
        self.check_assigned(db, me, pm)
        rows = db.execute("""SELECT patient, item_id, item_kind, mention, predicted_hpo_id, predicted_label, decision,
                                    final_hpo_id, final_label, final_patient, reassigned, reassigned_outside_list
                             FROM review_table WHERE annotator_id = ? AND pmid = ?""", (me["annotator_id"], pm)).fetchall()
        asg = db.execute("SELECT submitted_at, comment FROM assignment WHERE annotator_id = ? AND pmid = ?", (me["annotator_id"], pm)).fetchone()
        a = db.execute("SELECT title, pmid FROM article WHERE pmid = ?", (pm,)).fetchone()
        order = {r["label"]: r["position"] for r in db.execute("SELECT label, position FROM patient WHERE pmid = ?", (pm,))}
        rows = sorted((dict(r) for r in rows), key=lambda r: (order.get(r["patient"], 99), r["item_kind"] != "predicted", r["item_id"]))
        self.send_json({"article": dict(a), "rows": rows, "submitted_at": asg["submitted_at"], "comment": asg["comment"]})

    def submit(self, db, me, pm):
        self.check_assigned(db, me, pm)
        b = self.body()
        left = db.execute("""SELECT COUNT(*) FROM mention m WHERE m.pmid = ? AND NOT EXISTS
                             (SELECT 1 FROM decision d WHERE d.pmid = m.pmid AND d.mention_id = m.mention_id AND d.annotator_id = ?
                              AND d.decision IS NOT NULL)""",
                          (pm, me["annotator_id"])).fetchone()[0]
        if left:
            raise ValueError(f"{left} mentions still need a decision")
        db.execute("UPDATE assignment SET submitted_at = ?, comment = ? WHERE annotator_id = ? AND pmid = ?",
                   (now(), (b.get("comment") or "").strip() or None, me["annotator_id"], pm))
        self.log(db, me["annotator_id"], pm, None, None, "submit", {}, b.get("client_at"))
        db.commit()
        self.send_json({"ok": True})

    def client_event(self, db, me, pm):
        b = self.body()
        if b.get("action") != "open":
            raise ValueError("unknown event")
        self.log(db, me["annotator_id"], pm, b.get("mention_id"), None, b["action"], {}, b.get("client_at"))
        db.commit()
        self.send_json({"ok": True})

    def hpo_search(self, db, q, limit):
        lim = 100000 if limit == "all" else max(1, min(int(limit or 30), 500))
        hits, total = search_hpo(q, lim)
        info = term_info(db, [h[2] for h in hits], full=False)
        out = []
        for _, _, hid, syn in hits:
            t = info.get(hid)
            if t:
                out.append({"id": hid, "label": t["label"], "def": t["def"], "syn": t["syn"], "matched": syn})
        self.send_json({"results": out, "total": total})

    def hpo_lineage(self, db, ids):
        """Every ancestor of the given terms (up to Phenotypic abnormality), with labels and is_a parents."""
        nodes, todo = {}, list(dict.fromkeys(ids[:200]))
        while todo:
            batch, todo = todo[:500], todo[500:]
            batch = [b for b in batch if b not in nodes]
            if not batch:
                continue
            for r in db.execute(f"SELECT hpo_id, label, parents_json FROM hpo_term WHERE hpo_id IN ({','.join('?' * len(batch))})", batch):
                ps = json.loads(r["parents_json"] or "[]")
                nodes[r["hpo_id"]] = {"label": r["label"], "parents": ps}
                todo.extend(p for p in ps if p not in nodes)
        self.send_json({"nodes": nodes})

    @staticmethod
    def log(db, aid, pm, mid, xid, action, payload, client_at=None):
        # the browser's clock is not stored: server_at is the reference time
        db.execute("INSERT INTO event(annotator_id, pmid, mention_id, added_id, action, payload_json) VALUES (?,?,?,?,?,?)",
                   (aid, pm, mid, xid, action, json.dumps(payload)))


def main():
    global DB_PATH, INFO_SHEET
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", help="folder of converted PMID_*.json files (first run only)")
    ap.add_argument("--hpo", help="hp.json of the pinned HPO release (first run only)")
    ap.add_argument("--db", default=str(HERE / "phenoeval.db"))
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--info-sheet", default="", metavar="URL",
                    help="web address of the study information sheet (otherwise information-sheet.pdf or .html in the app folder)")
    ap.add_argument("--build-only", action="store_true", help="with --data/--hpo: build the database and exit without starting the server")
    ap.add_argument("--export", metavar="CSV", help="write the answers of every annotator (review_table) to a CSV file and exit")
    a = ap.parse_args()
    DB_PATH = a.db
    INFO_SHEET = a.info_sheet.strip()
    if a.export:
        import csv
        upgrade_db()
        db = connect()
        cur = db.execute("""SELECT n.display_name AS annotator, n.email, r.* FROM review_table r
                            JOIN annotator n USING (annotator_id) ORDER BY n.email, r.pmid, r.patient, r.item_id""")
        cols = [c[0] for c in cur.description]
        with open(a.export, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(cols)
            n = 0
            for row in cur:
                w.writerow(list(row))
                n += 1
        print(f"{n} rows written to {a.export}")
        return
    if a.data or a.hpo:
        if not (a.data and a.hpo):
            sys.exit("give both --data and --hpo to build the database")
        create_db(a.data, a.hpo)
        if a.build_only:
            upgrade_db()
            return
    elif not os.path.exists(DB_PATH):
        sys.exit("no database yet: run once with --data <folder> --hpo <hp.json>")
    upgrade_db()
    db = connect()
    db.execute("PRAGMA journal_mode = WAL")
    db.close()
    print("indexing HPO for search ...", flush=True)
    build_search_index()
    srv = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"PhenoEval running: open http://{'localhost' if a.host in ('127.0.0.1', '0.0.0.0') else a.host}:{a.port}  (Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    main()
