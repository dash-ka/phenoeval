#!/usr/bin/env python3
"""
Convert the pipeline output (one folder per article + predictions_merged_llm.tsv +
candidates.jsonl) into PhenoEval input files, one JSON per article.

  python tools/convert_pipeline.py review50/ -o data/ \
      --hpo-release 2026-09-01 --hpo hp.json --pubmed pubmed.json

What it does
  * sections: every PMID_<pmid>/<nn>_<kind>_<name>.txt becomes a section, in file order.
    Table files ("Rows are tab-separated ...") become table sections with their cells.
  * patients: the merged patient IDs, with the other names in merged_names as aliases.
  * mentions: rows with status = observed. The predicted term comes from:
      - the lookup (ontogpt_id), whenever the lookup found an HPO term: kept as is;
      - the linker (BeLink), only where the lookup said AUTO:
          "None of the above" with confidence > --nota-max (0.90)  -> left out
          "None of the above" with confidence <= --nota-max        -> No code mention
          an HPO term with confidence < --min-confidence (0.50)    -> No code mention
          an HPO term otherwise                                    -> predicted term
        A No code mention has predicted = null; the linker's low-confidence term, if any,
        stays among its candidates.
      - left out: excluded (negated) findings, and predicted terms outside Phenotypic
        abnormality (HP:0000118), e.g. onset, inheritance, clinical course (needs --hpo).
        Candidates outside that branch are not offered either.
      - prose: offsets are rebuilt from context + context_start/context_end (the
        chosen_span column is shifted and is not used). Fallback: find the span text,
        nearest to chosen_span.
      - tables: the evidence "row | column | value" is matched to a cell.
      - candidates: the reranker options from candidates.jsonl, joined on
        (pmid, section_id, original_patient_id, llm term); "None of the above" dropped.
  * the gold/ folder is never read (annotators are blinded).

Writes one <PMID>.json per article and conversion_report.tsv listing every input row and
what happened to it. Requires: pip install jsonschema (for the final validation).
"""
import argparse
import csv
import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import phenoeval_input as pin  # noqa: E402

FILE_RE = re.compile(r"^(\d+)_([a-z]+(?:_[a-z]+)?)_(.*)$")
KIND_MAP = {
    "abstract": "abstract", "case": "case", "intro": "section", "materials": "section",
    "methods": "section", "results": "section", "discussion": "section", "conclusion": "section",
    "main": "section", "other": "other", "appendix": "other", "figure": "figure_caption",
    "table": "table", "suppl_table": "table", "suppl_text": "supplementary", "suppl": "supplementary",
}
TABLE_MARK = "Rows are tab-separated"


# ------------------------------------------------------------------ text helpers
def norm(s):
    """Lower-case, unify dashes/spaces, collapse whitespace: for fuzzy cell matching."""
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub(r"[‐-―−]", "-", s)
    return re.sub(r"\s+", " ", s).strip()


def ws_index(text):
    """Whitespace-collapsed copy of text plus a map back to original indexes."""
    out, idx, prev = [], [], False
    for i, ch in enumerate(text):
        sp = ch.isspace()
        if sp and prev:
            continue
        out.append(" " if sp else ch)
        idx.append(i)
        prev = sp
    return "".join(out), idx


def collapse(s):
    return re.sub(r"\s+", " ", s)


# ------------------------------------------------------------------ sections
def kind_of(stem):
    m = FILE_RE.match(stem)
    if not m:
        return "other", stem
    raw = m.group(2)
    if raw not in KIND_MAP and "_" in raw:  # e.g. "results_results" -> "results"
        raw = raw.split("_")[0]
    return KIND_MAP.get(raw, "other"), m.group(3)


def parse_table(text):
    lines = text.split("\n")
    mark = next((i for i, l in enumerate(lines) if l.startswith(TABLE_MARK)), None)
    if mark is None:
        return None
    caption_lines = [l for l in lines[:mark] if l.strip()]
    rows = [l.split("\t") for l in lines[mark + 1:] if l.strip()]
    if not rows:
        return None
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    header = 2 if "row(s)" in lines[mark] and len(rows) > 2 and _looks_like_header(rows[1]) else 1
    return {"caption": "\n".join(caption_lines), "rows": rows, "header_rows": header}


def _looks_like_header(row):
    """Second header row: mostly non-numeric short labels and an empty first cell."""
    filled = [c for c in row if c.strip()]
    return bool(filled) and not row[0].strip() and all(not re.search(r"\d", c) for c in filled)


