# Research and IQAC / accreditation

## Research projects

| Stage | Who | What happens |
|---|---|---|
| Draft | Principal investigator (any staff member with an employee record) | Title, abstract, agency, scheme, duration, team (co-investigators and members, by employee number) and a budget by head: equipment, consumables, travel, manpower, contingency, overhead. Code `RP/{YYYY}/nnnn`. |
| Under review | `research.proposal` workflow | Institutional clearance: head of department, then the Dean of Research. A return sends it back to draft for editing and resubmission. |
| Cleared for submission | — | The PI submits to the agency outside the system. |
| Running (sanctioned) | Dean of Research (`research.manage`) | Records the sanction order, the start date (the end date follows from the duration) and the sanctioned budget by head, which may differ from the proposal. |
| Spending | PI or research office | Each expense must fit in the head's remaining budget. Expenses are **append-only** (database trigger). Corrections are negative entries, which only the research office can post, and they cannot take spending below zero. |
| Completed | PI or research office | Requires an outcome summary. |

Visibility: `research.view` covers the departments in scope (HoD, Dean, Principal; Registrar and Dean of Research see everything). Team members always see their own projects.

Grant money is not posted to the general ledger yet. Institutions that route grants through the institutional account should reconcile against the utilisation report.

## Publications

- Faculty add their own publications under **My research**: type, venue, year, DOI, indexing, impact factor, the full author list as printed, and the institution's co-authors by employee number.
- DOIs are normalised (resolver prefix removed, lower case) and must be unique, so the same paper cannot be counted twice.
- The research office **verifies** publications, never their own. After verification, authors can no longer edit or delete them.
- Only verified publications count in accreditation data.

## IQAC and accreditation

| Concept | Notes |
|---|---|
| Framework | NAAC, NBA, NIRF… A tree of criteria and metrics, maintained by pasting an outline: `code \| title \| Q or N \| weight \| data source \| unit`. Re-importing updates existing codes in place, so responses keep their links. |
| Cycle | A framework for an academic year, optionally covering several years of data (5 for a NAAC SSR). Opening a cycle creates one response per leaf metric. |
| Assignment | IQAC assigns a metric, or a whole criterion by its code prefix, to a data owner, who is notified. |
| Response | Value (quantitative) and/or narrative, plus evidence (encrypted files or links). Statuses: not started → in progress → submitted → approved, or returned. |
| Review | IQAC (`iqac.manage`) approves or returns (with a note), but never a response they prepared themselves. Approved responses can be reopened with a reason. Closing a cycle freezes it. |
| Report | A printable compilation of every response in framework order: the working draft of the self-study report. |

### Platform data sources

A metric can name a **data source**. The data owner can then compute its value from the system of record instead of re-typing it. The value is stored with its inputs, definition, period and time, so reviewers can see how it was derived. Typing a different value discards the computed snapshot.

| Source | Definition |
|---|---|
| `students.enrolled` | Students with status Active |
| `faculty.fulltime` | Teaching employees (permanent, probation, contract) who are active or on leave |
| `ratio.studentTeacher` | Active students ÷ full-time teachers |
| `faculty.phdPercent` | Teachers whose qualifications include a PhD |
| `publications.count` / `publications.perFaculty` / `publications.indexed` | Verified publications in the covered years (indexed = Scopus, Web of Science, UGC-CARE) |
| `research.grants` / `research.projects` | Sanctioned amount / count of projects that started in the period |
| `results.passPercent` | Published current course results in terms starting in the period |
| `scholarships.beneficiaries` | Distinct students whose scholarship was credited in the period |

The seeded NAAC framework is a representative subset for demonstration. Load the full manual through the outline importer.

## Roles

- **Dean of Research** (`RESEARCH_DEAN`): `research.view`, `research.manage`.
- **IQAC Coordinator** (`IQAC_COORDINATOR`): `iqac.view`, `iqac.manage`.
- HoD, Dean, Principal and Registrar get `research.view` and `iqac.view`; Auditor gets `iqac.view`.
- Run `npm run rbac:sync` on existing databases.
