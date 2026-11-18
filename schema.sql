-- PhenoEval database schema (SQLite 3.35+, WAL mode)
-- Input format: phenoeval-input v1.2 (one JSON per article).
--
-- Two kinds of tables:
--   * LOADED from the converted input files, read-only during the study:
--       article, section, patient, mention, candidate
--   * WRITTEN by the app while clinicians annotate:
--       annotator, assignment, decision, added_phenotype, event
-- The gold standard (phenopackets) is never loaded here: annotators are blinded,
-- and the comparison with gold is done offline on the export.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- =====================================================================
-- LOADED (from the input files)
-- =====================================================================

CREATE TABLE article (
    pmid          TEXT PRIMARY KEY,              -- '15673476'
    title         TEXT NOT NULL,
    hpo_release   TEXT NOT NULL                  -- '2026-09-01'
);

CREATE TABLE section (
    pmid          TEXT NOT NULL REFERENCES article(pmid),
    section_id    TEXT NOT NULL,                 -- '03_case_case-presentation'
    position      INTEGER NOT NULL,              -- reading order
    kind          TEXT NOT NULL,                 -- abstract | case | section | table | figure_caption | supplementary | other
    title         TEXT,
    text          TEXT,                          -- prose sections
    table_json    TEXT,                          -- table sections: {"rows": [[...]], "header_rows": 1, "caption": "..."}
    PRIMARY KEY (pmid, section_id),
    CHECK ((kind = 'table') = (table_json IS NOT NULL))
);

CREATE TABLE patient (
    pmid          TEXT NOT NULL REFERENCES article(pmid),
    patient_id    TEXT NOT NULL,                 -- 'p1' (local to the article)
    label         TEXT NOT NULL,                 -- as the article names the patient: 'Patient 1', 'II-3'
    aliases_json  TEXT,                          -- other names the pipeline merged: ["proband"]
    position      INTEGER NOT NULL,
    PRIMARY KEY (pmid, patient_id),
    UNIQUE (pmid, label)                         -- reassignments refer to patients by label
);

CREATE TABLE mention (
    pmid              TEXT NOT NULL,
    mention_id        TEXT NOT NULL,             -- 'm024' (local to the article)
    patient_id        TEXT NOT NULL,             -- patient the pipeline assigned
    section_id        TEXT NOT NULL,
    start_offset      INTEGER,                   -- prose: [start, end) in section.text
    end_offset        INTEGER,
    cell_row          INTEGER,                   -- tables: the evidence cell
    cell_col          INTEGER,
    cell_start        INTEGER,                   -- tables: the mention's words inside the cell; NULL = whole cell
    cell_end          INTEGER,
    text              TEXT NOT NULL,             -- the highlighted text
    extracted_as      TEXT,                      -- the pipeline's wording (shown for No code mentions)
    predicted_hpo_id  TEXT,                      -- NULL = No code mention
    -- provenance (for the analysis; never sent to the browser)
    term_source       TEXT NOT NULL CHECK (term_source IN ('lookup', 'linker')),
    lookup_hpo_id     TEXT,
    linker_hpo_id     TEXT,                      -- NULL = linker said 'None of the above'
    linker_confidence REAL,
    no_code_reason    TEXT CHECK (no_code_reason IN ('linker_none_of_the_above', 'linker_low_confidence')),
    PRIMARY KEY (pmid, mention_id),
    FOREIGN KEY (pmid, patient_id) REFERENCES patient(pmid, patient_id),
    FOREIGN KEY (pmid, section_id) REFERENCES section(pmid, section_id),
    CHECK ((start_offset IS NOT NULL AND end_offset IS NOT NULL AND cell_row IS NULL)
        OR (start_offset IS NULL AND end_offset IS NULL AND cell_row IS NOT NULL AND cell_col IS NOT NULL)),
    CHECK ((predicted_hpo_id IS NULL) = (no_code_reason IS NOT NULL))
);
CREATE INDEX mention_by_patient ON mention (pmid, patient_id);