def load_sections(folder, titles):
    sections, by_file = [], {}
    for f in sorted(folder.glob("*.txt")):
        stem = f.stem
        text = f.read_text(encoding="utf-8")
        kind, rest = kind_of(stem)
        title = titles.get(stem) or rest.replace("-", " ").strip().capitalize()
        sec = {"id": stem, "kind": kind, "title": title}
        if kind == "table":
            t = parse_table(text)
            if t is None:
                sec["kind"] = "supplementary" if "suppl" in stem else "other"
                sec["text"] = text
            else:
                sec.update(t)
        else:
            sec["text"] = text
        if "text" in sec and not sec["text"].strip():
            continue
        sections.append(sec)
        by_file[stem] = sec
    return sections, by_file


# ------------------------------------------------------------------ locating evidence
def locate_prose(row, sec):
    text, ctx, span = sec["text"], row["context"], row["span"]
    hint = int(row["chosen_span"].split(":")[0]) if row["chosen_span"] else None
    if ctx and row["context_start"] and row["context_end"]:
        cs, ce = int(row["context_start"]), int(row["context_end"])
        hits = [m.start() for m in re.finditer(re.escape(ctx), text)]
        if hits:
            ci = min(hits, key=lambda h: abs(h + cs - hint)) if hint is not None else hits[0]
            return ci + cs, ci + ce, "context"
        # same context with different whitespace
        ntext, idx = ws_index(text)
        nctx = collapse(ctx)
        j = ntext.find(nctx)
        if j >= 0:
            # map context offsets through the collapsed context
            nc_pre = collapse(ctx[:cs])
            nc_mid = collapse(ctx[:ce])
            a, b = j + len(nc_pre), j + len(nc_mid)
            if b > a and b - 1 < len(idx):
                return idx[a], idx[b - 1] + 1, "context (whitespace)"
    # fall back to the span text itself, nearest to the (shifted) chosen_span
    for flags in (0, re.IGNORECASE):
        hits = [(m.start(), m.end()) for m in re.finditer(re.escape(span), text, flags)] if span else []
        if hits:
            a, b = min(hits, key=lambda h: abs(h[0] - hint)) if hint is not None else hits[0]
            return a, b, "span text"
    return None


def locate_cell(row, sec):
    rows, hdr = sec["rows"], sec.get("header_rows", 1)
    parts = [p.strip() for p in row["evidence"].split(" | ")] if row["evidence"] else []
    value = parts[-1] if parts else row["span"]
    rlabel = parts[0] if len(parts) >= 3 else None
    clabel = parts[1] if len(parts) >= 3 else (parts[0] if len(parts) == 2 else None)
    nv = norm(value)

    def cols_for(label):
        if not label:
            return []
        nl = norm(label)
        return [j for j in range(len(rows[0])) if any(norm(rows[h][j]) == nl for h in range(min(hdr, len(rows))))]

    def rows_for(label):
        if not label:
            return []
        nl = norm(label)
        exact = [i for i in range(hdr, len(rows)) if norm(rows[i][0]) == nl]
        return exact or [i for i in range(hdr, len(rows)) if nl and nl in norm(" ".join(rows[i][:2]))]

    cand_rows, cand_cols = rows_for(rlabel), cols_for(clabel)
    # 1. row label x column header
    # (several rows can share a label, e.g. "Other" under each organ group: take the one whose cell holds the value;
    #  an empty cell never matches)
    for i in cand_rows:
        for j in cand_cols:
            cell = norm(rows[i][j])
            if cell and (not nv or nv in cell or cell in nv):
                return i, j, "row x column"
    filled = [(i, j) for i in cand_rows for j in cand_cols if norm(rows[i][j])]
    if filled:
        return filled[0][0], filled[0][1], "row x column (value differs)"
    # 2. value within the labelled row or column
    for i in cand_rows:
        for j in range(1, len(rows[i])):
            if nv and nv in norm(rows[i][j]):
                return i, j, "value in row"
    for j in cand_cols:
        for i in range(hdr, len(rows)):
            if nv and nv in norm(rows[i][j]):
                return i, j, "value in column"
    # 3. the column label may be the row label (e.g. patient in the first column)
    if clabel:
        for i in rows_for(clabel):
            for j in range(1, len(rows[i])):
                if nv and nv in norm(rows[i][j]):
                    return i, j, "value in patient row"
    return None


STOP = {"with", "without", "and", "the", "of", "in", "on", "at", "for", "from", "to", "by", "or",
        "left", "right", "bilateral", "mild", "severe", "recurrent", "chronic", "progressive", "abnormal", "increased", "decreased"}


