# PhenoEval input format (v1.2)

One JSON file per article. It holds everything the annotation app needs to show the article
and its predicted patient phenotypes, and **nothing from the ground truth** (phenopackets):
annotators are blinded, and the schema rejects any field it does not know.

```
schema/article.schema.json     JSON Schema (draft 2020-12)
examples/PMID_00000001.json    a complete, valid article (the sample shown in the prototype)
examples/PMID_00000001.draft.json   the same article before offsets were filled in
tools/phenoeval_input.py       validate files; fill in offsets from a draft
tools/convert_pipeline.py      convert the pipeline output (review50 layout) into input files
tools/fetch_pubmed.py          fetch title, journal, year and DOI from PubMed
```

## Changes in 1.2

* **No code mentions.** `predicted` may be `null`: no fitting HPO term was predicted. The app
  shows these as "No HPO term predicted" (Confirm / Revise / Reject). They should carry
  `extracted_as` (the pipeline's wording); `candidates` may be empty.
* **`provenance`** (optional, never shown to annotators): `term_source` (`lookup` or `linker`),
  `lookup_id`, `linker_id`, `linker_confidence`, `no_code_reason`
  (`linker_none_of_the_above` | `linker_low_confidence`).
* Converter rule: the lookup's term is kept whenever the lookup found one; the linker decides
  only where the lookup said AUTO. Linker "None of the above" with confidence > 0.90 is left
  out, <= 0.90 becomes No code; a linker term with confidence < 0.50 becomes No code
  (`--nota-max`, `--min-confidence`). With `--hpo`, a predicted term outside Phenotypic
  abnormality (HP:0000118), e.g. an onset, inheritance or clinical-course term, is left out,
  and candidates outside that branch are not offered.

## Changes in 1.1

* **Table sections.** `kind: "table"` sections have `rows` (all cells, header rows included),
  `header_rows` (default 1) and `caption`, instead of `text`.
* **Table mentions** point to a cell, `"cell": {"row": i, "col": j}`, instead of `start`/`end`;
  their `text` is a readable form of the evidence, e.g. `Patient 1-1 · Atopic dermatitis: (+)`.
* `extracted_as` (optional): the phenotype as the pipeline worded it, when this differs from
  the highlighted text (e.g. `bilateral hypoplastic radii` from
  "bilateral hypoplastic clavicles and radii").
* `pipeline` is optional. New section kind `supplementary`.
* The same evidence may be linked to several patients or several terms; only the same
  evidence + patient + term twice is an error.

## Structure

```jsonc
{
  "schema_version": "1.2",
  "article":  { "id": "PMID:00000001", "pmid": "00000001", "title": "...", "journal": "...", "year": 2023 },
  "hpo_release": "2026-09-01",            // hp.json release used for linking (and pinned in the app)

  "sections": [                           // the text, in reading order
    { "id": "s2", "kind": "case", "title": "Patient 1", "text": "The proband, a 6-year-old girl, ..." }
  ],
  "patients": [                           // as the article names them
    { "id": "p1", "label": "Patient 1", "aliases": ["the proband"] }
  ],
  "mentions": [                           // one per predicted span
    {
      "id": "m01", "patient_id": "p1", "section_id": "s2",
      "start": 63, "end": 89, "text": "global developmental delay",
      "predicted":  { "hpo_id": "HP:0001263", "label": "Global developmental delay" },
      "candidates": [
        { "hpo_id": "HP:0001263", "label": "Global developmental delay", "rank": 1 },
        { "hpo_id": "HP:0001249", "label": "Intellectual disability",     "rank": 2 }
      ]
    }
  ]
}
```

### Field notes

| Field | Rule |
|---|---|
| `article.id` | Stable and unique across the study. Use `PMID:<n>` when there is a PMID. |
| `hpo_release` | Date of the `hp.json` the pipeline used. All files in a study should use the same release; `validate` warns otherwise. |
| `sections[].kind` | `title`, `abstract`, `case`, `section`, `table`, `figure_caption`, `other`. |
| `sections[].text` | Plain text. Separate paragraphs with a blank line (`\n\n`). |
| `patients[].label` | The identifier **exactly as written in the article** (e.g. "Patient 1", "II-3"). This is what annotators see. |
| `patients[].aliases` | Optional other names in the text. Used to recognise an identifier typed under *Someone else*. |
| `mentions[]` | One entry per span, even when several spans share an HPO term (the app groups them into one profile term with ×n). |
| `start`, `end` | Offsets **within the section text**, 0-based, end exclusive, counted in Unicode code points (Python `str` indexing). `section.text[start:end]` must equal `text`. |
| `predicted` | The pipeline's term for the span. Must also appear in `candidates`. |
| `candidates` | The linker's list, best first (`rank` 1 = best). Shown in *Revise → Candidates*. `score` is optional. |
| labels | Optional everywhere; the app takes labels, synonyms and hierarchy from the pinned HPO release. |

Not in the file, on purpose: organ systems (computed from the HPO release), and any
gold-standard or phenopacket data.

## Producing files from the pipeline

The easiest route: write a **draft** with mention `text` but without `start`/`end`, then let the
tool find the offsets.

```bash
pip install jsonschema
python tools/phenoeval_input.py locate draft.json -o data/PMID_12345678.json
```

If the same words occur more than once in a section, the tool stops and lists the matches; add
`"occurrence": n` (1 = first) to that mention. If `section_id` is left out, all sections are
searched. A match is tried case-sensitively first, then ignoring case (with a warning).

## Validating

```bash
python tools/phenoeval_input.py validate data/
python tools/phenoeval_input.py validate data/ --hpo hp.json   # also check IDs exist / are not obsolete
```

Checked: the schema (including unknown fields), unique IDs, patient and section references,
offsets matching the text, duplicate spans, predicted term among the candidates, duplicate
candidates or ranks, article IDs unique across files. Warnings: overlapping spans, patients
without mentions, whitespace around a span, mixed HPO releases, obsolete terms.

Exit code is 0 when every file is valid, so it can run in CI or before an import.

## Converting the pipeline output

```bash
python tools/fetch_pubmed.py review50/predictions_merged_llm.tsv -o pubmed.json   # needs internet
python tools/convert_pipeline.py review50/ -o data/ \
    --hpo-release 2026-09-01 --hpo hp.json --pubmed pubmed.json
```

Rules applied:

| Input | Treatment |
|---|---|
| `status = excluded` | left out (negated findings) |
| `AUTO:` terms (`grounded = no`) | left out: the linker chose *None of the above* |
| prose offsets | rebuilt from `context` + `context_start`/`context_end`; `chosen_span` is shifted and is only used to choose between repeated contexts. Fallback: the span text, nearest to `chosen_span` |
| table evidence `row \| column \| value` | matched to a cell (row label × column header, then the value within that row or column) |
| candidates | `candidates.jsonl` options joined on (pmid, section_id, original_patient_id, llm term); *None of the above* and duplicates dropped; the final term is added if missing |
| labels | official labels from `--hpo hp.json` when given |
| `gold/` | never read |

`data/conversion_report.tsv` lists every input row (by TSV line) with what happened to it and
how its evidence was located. The converter validates the output at the end.
