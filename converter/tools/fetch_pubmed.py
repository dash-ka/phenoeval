#!/usr/bin/env python3
"""
Fetch title, journal, year and DOI for a list of PMIDs from PubMed (NCBI E-utilities)
and save them as JSON, for convert_pipeline.py --pubmed.

  python tools/fetch_pubmed.py review50/predictions_merged_llm.tsv -o pubmed.json
  python tools/fetch_pubmed.py 15673476 18816383 -o pubmed.json

PMIDs are read from the arguments, or from the 'pmid' column of a TSV file.
NCBI asks for at most 3 requests per second without an API key; this script sends one
request per 200 PMIDs. Set NCBI_API_KEY in the environment to use your key.
Standard library only.
"""
import argparse
import csv
import json
import os
import sys
import time
import urllib.parse
import urllib.request

URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"


def read_pmids(args):
    pmids = []
    for a in args:
        if os.path.isfile(a):
            with open(a, encoding="utf-8", newline="") as fh:
                pmids += [r["pmid"].strip() for r in csv.DictReader(fh, delimiter="\t") if r.get("pmid")]
        else:
            pmids += [x for x in a.replace(",", " ").split() if x]
    return sorted(set(p for p in pmids if p.isdigit()), key=int)


def fetch(pmids):
    out = {}
    key = os.environ.get("NCBI_API_KEY")
    for i in range(0, len(pmids), 200):
        batch = pmids[i:i + 200]
        params = {"db": "pubmed", "retmode": "json", "id": ",".join(batch), "tool": "phenoeval"}
        if key:
            params["api_key"] = key
        req = urllib.request.Request(URL, data=urllib.parse.urlencode(params).encode(), method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            res = json.load(resp)["result"]
        for pmid in batch:
            r = res.get(pmid)
            if not r or "error" in r:
                print(f"warning: PubMed has no summary for {pmid}", file=sys.stderr)
                continue
            doi = next((x["value"] for x in r.get("articleids", []) if x.get("idtype") == "doi"), "")
            pmc = next((x["value"] for x in r.get("articleids", []) if x.get("idtype") == "pmc"), "")
            year = (r.get("pubdate") or r.get("epubdate") or "")[:4]
            out[pmid] = {
                "title": (r.get("title") or "").rstrip("."),
                "journal": r.get("fulljournalname") or r.get("source") or "",
                "year": int(year) if year.isdigit() else None,
                "doi": doi,
                "pmcid": pmc if pmc.startswith("PMC") else "",
            }
        time.sleep(0.4)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pmids", nargs="+", help="PMIDs, or a TSV file with a 'pmid' column")
    ap.add_argument("-o", "--output", default="pubmed.json")
    args = ap.parse_args()
    pmids = read_pmids(args.pmids)
    if not pmids:
        sys.exit("No PMIDs found.")
    data = fetch(pmids)
    with open(args.output, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"{len(data)} of {len(pmids)} PMIDs written to {args.output}")


if __name__ == "__main__":
    main()
