# Lessons Library Design v1 (碰过的坑 — company memory)

Owner: Harry · 2026-07-06 · Status: design locked, build in phase 2 (after `/reports` Management Reports, needs 2-3 months of issue volume + the monthly meeting ritual)

## Core decision: issues ≠ lessons

- **Issues** = raw operational events. High volume, entered in seconds on the floor, messy by nature. They stay as they are — friction-free entry is sacred.
- **Lessons** = curated knowledge entries. Low volume (target 20–50/year). Created ONLY through review, never automatically.
- **Many-to-one**: multiple issues link to one lesson. The lesson is the root-cause unit, not the incident unit. This is the answer to "two issues, same root" and to data explosion at once.

## Lesson record shape

| Field | Notes |
|---|---|
| Title | written in review, bilingual |
| Symptom | what the floor sees (with photo evidence pulled from linked issues) |
| Root cause | the disease, not the symptom |
| Solution | what actually worked, with verification evidence |
| Applies when | REQUIRED: material / mold family / machine class / conditions. A lesson without conditions is a platitude and is rejected |
| Classification | existing TrialIssueType enum + small admin-controlled tag set (material, mold family, defect class). No free-form tags |
| Linked issues | the incidents that earned this lesson (photos ride along) |
| Contributors | the claimers/fixers of linked issues, by name — citation is face and feeds the claiming culture |
| Status | active / superseded-by (versioned). New understanding UPDATES a lesson, never spawns a sibling |
| Origin | which lessons meeting approved it |

## Weekly "Hot 3" vote (v1.1, owner decision 2026-07-06 — prioritization, NOT library entry)

Inside the existing weekly board walk (~25 min total, never a second meeting):

1. The board pre-sorts the ballot: last week's new/open issues, HIGH/CRITICAL and recurrence-flagged first — the room votes on the right shortlist, not the loudest one.
2. Everyone present votes; **Marketing and QC votes count ×2** (they are the customer's proxy). Top 3 become the week's **Hot 3 (本周焦点)**.
3. **CEO may override the vote only with a logged written reason** (same rule as his prize veto).
4. Hot-3 issues must be **claimed within the week**; unclaimed after that, the relevant leader assigns. Hot issues do not rot.
5. Reward: a solved-and-verified Hot-3 fix earns **double severity points** and automatic nomination for the monthly best-fix story. Never a cash price per issue (votes must not become purchasable favors).
6. Hot-3 issues that get solved AND verified become **automatic lesson candidates** — the strongest nomination source, ranked above the code-generated flags.

Flow of volumes: ~150 voted/year → the solved+verified subset → monthly curation → still 20–50 lessons. The vote feeds the funnel; it never bypasses it.

## Curation workflow (the anti-explosion gate)

1. **Candidates are nominated by code and by the Hot-3 pipeline, not by direct entry**: solved+verified Hot-3 issues (highest rank), recurrence flags (same type + mold within 90 days), verified HIGH/CRITICAL fixes, best-fix-of-month nominees, accepted prevention proposals.
2. **Monthly lessons meeting** approves / merges / rejects. Rejecting aggressively is healthy — 40 excellent entries beat 400 mediocre ones.
3. If more than ~5 lessons pass in a month, merge harder.
4. Quarterly: superseded and never-consulted lessons reviewed (consultation is logged) — prune or rewrite.

## Where lessons surface (the real interface is the moment of need)

- **Issue creation**: form suggests matching lessons ("similar to lesson #12 — same root cause?") by issue type + keywords first; embeddings later if needed. One tap links the new issue to the lesson.
- **Trial planning**: when PM sets T0 for a new mold, lessons matching customer / material / mold family render as a pre-trial checklist on the project page.
- **Library page**: searchable, filterable by classification — the fallback interface, not the primary one.
- **Lookup logging**: every consult is recorded; "lesson #8 consulted 14 times, linked to 3 prevented issues" is the library's own KPI.

## Export & AI

- **Word export** (docx): filtered set (by tag/date/mold family) → structured document with photos, for customer audits, training, or supplier discussions.
- **AI clerk/detective integration** (matches KPI doc §10): the curated library is the high-quality corpus — AI drafts candidate lessons from linked-issue clusters for the meeting to review; AI suggests "this new issue matches lesson X"; AI never approves a lesson.

## KPI coupling

- Contributing to an approved lesson = prevention-class credit (KPI doc: prevention counts as 3 HIGH fixes — an approved lesson is the strongest form).
- A lesson consulted at issue-creation that prevents recurrence strengthens the fixer's durability stat narrative in review.

## Build notes (when scheduled)

- Schema: Lesson + LessonIssueLink + LessonTag tables; consultation log; supersede chain. No changes to TrialIssue entry flow.
- Permissions: lesson.curate (meeting roles/admin), lesson.view (all).
- Candidate-nomination job rides the nightly KPI snapshot job.
- Prompt number reserved: 10 (after 09 Management Reports).