def span_in_cell(span, cell, label=""):
    """(start, end) of the mention inside the cell text, or None when it is the whole cell or cannot be placed.
    Tries the pipeline's span, then its wording, then its most specific word found in the cell."""
    c = cell
    for text in (span, label):
        text = (text or "").strip()
        if not text:
            continue
        if norm(text) == norm(c):
            return None
        pat = r"\s+".join(re.escape(w) for w in text.split())
        m = re.search(pat, c, re.IGNORECASE)
        if m:
            return m.start(), m.end()
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z-]{3,}", f"{span} {label}") if w.lower() not in STOP]
    for w in sorted(set(words), key=len, reverse=True):
        m = re.search(r"\b" + re.escape(w[:max(5, len(w) - 2)]) + r"\w*", c, re.IGNORECASE)  # allow plural/adjective endings
        if m:
            return m.start(), m.end()
    return None


def cell_text(row, sec, i, j, part=None):
    rows, hdr = sec["rows"], sec.get("header_rows", 1)
    col = " / ".join(x for x in (rows[h][j].strip() for h in range(min(hdr, len(rows)))) if x)
    lab = rows[i][0].strip() if j != 0 else ""
    head = " · ".join(x for x in (col, lab) if x)
    val = rows[i][j][part[0]:part[1]] if part else rows[i][j].strip()
    return f"{head}: {val}" if head else val


# ------------------------------------------------------------------ candidates
def clean_label(s):
    return re.sub(r"\s*\(aka [^)]*\)\s*$", "", s or "").strip()


def load_candidates(path):
    idx = defaultdict(list)
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            c = json.loads(line)
            idx[(c["pmid"], c["section_id"], c["patient_id"], c["llm_term"])].append(c)
    return idx


def candidate_list(c, predicted, labels, branch=None):
    out, seen = [], set()
    for _, hid, lab in c.get("options", []):
        if not hid or not str(hid).startswith("HP:") or hid in seen:
            continue
        if branch is not None and hid not in branch and hid != predicted:
            continue  # only phenotypic abnormalities are offered
        seen.add(hid)
        out.append({"hpo_id": hid, "label": labels.get(hid) or clean_label(lab), "rank": len(out) + 1})
    if predicted and predicted not in seen:  # the final term must be offered
        out.insert(0, {"hpo_id": predicted, "label": labels.get(predicted, ""), "rank": 0})
        for k, x in enumerate(out):
            x["rank"] = k + 1
    for x in out:
        if not x["label"]:
            del x["label"]
    return out


# ------------------------------------------------------------------ HPO labels
def load_hpo_labels(path):
    """Labels, obsolete IDs, and the set of terms under Phenotypic abnormality (HP:0000118)."""
    data = pin.load_json(path)
    labels, obsolete, kids = {}, set(), defaultdict(list)
    for g in data.get("graphs", []):
        for n in g.get("nodes", []):
            iri = n.get("id", "")
            if "/HP_" in iri:
                hid = "HP:" + iri.rsplit("/HP_", 1)[1]
                labels[hid] = n.get("lbl", "")
                if n.get("meta", {}).get("deprecated"):
                    obsolete.add(hid)
        for e in g.get("edges", []):
            if e.get("pred") == "is_a" and "/HP_" in e["sub"] and "/HP_" in e["obj"]:
                kids["HP:" + e["obj"].rsplit("/HP_", 1)[1]].append("HP:" + e["sub"].rsplit("/HP_", 1)[1])
    branch, todo = set(), list(kids["HP:0000118"])  # descendants only: the root itself is not a phenotype
    while todo:
        t = todo.pop()
        if t not in branch:
            branch.add(t)
            todo.extend(kids.get(t, []))
    return labels, obsolete, branch



# ------------------------------------------------------------------ which term is predicted
def decide(r, group, nota_max, min_conf, branch=None):
    """Return (action, predicted_id, provenance). action: 'term' | 'nocode' | 'drop'."""
    lookup = r["ontogpt_id"] if r["ontogpt_id"].startswith("HP:") else None
    c = group[0] if group else None
    chosen = c.get("chosen") if c else (r["linker_id"] or None)
    conf = c.get("confidence") if c else (float(r["linker_score"]) if r["linker_score"] else None)
    prov = {"term_source": "lookup" if lookup else "linker"}
    if lookup:
        prov["lookup_id"] = lookup
    else:
        prov["lookup_id"] = None
    if chosen:
        prov["linker_id"] = chosen
    if conf is not None:
        prov["linker_confidence"] = conf
    if lookup:
        if branch is not None and lookup not in branch:
            return "drop", None, dict(prov, reason="predicted term outside Phenotypic abnormality")
        return "term", lookup, prov
    if not chosen:
        if conf is None:
            return "drop", None, dict(prov, reason="linker None of the above, no confidence given")
        if conf > nota_max:
            return "drop", None, dict(prov, reason=f"linker None of the above, confidence > {nota_max}")
        prov["no_code_reason"] = "linker_none_of_the_above"
        return "nocode", None, prov
    if conf is not None and conf < min_conf:
        prov["no_code_reason"] = "linker_low_confidence"
        return "nocode", None, prov
    if branch is not None and chosen not in branch:
        return "drop", None, dict(prov, reason="predicted term outside Phenotypic abnormality")
    return "term", chosen, prov

