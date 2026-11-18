#!/usr/bin/env python3
"""
PhenoEval input files: validate them, and fill in character offsets.

  validate  Check one or more article files (or folders of them) against the
            schema and the rules the schema cannot express: references, unique
            IDs, offsets that match the text, predicted term among the
            candidates, optionally HPO IDs that exist in the pinned release.

  locate    Turn a draft (mentions with text but no offsets) into a valid file
            by finding each mention in its section. Use "occurrence": n to pick
            the n-th match when the same words appear more than once.

Examples
  python tools/phenoeval_input.py validate examples/
  python tools/phenoeval_input.py validate data/*.json --hpo hp.json
  python tools/phenoeval_input.py locate draft.json -o data/PMID_12345678.json

Requires: pip install jsonschema
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:
    import jsonschema
except ImportError:  # pragma: no cover
    sys.exit("Please install jsonschema:  pip install jsonschema")

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "article.schema.json"
HPO_ID = re.compile(r"^HP:[0-9]{7}$")


# ----------------------------------------------------------------- helpers
class Report:
    def __init__(self, name):
        self.name, self.errors, self.warnings = name, [], []

    def error(self, msg):
        self.errors.append(msg)

    def warn(self, msg):
        self.warnings.append(msg)

    def print(self):
        status = "OK" if not self.errors else "FAILED"
        print(f"{status:7} {self.name}  ({len(self.errors)} errors, {len(self.warnings)} warnings)")
        for m in self.errors:
            print(f"    error:   {m}")
        for m in self.warnings:
            print(f"    warning: {m}")


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def load_hpo(path):
    """Return {HP id: deprecated?} from an obographs hp.json."""
    data = load_json(path)
    terms = {}
    for graph in data.get("graphs", []):
        for node in graph.get("nodes", []):
            iri = node.get("id", "")
            if "/HP_" not in iri:
                continue
            hp = "HP:" + iri.rsplit("/HP_", 1)[1]
            terms[hp] = bool(node.get("meta", {}).get("deprecated", False))
    if not terms:
        sys.exit(f"No HPO terms found in {path}: is it an obographs hp.json?")
    return terms


def iter_files(paths):
    for p in map(Path, paths):
        if p.is_dir():
            yield from sorted(p.glob("*.json"))
        else:
            yield p


# ----------------------------------------------------------------- validate
def check_article(doc, rep, validator, hpo=None):
    for err in sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path)):
        where = "/".join(str(x) for x in err.absolute_path) or "(top level)"
        rep.error(f"schema: {where}: {err.message}")
    if rep.errors:
        return  # semantic checks assume the structure is right

    def unique(items, what):
        seen, ids = set(), {}
        for it in items:
            if it["id"] in seen:
                rep.error(f"duplicate {what} id '{it['id']}'")
            seen.add(it["id"])
            ids[it["id"]] = it
        return ids

    sections = unique(doc["sections"], "section")
    patients = unique(doc["patients"], "patient")
    unique(doc["mentions"], "mention")

    used_patients, spans, seen_keys = set(), {}, {}
    for m in doc["mentions"]:
        mid = m["id"]
        sec = sections.get(m["section_id"])
        if m["patient_id"] not in patients:
            rep.error(f"mention {mid}: unknown patient_id '{m['patient_id']}'")
        used_patients.add(m["patient_id"])
        if sec is None:
            rep.error(f"mention {mid}: unknown section_id '{m['section_id']}'")
            continue
        if "cell" in m:
            if sec["kind"] != "table":
                rep.error(f"mention {mid}: has a cell but section '{sec['id']}' is not a table")
                continue
            r, c = m["cell"]["row"], m["cell"]["col"]
            rows = sec["rows"]
            if r >= len(rows) or c >= len(rows[r]):
                rep.error(f"mention {mid}: cell ({r},{c}) is outside table '{sec['id']}'")
                continue
            if r < sec.get("header_rows", 1):
                rep.warn(f"mention {mid}: cell ({r},{c}) is a header cell")
            if not rows[r][c].strip():
                rep.warn(f"mention {mid}: cell ({r},{c}) is empty")
            cs, ce = m["cell"].get("start"), m["cell"].get("end")
            if cs is not None or ce is not None:
                if cs is None or ce is None or not (0 <= cs < ce <= len(rows[r][c])):
                    rep.error(f"mention {mid}: cell offsets [{cs}:{ce}] do not fit cell ({r},{c})")
            loc = ("cell", r, c, cs, ce)
        else:
            if sec["kind"] == "table":
                rep.error(f"mention {mid}: section '{sec['id']}' is a table; use cell, not start/end")
                continue
            s, e = m["start"], m["end"]
            if e <= s:
                rep.error(f"mention {mid}: end ({e}) must be greater than start ({s})")
            elif e > len(sec["text"]):
                rep.error(f"mention {mid}: end ({e}) is past the end of section '{sec['id']}' ({len(sec['text'])} characters)")
            elif sec["text"][s:e] != m["text"]:
                rep.error(f"mention {mid}: text {m['text']!r} does not match the section text at [{s}:{e}] = {sec['text'][s:e]!r}")
            if m["text"] != m["text"].strip():
                rep.warn(f"mention {mid}: text starts or ends with whitespace")
            loc = ("span", s, e)
            spans.setdefault((m["section_id"], s, e), mid)
        # the same evidence may support several patients or several terms; the same triple twice is a duplicate
        pid_ = m["predicted"]["hpo_id"] if m["predicted"] else None
        key = (m["section_id"], loc, m["patient_id"], pid_ or "nocode:" + m.get("extracted_as", ""))
        if key in seen_keys:
            rep.error(f"mention {mid}: duplicate of mention {seen_keys[key]} (same evidence, patient and term)")
        seen_keys[key] = mid

        cand_ids = [c["hpo_id"] for c in m["candidates"]]
        if len(cand_ids) != len(set(cand_ids)):
            rep.error(f"mention {mid}: duplicate candidate terms")
        if pid_ and pid_ not in cand_ids:
            rep.error(f"mention {mid}: predicted term {pid_} is not among the candidates")
        if not pid_ and not m.get("extracted_as"):
            rep.warn(f"mention {mid}: No code mention without extracted_as")
        ranks = [c["rank"] for c in m["candidates"] if "rank" in c]
        if len(ranks) != len(set(ranks)):
            rep.error(f"mention {mid}: duplicate candidate ranks")

        if hpo is not None:
            for t in ([pid_] if pid_ else []) + cand_ids:
                if t not in hpo:
                    rep.error(f"mention {mid}: {t} is not in the HPO release given with --hpo")
                elif hpo[t]:
                    rep.warn(f"mention {mid}: {t} is obsolete in the HPO release given with --hpo")

    # overlapping (not identical) spans in the same section: allowed, but worth a look
    by_section = {}
    for (sid, s, e), mid in spans.items():
        by_section.setdefault(sid, []).append((s, e, mid))
    for sid, lst in by_section.items():
        lst.sort()
        for (s1, e1, a), (s2, e2, b) in zip(lst, lst[1:]):
            if s2 < e1:
                rep.warn(f"mentions {a} and {b} overlap in section '{sid}'")

    for pid in patients:
        if pid not in used_patients:
            rep.warn(f"patient {pid} ({patients[pid]['label']}) has no predicted mentions")


def cmd_validate(args):
    schema = load_json(SCHEMA_PATH)
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    hpo = load_hpo(args.hpo) if args.hpo else None
    files = list(iter_files(args.paths))
    if not files:
        sys.exit("No .json files found.")
    failed, article_ids, releases = 0, {}, set()
    for f in files:
        rep = Report(str(f))
        try:
            doc = load_json(f)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            rep.error(f"not valid JSON: {exc}")
            doc = None
        if doc is not None:
            check_article(doc, rep, validator, hpo)
            aid = doc.get("article", {}).get("id") if isinstance(doc, dict) else None
            if aid:
                if aid in article_ids:
                    rep.error(f"article id '{aid}' is also used by {article_ids[aid]}")
                article_ids[aid] = str(f)
            if isinstance(doc, dict) and doc.get("hpo_release"):
                releases.add(doc["hpo_release"])
        rep.print()
        failed += bool(rep.errors)
    if len(releases) > 1:
        print(f"warning: files use different HPO releases: {', '.join(sorted(releases))}")
    print(f"\n{len(files) - failed} of {len(files)} files valid.")
    return 1 if failed else 0


# ----------------------------------------------------------------- locate
def locate_mention(m, sections, rep):
    """Fill start/end for a draft mention. Returns True if located."""
    text = m.get("text", "")
    if not text:
        rep.error(f"mention {m.get('id')}: no text to locate")
        return False
    targets = [sections[m["section_id"]]] if m.get("section_id") in sections else [x for x in sections.values() if "text" in x]
    hits = []
    for sec in targets:
        for match in re.finditer(re.escape(text), sec["text"]):
            hits.append((sec, match.start(), match.end()))
    if not hits:  # fall back to a case-insensitive match
        for sec in targets:
            for match in re.finditer(re.escape(text), sec["text"], flags=re.IGNORECASE):
                hits.append((sec, match.start(), match.end()))
        if hits:
            rep.warn(f"mention {m.get('id')}: matched {text!r} ignoring case")
    if not hits:
        rep.error(f"mention {m.get('id')}: {text!r} not found" + (f" in section '{m['section_id']}'" if m.get("section_id") else ""))
        return False
    occ = m.pop("occurrence", None)
    if occ is None and len(hits) > 1:
        where = ", ".join(f"{s['id']}[{a}:{b}]" for s, a, b in hits)
        rep.error(f"mention {m.get('id')}: {text!r} occurs {len(hits)} times ({where}); add \"occurrence\": n")
        return False
    if occ is not None and not 1 <= occ <= len(hits):
        rep.error(f"mention {m.get('id')}: occurrence {occ} requested but {text!r} occurs {len(hits)} times")
        return False
    sec, a, b = hits[(occ or 1) - 1]
    m["section_id"], m["start"], m["end"], m["text"] = sec["id"], a, b, sec["text"][a:b]
    return True


def cmd_locate(args):
    doc = load_json(args.draft)
    rep = Report(args.draft)
    sections = {s["id"]: s for s in doc.get("sections", [])}
    for m in doc.get("mentions", []):
        if ("start" in m and "end" in m) or "cell" in m:
            m.pop("occurrence", None)
            continue
        locate_mention(m, sections, rep)
    # keep a stable, readable key order in the output
    order = ["id", "patient_id", "section_id", "start", "end", "cell", "text", "extracted_as", "predicted", "candidates", "provenance"]
    doc["mentions"] = [{k: m[k] for k in order if k in m} | {k: v for k, v in m.items() if k not in order}
                       for m in doc.get("mentions", [])]
    if not rep.errors:
        schema = load_json(SCHEMA_PATH)
        check_article(doc, rep, jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker()))
    rep.print()
    if rep.errors:
        return 1
    out = args.output or args.draft
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print(f"written: {out}")
    return 0


# ----------------------------------------------------------------- main
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate", help="validate article files or folders")
    v.add_argument("paths", nargs="+")
    v.add_argument("--hpo", help="hp.json (obographs) of the pinned release, to check that HPO IDs exist")
    v.set_defaults(func=cmd_validate)
    lo = sub.add_parser("locate", help="fill in mention offsets from their text")
    lo.add_argument("draft")
    lo.add_argument("-o", "--output", help="output file (default: overwrite the draft)")
    lo.set_defaults(func=cmd_locate)
    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