CREATE TABLE candidate (
    pmid          TEXT NOT NULL,
    mention_id    TEXT NOT NULL,
    rank          INTEGER NOT NULL,              -- 1 = best
    hpo_id        TEXT NOT NULL,
    PRIMARY KEY (pmid, mention_id, rank),
    UNIQUE (pmid, mention_id, hpo_id),
    FOREIGN KEY (pmid, mention_id) REFERENCES mention(pmid, mention_id)
);

-- HPO labels of the pinned release, for display and export (loaded from hp.json)
CREATE TABLE hpo_term (
    hpo_id        TEXT PRIMARY KEY,
    label         TEXT NOT NULL,
    obsolete      INTEGER NOT NULL DEFAULT 0,
    definition    TEXT,
    synonyms_json TEXT,                          -- ["...", ...]
    parents_json  TEXT,                          -- is_a parents: ["HP:...", ...]
    systems_json  TEXT                           -- organ systems (children of HP:0000118) the term falls under
);

-- =====================================================================
-- WRITTEN BY THE APP
-- =====================================================================

CREATE TABLE annotator (
    annotator_id  INTEGER PRIMARY KEY,
    display_name  TEXT NOT NULL,                 -- 'Dr. M. Rossi'
    email         TEXT NOT NULL UNIQUE,
    consent_at    TEXT,                          -- welcome page: when the consent box was ticked; NULL = not yet
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Sign-in sessions (cookie token).
CREATE TABLE session (
    token         TEXT PRIMARY KEY,
    annotator_id  INTEGER NOT NULL REFERENCES annotator(annotator_id)
);

-- One article given to one annotator (page 4). Every annotator gets the same set.
CREATE TABLE assignment (
    annotator_id  INTEGER NOT NULL REFERENCES annotator(annotator_id),
    pmid          TEXT NOT NULL REFERENCES article(pmid),
    position      INTEGER NOT NULL,              -- order on the dashboard
    started_at    TEXT,
    submitted_at  TEXT,                          -- page 6 'Submit'; NULL = not submitted
    comment       TEXT,                          -- 'Anything about this article overall?'
    PRIMARY KEY (annotator_id, pmid)
);

-- The current answer of one annotator on one predicted mention (page 5).
-- No row, or decision NULL (only a patient reassignment so far) = still to review.
CREATE TABLE decision (
    annotator_id      INTEGER NOT NULL,
    pmid              TEXT NOT NULL,
    mention_id        TEXT NOT NULL,
    decision          TEXT CHECK (decision IN ('accept', 'revise', 'no_code', 'reject')),
    final_hpo_id      TEXT,                      -- accept: the predicted term; revise: the chosen term; else NULL
    revise_via        TEXT CHECK (revise_via IN ('candidate', 'search')),
    -- patient check: NULL = the pipeline's patient is right. Otherwise the patient's identifier
    -- as the article writes it: the label of a listed patient ('Patient 2'), or what the clinician
    -- typed under 'Someone else' ('mother'). Whether it is outside the list is derived (see the view).
    reassigned_to     TEXT,
    decided_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (annotator_id, pmid, mention_id),
    FOREIGN KEY (annotator_id, pmid) REFERENCES assignment(annotator_id, pmid),
    FOREIGN KEY (pmid, mention_id) REFERENCES mention(pmid, mention_id),
    CHECK (COALESCE(decision IN ('accept', 'revise'), 0) = (final_hpo_id IS NOT NULL)),
    CHECK (COALESCE(decision = 'revise', 0) = (revise_via IS NOT NULL)),
    CHECK (decision IS NOT NULL OR reassigned_to IS NOT NULL),
    CHECK (decision <> 'reject' OR reassigned_to IS NULL)  -- a rejected mention has no patient
);

-- Phenotypes the clinician added (page 5, 'Add a missed phenotype').
-- 'Remove' deletes the row; the event log still records that it was added and removed.
CREATE TABLE added_phenotype (
    added_id      INTEGER PRIMARY KEY,
    annotator_id  INTEGER NOT NULL,
    pmid          TEXT NOT NULL,
    patient_id    TEXT NOT NULL,
    span_text     TEXT NOT NULL,                 -- the selected text, read from the article at the selected place
    section_id    TEXT,                          -- where the clinician selected it (selection only, no typing):
    cell_row      INTEGER,                       --   tables: the cell; NULL for prose
    cell_col      INTEGER,
    start_offset  INTEGER,                       --   [start, end) in section.text, or in the cell's text
    end_offset    INTEGER,
    hpo_id        TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT,
    FOREIGN KEY (annotator_id, pmid) REFERENCES assignment(annotator_id, pmid),
    FOREIGN KEY (pmid, patient_id) REFERENCES patient(pmid, patient_id)
);

-- Every click, append-only (never updated or deleted): time on task, changes of mind, audit.
CREATE TABLE event (
    event_id      INTEGER PRIMARY KEY,
    annotator_id  INTEGER NOT NULL REFERENCES annotator(annotator_id),
    pmid          TEXT NOT NULL,
    mention_id    TEXT,                          -- NULL for article-level events
    added_id      INTEGER,
    action        TEXT NOT NULL,                 -- open | accept | revise | no_code | reject | clear | reassign (also its undo) |
                                                 -- add | edit_added | remove_added | submit
    payload_json  TEXT,                          -- e.g. {"hpo_id": "...", "via": "search"}
    server_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX event_by_item ON event (annotator_id, pmid, mention_id);

CREATE TRIGGER event_append_only_u BEFORE UPDATE ON event BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;
CREATE TRIGGER event_append_only_d BEFORE DELETE ON event BEGIN SELECT RAISE(ABORT, 'event is append-only'); END;

-- =====================================================================
-- VIEW: the page 6 table (one row per mention or added phenotype, per annotator).
-- Page 6 reads it for one annotator and one article; the export writes it whole.
-- =====================================================================

CREATE VIEW review_table AS
SELECT
    a.annotator_id,
    m.pmid,
    p.label                                         AS patient,           -- the pipeline's patient (row group on page 6)
    m.mention_id                                    AS item_id,
    'predicted'                                     AS item_kind,
    m.text                                          AS mention,
    m.predicted_hpo_id                              AS predicted_hpo_id,   -- NULL shown as '—'
    tp.label                                        AS predicted_label,
    COALESCE(d.decision, 'to_review')               AS decision,
    d.final_hpo_id,
    tf.label                                        AS final_label,
    d.revise_via,
    COALESCE(d.reassigned_to, p.label)              AS final_patient,
    CASE WHEN d.reassigned_to IS NOT NULL THEN 1 ELSE 0 END AS reassigned,
    CASE WHEN d.reassigned_to IS NOT NULL AND rp.patient_id IS NULL THEN 1 ELSE 0 END AS reassigned_outside_list,
    -- analysis-only columns (not shown on page 6)
    m.term_source, m.lookup_hpo_id, m.linker_hpo_id, m.linker_confidence, m.no_code_reason,
    d.decided_at
FROM assignment a
JOIN mention m        ON m.pmid = a.pmid
JOIN patient p        ON p.pmid = m.pmid AND p.patient_id = m.patient_id
LEFT JOIN decision d  ON d.annotator_id = a.annotator_id AND d.pmid = m.pmid AND d.mention_id = m.mention_id
LEFT JOIN patient rp  ON rp.pmid = d.pmid AND rp.label = d.reassigned_to
LEFT JOIN hpo_term tp ON tp.hpo_id = m.predicted_hpo_id
LEFT JOIN hpo_term tf ON tf.hpo_id = d.final_hpo_id

UNION ALL

SELECT
    x.annotator_id,
    x.pmid,
    p.label,
    'add' || x.added_id,
    'added',
    x.span_text,
    NULL, NULL,                                     -- no prediction
    'added',
    x.hpo_id,
    t.label,
    NULL,
    p.label,
    0, 0,
    NULL, NULL, NULL, NULL, NULL,
    COALESCE(x.updated_at, x.created_at)
FROM added_phenotype x
JOIN patient p        ON p.pmid = x.pmid AND p.patient_id = x.patient_id
LEFT JOIN hpo_term t  ON t.hpo_id = x.hpo_id;