# ------------------------------------------------------------------ main conversion
def convert(src, out, release, labels, pubmed, nota_max=0.90, min_conf=0.50, branch=None):
    preds = list(csv.DictReader(open(src / "predictions_merged_llm.tsv", encoding="utf-8", newline=""), delimiter="\t"))
    cands = load_candidates(src / "candidates.jsonl")
    out.mkdir(parents=True, exist_ok=True)
    report, totals = [], Counter()
    by_pmid = defaultdict(list)
    for i, r in enumerate(preds):
        r["_row"] = i + 2  # line number in the TSV
        by_pmid[r["pmid"]].append(r)

    for pmid, rows in sorted(by_pmid.items(), key=lambda kv: int(kv[0])):
        for r in rows:
            r["_group"] = cands.get((pmid, r["section_id"], r["original_patient_id"], r["label"]), [])
            r["_dec"] = decide(r, r["_group"], nota_max, min_conf, branch) if r["status"] == "observed" else ("drop", None, {})
        folder = src / f"PMID_{pmid}"
        titles = {r["section_id"]: r["section_title"] for r in rows if r.get("section_title")}
        sections, by_file = load_sections(folder, titles)
        order = {s["id"]: k for k, s in enumerate(sections)}

        # patients, in order of first mention
        pat_ids, patients = {}, []
        for r in sorted(rows, key=lambda r: (order.get(r["section_id"], 999), r["_row"])):
            if r["_dec"][0] == "drop":
                continue
            label = r["patient_id"]
            if label not in pat_ids:
                pat_ids[label] = f"p{len(pat_ids) + 1}"
                patients.append({"id": pat_ids[label], "label": label, "aliases": []})
            p = patients[int(pat_ids[label][1:]) - 1]
            for name in [r["original_patient_id"]] + [x.strip() for x in r["merged_names"].split(";")]:
                if name and name != label and name not in p["aliases"]:
                    p["aliases"].append(name)
        for p in patients:
            if not p["aliases"]:
                del p["aliases"]

        mentions, seen = [], {}
        for r in rows:
            def note(outcome, how=""):
                report.append({"pmid": pmid, "tsv_line": r["_row"], "section_id": r["section_id"],
                               "patient_id": r["patient_id"], "lookup_id": r["ontogpt_id"], "linker_id": r["_dec"][2].get("linker_id", ""),
                               "linker_confidence": r["_dec"][2].get("linker_confidence", ""), "span": r["span"],
                               "outcome": outcome, "how": how})
                totals[outcome] += 1

            if r["status"] != "observed":
                note("left out: excluded (negated) finding"); continue
            action, pred_id, prov = r["_dec"]
            if action == "drop":
                note("left out: " + prov.get("reason", "")); continue
            sec = by_file.get(r["section_id"])
            if sec is None:
                note("left out: section file missing"); continue
            m = {"patient_id": pat_ids[r["patient_id"]], "section_id": sec["id"]}
            if sec["kind"] == "table":
                loc = locate_cell(r, sec)
                if loc is None:
                    note("left out: table cell not found"); continue
                i, j, how = loc
                m["cell"] = {"row": i, "col": j}
                # a cell can list several phenotypes: point to the mention's own words inside the cell
                part = span_in_cell(r["span"], sec["rows"][i][j], r["label"])
                if part:
                    m["cell"]["start"], m["cell"]["end"] = part
                m["text"] = cell_text(r, sec, i, j, part)
                sort_key = (order[sec["id"]], i, j)
            else:
                loc = locate_prose(r, sec)
                if loc is None:
                    note("left out: text not found"); continue
                a, b, how = loc
                while a < b and sec["text"][a].isspace():
                    a += 1
                while b > a and sec["text"][b - 1].isspace():
                    b -= 1
                m["start"], m["end"], m["text"] = a, b, sec["text"][a:b]
                sort_key = (order[sec["id"]], a, b)
            if collapse(r["span"]).lower() != collapse(m["text"]).lower() and sec["kind"] != "table":
                m["extracted_as"] = r["label"] or r["span"]
            elif sec["kind"] == "table" and r["label"]:
                m["extracted_as"] = r["label"]
            if action == "nocode" and r["label"]:
                m["extracted_as"] = r["label"]  # shown on the card in place of a term

            key = (sec["id"], m.get("start"), m.get("end"), json.dumps(m.get("cell")), m["patient_id"], pred_id or "nocode:" + r["label"])
            if key in seen:
                note("merged: same evidence, patient and term as another row", how); continue
            seen[key] = True

            group = r["_group"]
            if pred_id:
                pred_label = labels.get(pred_id) or (r["linker_label"] if pred_id == r["linker_id"] else "")
                m["predicted"] = {"hpo_id": pred_id, **({"label": pred_label} if pred_label else {})}
            else:
                m["predicted"] = None
            # candidates: the reranker options; the predicted term (or, for No code, the linker's low-confidence term) first if missing
            must = pred_id or prov.get("linker_id")
            if group:
                m["candidates"] = candidate_list(group[0], must, labels, branch)
            elif must:
                m["candidates"] = [{"hpo_id": must, "rank": 1, **({"label": labels[must]} if labels.get(must) else {})}]
            else:
                m["candidates"] = []
            m["provenance"] = {k: v for k, v in prov.items() if v is not None}
            m["_sort"] = sort_key
            mentions.append(m)
            tag = "included" if action == "term" else "included as No code (" + prov["no_code_reason"].replace("_", " ") + ")"
            note(tag + ("" if group else " - no candidate list found") + f" [term from {prov['term_source']}]", how)

        mentions.sort(key=lambda m: m["_sort"])
        for k, m in enumerate(mentions, 1):
            del m["_sort"]
            mentions[k - 1] = {"id": f"m{k:03d}", **m}

        abstract = next((s for s in sections if s["kind"] == "abstract" and "text" in s), None)
        meta = pubmed.get(pmid, {})
        article = {"id": f"PMID:{pmid}", "pmid": pmid,
                   "title": meta.get("title") or (abstract["text"].split("\n")[0].strip() if abstract else f"PMID {pmid}")}
        for k in ("journal", "year", "doi", "pmcid"):
            if meta.get(k):
                article[k] = meta[k]
        doc = {"schema_version": "1.2", "article": article, "hpo_release": release,
               "sections": sections, "patients": patients, "mentions": mentions}
        with open(out / f"PMID_{pmid}.json", "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, indent=1)
            fh.write("\n")

    with open(out / "conversion_report.tsv", "w", encoding="utf-8", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(report[0].keys()), delimiter="\t")
        w.writeheader()
        w.writerows(report)
    return totals, len(by_pmid)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src", help="pipeline output folder (contains predictions_merged_llm.tsv)")
    ap.add_argument("-o", "--out", default="data")
    ap.add_argument("--hpo-release", required=True, help="e.g. 2026-09-01")
    ap.add_argument("--hpo", help="hp.json of that release: official labels + ID check")
    ap.add_argument("--pubmed", help="JSON from fetch_pubmed.py: title, journal, year, DOI")
    ap.add_argument("--nota-max", type=float, default=0.90,
                    help="linker 'None of the above' above this confidence: left out; at or below: No code (default 0.90)")
    ap.add_argument("--min-confidence", type=float, default=0.50,
                    help="linker term below this confidence: No code (default 0.50). Lookup terms are always kept")
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    labels, _, branch = load_hpo_labels(args.hpo) if args.hpo else ({}, set(), None)
    if branch is None:
        print("note: no --hpo file; predictions outside Phenotypic abnormality are NOT left out")
    pubmed = pin.load_json(args.pubmed) if args.pubmed else {}
    if not pubmed:
        print("note: no --pubmed file; journal and year are left out, titles come from the abstract files")
    totals, n = convert(src, out, args.hpo_release, labels, pubmed, args.nota_max, args.min_confidence, branch)
    print(f"{n} articles written to {out}/")
    for k, v in totals.most_common():
        print(f"  {v:5}  {k}")
    print("details per input row: " + str(out / "conversion_report.tsv") + "\n")
    vargs = ["validate", str(out)] + (["--hpo", args.hpo] if args.hpo else [])
    return pin.main(vargs)


if __name__ == "__main__":
    sys.exit(main())
