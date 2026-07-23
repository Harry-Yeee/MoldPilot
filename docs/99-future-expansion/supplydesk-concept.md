# SupplyDesk Concept Baseline

**Status:** Confirmed future subsystem concept
**Decision date:** 2026-07-17
**Active MoldPilot Phase 1 scope:** No

## Product Decision

- The purchasing collaboration system is named **SupplyDesk**.
- SupplyDesk should begin as a separate bounded subsystem so its purchasing workflow,
  supplier portal, and data model can be tested without destabilizing MoldPilot.
- A future ERP shell may provide shared navigation and SSO, but SupplyDesk should keep
  clear ownership of purchasing data and an isolated external-supplier access boundary.
- This document supersedes earlier future-expansion assumptions that purchasing would
  only track manually entered post-PO status.

## Purpose

SupplyDesk provides one traceable workflow from an internal purchase request through
competitive quotation, award, supplier progress, receipt, inspection, discrepancy
resolution, and accepted closure. It should remove scattered quote files and informal
follow-up while preserving the evidence behind every purchasing decision.

## Operating Roles

| Role | Main responsibility |
| --- | --- |
| Requester / Engineering | Defines what is needed, the correct revision, quantity, required date, and technical evidence. |
| Purchasing | Owns RFQ preparation, supplier invitations, clarification, comparison, nomination, orders, and discrepancy follow-up. |
| Supplier | Sees only its own invitations, submits structured quotes and attachments, acknowledges orders, and updates progress. |
| Approver / GM | Approves awards and any justified non-lowest selection according to future approval thresholds. |
| Receiving / Warehouse | Records actual receipts, quantities, dates, packing evidence, shortages, damage, and wrong-item discrepancies. |
| QC / Requester | Inspects the received item against the requested specification and revision, then accepts or rejects it. |
| System / Admin | Enforces permissions, versioning, isolation, stage gates, alerts, and activity history. |

## Six-Stage Workflow

### 1. Purchase Request

1. Requester creates structured line items with project, item or drawing number,
   revision, quantity, unit, required date, specifications, and attachments.
2. Purchasing checks completeness and returns incomplete requests for correction.
3. The system versions the request package and records who submitted and approved it.

**Exit gate:** The request is complete and ready for supplier invitation.

### 2. RFQ Release

1. Purchasing selects qualified suppliers and sets the quote deadline, currency,
   tax, freight, delivery, and other commercial requirements.
2. Each supplier receives a private invitation and can accept or decline with a reason.
3. The system prevents one supplier from seeing another supplier, quote, ranking,
   target price, communication, or attachment.

**Exit gate:** The RFQ is released, supplier access is active, and the deadline is set.

### 3. Supplier Quotation

1. Suppliers enter structured values for each line: unit price, MOQ, lead time,
   currency, tax, freight, payment terms, validity, and notes; a quote file may also
   be attached as evidence.
2. A revised submission creates a new immutable `QuoteVersion`; it never overwrites
   the earlier submission.
3. Purchasing manages clarifications and any deadline change with a recorded reason.

**Exit gate:** The deadline has passed or Purchasing closes quotation, and submitted
versions are frozen for comparison.

### 4. Compare and Award

1. The system normalizes comparable totals and shows cost history and the lowest
   candidate for each line.
2. Purchasing evaluates price together with lead time, quality history, MOQ, freight,
   tax, payment terms, and risk, then nominates suppliers line by line. Split awards
   are allowed.
3. Approver / GM approves or returns the nomination. Selecting a non-lowest quote
   requires a reason.
4. The system snapshots the winning quote version and approval evidence.

**Exit gate:** Award decisions are approved and locked to exact quote versions.

### 5. Order and Progress

1. Purchasing creates the supplier order or PO from approved award lines and confirms
   quantity, price, required date, and promised date.
2. Supplier accepts the order or rejects it with a reason, then reports `In Progress`,
   `Shipped`, ETA, tracking, delays, and supporting files.
3. The system alerts on missing acknowledgement, overdue milestones, and promised-date
   changes while keeping a complete activity log.

**Exit gate:** Ordered goods arrive and are handed to Receiving; arrival alone does
not close the order.

### 6. Receive, Inspect, and Close

1. Receiving records actual quantities, receipt date, packing evidence, and any
   shortage, damage, or wrong-item discrepancy.
2. QC or the requester checks the correct revision and specification, then records
   `Accepted`, `Rejected`, or `Conditional` with evidence.
3. Purchasing resolves returns, replacement, rework, credit, or remaining quantity.
4. The system closes an order only when all expected quantities are accepted and no
   open discrepancy remains, then updates actual cost and supplier history.

**Exit gate:** All award lines are accepted, discrepancies are resolved, and dashboard
history is refreshed.

## Non-Negotiable Rules

1. Quote attachments are evidence; structured quote-line values drive comparison,
   reporting, and cost history.
2. Quote revisions are immutable and attributed to the submitting user and time.
3. Lowest price is a candidate, not an automatic award.
4. Non-lowest awards require a recorded reason and approval.
5. The awarded quote version is snapshotted so later supplier revisions cannot change
   the approved commercial basis.
6. Suppliers never see competitor identities, submissions, rankings, target prices,
   internal notes, or files.
7. `Received` is not `Closed`; closure requires accepted quantity and no open discrepancy.
8. Material actions and overrides create an activity-log entry.

## Core Records

`Supplier`, `SupplierContact`, `PurchaseRequest`, `PurchaseRequestLine`, `RFQ`,
`RFQLine`, `RFQInvitation`, `Quote`, `QuoteVersion`, `QuoteLine`, `AwardDecision`,
`SupplierOrder`, `SupplierOrderLine`, `ProgressUpdate`, `Receipt`, `Inspection`,
`Discrepancy`, `Attachment`, and `ActivityLog`.

## Management Dashboard Baseline

- Open requests and RFQs, response rate, and quotations approaching deadline
- Awarded, open, overdue, shipped, partially received, and inspection-blocked orders
- Spend by month, supplier, category, project, and requester
- Quote comparison, price variance, and item-level historical cost
- On-time acknowledgement, promised-date changes, and delivery performance
- Rejection, discrepancy, replacement, and accepted-closure rates
- Non-lowest awards and their recorded reasons

## Decisions Still Required Before Coding

- First pilot category and whether all purchases or only project-critical purchases enter SupplyDesk
- Supplier self-service in the first pilot versus Purchasing-assisted quote entry first
- Award-approval thresholds and delegation rules
- Base currency, exchange-rate source, tax treatment, and landed-cost formula
- Whether invoice matching and payment status belong in SupplyDesk or a later finance module
- Supplier performance score formula and visibility
- Exact data shared back to MoldPilot projects

## Training Artifact

The bilingual responsibility poster is maintained at:

```text
docs/07-training/supplydesk-roles-poster.html
docs/07-training/supplydesk-roles-poster.pdf
docs/07-training/supplydesk-roles-poster.png
```
