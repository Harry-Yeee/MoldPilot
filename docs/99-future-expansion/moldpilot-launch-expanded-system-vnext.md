Yes — based on your updated structure, the MVP should be redefined quite a bit.

The project is **not** a full ERP, not a sales CRM, and not an RFQ tracker.

It should be:

# **MoldPilot Launch**

A **PO-to-production project execution system** for tooling projects.

Its main purpose is:

> **Reduce rework, reduce unnecessary tool trials, make daily responsibilities visible, and give sales/marketing a clean way to answer customer questions without constantly chasing everyone.**

The system should start when the project is real:

> **PO confirmed → DFM / Mold Flow → mold design → steel order → machining → fitting → T0 → correction → T1 → correction → T2 → sample approval → shipment / production.**

No RFQ tracking in the MVP.

No customer names in the project system.

No full sales pipeline.

No full ERP.

No customer portal yet.

---

# 1. Updated MVP positioning

The old idea was:

> RFQ-to-production Mold Project OS

The better version is:

> **MoldPilot Launch: internal tooling project control tower from PO confirmation to sample approval / production launch.**

This is much sharper.

It focuses on your real pain:

1. Reducing tool-trial rework.
2. Making daily tasks visible.
3. Making each department know what they are responsible for.
4. Helping marketing answer customers without interrupting the whole factory.
5. Giving GM and PMs a clear project health dashboard.
6. Creating useful KPI data for coaching, improvement, reward, and eventually discipline.

---

# 2. MVP users and roles

You do not need many complicated user types. But almost every key person should have a login, because the whole point is task visibility and accountability.

## Core users

| User / Role                |    Count | Main purpose in the system                                                                                     |
| -------------------------- | -------: | -------------------------------------------------------------------------------------------------------------- |
| **GM**                     |        1 | View all projects, bottlenecks, delays, KPIs, risks                                                            |
| **Planning PM**            |        1 | Main project owner; sets timeline; assigns daily tasks; coordinates machining, assembly, injection, purchasing |
| **Technical PM**           |        1 | Owns technical review, DFM/DFA, Mold Flow, design changes, trial root-cause support                            |
| **PM Assistant**           |        1 | Maintains timeline data, follows up missing updates, keeps project records clean                               |
| **Marketing / Sales**      |        5 | Customer communication channel; submits customer questions; views approved status updates                      |
| **QC**                     |        1 | Uploads inspection results, sample reports, dimensional issues, approval status                                |
| **Injection Manager**      |        1 | Updates trial status, T0/T1/T2 results, molding process issues                                                 |
| **Assembly Leaders**       | 2 groups | Updates fitting, assembly, correction progress                                                                 |
| **Machining Leaders**      | 2 groups | Updates CNC/EDM progress, day/night shift handoff                                                              |
| **Purchasing — Tooling**   |        1 | Tracks steel, mold base, hot runner, outsourced tooling components                                             |
| **Purchasing — Injection** |        1 | Tracks resin/materials, injection-related purchased items, can cross-support tooling purchasing                |

## Later users

| Later user                | Why not MVP                                            |
| ------------------------- | ------------------------------------------------------ |
| Suppliers                 | PM/Purchasing can manually enter supplier status first |
| Customers                 | Customer portal adds privacy and communication risk    |
| Individual operators      | Group leader login is enough at the beginning          |
| Full sales team CRM users | Sales pipeline is separate from this MVP               |

---

# 3. Role design: who owns what

This is the most important change.

The system should reflect your real company structure.

## Planning PM = project execution owner

The Planning PM owns:

* project timeline
* daily and weekly plan
* task assignment
* T0/T1/T2 scheduling
* machining task coordination
* assembly task coordination
* injection trial coordination
* purchasing follow-up
* project delivery status
* escalation to GM

In the system, the Planning PM should be the main person who controls the project timeline.

## Technical PM = technical authority

The Technical PM owns:

* DFM review
* DFA review
* Mold Flow review, when needed
* mold design technical review
* customer design-change support
* trial defect analysis
* root-cause review
* corrective-action approval
* technical lessons learned

The Technical PM should not be treated as the person chasing every daily task. Their value is technical judgment.

## Marketing / Sales = communication channel, not project owner

Sales should not be expected to know every project detail.

Their role should be:

* submit customer questions into the system
* view approved project status
* get PM-approved answers
* send customer replies
* translate or polish communication when needed
* avoid directly pushing machining, assembly, QC, or injection every day

This is very important. The software should reduce random chasing.

A customer asks:

> “When can we receive T1 samples?”

Sales should not need to message five people.

They should open MoldPilot Launch and see:

> Project is in T0 correction. Current target T1 date: March 28. Main open blocker: EDM insert correction, due March 25. Latest approved update: “T1 samples are expected after correction and confirmation trial.”

If more detail is needed, Sales submits a **Customer Query Request** to the Planning PM.

---

# 4. Customer privacy rule

This should be built into the MVP from the beginning.

## Rule

> **MoldPilot Launch should not store full customer names, customer contacts, or sensitive client identity information.**

Instead, it should use:

* customer abbreviation
* customer code
* project code
* part code
* internal PO/project reference

Example:

| Field                        | Allowed in MoldPilot Launch          |
| ---------------------------- | ------------------------------------ |
| Customer name                | No                                   |
| Customer contact person      | No                                   |
| Customer email / phone       | No                                   |
| Customer code                | Yes                                  |
| Project code                 | Yes                                  |
| Part alias                   | Yes                                  |
| PO date                      | Yes                                  |
| PO value                     | Probably no for MVP                  |
| Technical files              | Yes, but access-controlled           |
| Drawings with customer names | Restricted / sanitized when possible |

The marketing team can keep the real customer mapping separately.

For example:

| MoldPilot field | Example     |
| --------------- | ----------- |
| Customer Code   | C-027       |
| Project Code    | MP-2026-014 |
| Part Code       | P-014-A     |
| Mold Code       | M-014-01    |

Marketing can maintain the real-world mapping outside the MVP:

> C-027 = actual customer name

That way, screenshots, dashboards, and internal task boards do not leak customer names.

---

# 5. Updated MVP workflow

The workflow should begin only after PO is confirmed.

## Standard workflow

| Stage                                      | Owner                                       | Notes                                   |
| ------------------------------------------ | ------------------------------------------- | --------------------------------------- |
| **1. PO Confirmed / Project Launch**       | Planning PM + Marketing                     | Project officially starts               |
| **2. DFM / DFA Review**                    | Technical PM                                | Required for most projects              |
| **3. Mold Flow Review**                    | Technical PM                                | Optional, only when needed              |
| **4. Mold Design**                         | Technical PM / Design side                  | Some customers need design confirmation |
| **5. Customer Mold Design Confirmation**   | Marketing + Planning PM                     | Optional gate                           |
| **6. Steel / Mold Base / Component Order** | Purchasing                                  | Tooling purchaser updates status        |
| **7. CNC / EDM Machining**                 | Machining leaders                           | Day/night shift updates                 |
| **8. Fitting / Assembly**                  | Assembly leaders                            | Assembly progress and blockers          |
| **9. T0 Readiness Check**                  | Planning PM + Technical PM + Injection + QC | Critical anti-rework gate               |
| **10. T0 Trial**                           | Injection Manager + QC                      | Trial result recorded                   |
| **11. T0 Issue Review**                    | Technical PM + Planning PM                  | Root cause and correction plan          |
| **12. Correction Work**                    | Planning PM assigns to machining/assembly   |                                         |
| **13. T1 Trial**                           | Injection Manager + QC                      | Verify correction                       |
| **14. T1 Issue Review / Correction**       | Technical PM + Planning PM                  | Repeat if needed                        |
| **15. T2 Trial**                           | Injection Manager + QC                      | Optional; should not be automatic       |
| **16. Sample Approval**                    | QC + Marketing                              | Customer-facing approval process        |
| **17. Shipment / Production Handoff**      | Planning PM + Injection / Logistics         | Final handoff                           |
| **18. Project Close / Lessons Learned**    | Planning PM + Technical PM + GM             | Capture learning                        |

The important idea:

> **T2 should not be treated as normal. The system should help you avoid needing T2 whenever possible.**

---

# 6. Core MVP modules

I would build the MVP around eight modules.

## Module 1: Project Command Center

This is the main project list.

It should show all active projects, but only with customer abbreviations.

Example:

| Project Code | Customer Code | Current Stage | Health   | Next Gate       | Due Date | Planning PM | Open Issues | Overdue | Last Update |
| ------------ | ------------- | ------------- | -------- | --------------- | -------: | ----------- | ----------: | ------: | ----------- |
| MP-2026-014  | C-027         | T0 Correction | At Risk  | T1 Trial        |   Mar 28 | Planning PM |          11 |       3 | Today       |
| MP-2026-015  | C-011         | Mold Design   | On Track | Design Approval |   Mar 22 | Planning PM |           4 |       0 | Yesterday   |
| MP-2026-016  | C-039         | CNC / EDM     | Late     | Fitting Start   |   Mar 25 | Planning PM |           8 |       2 | 2 days ago  |

This page should answer:

* Which projects are active?
* Which are late?
* Which are at risk?
* What is the next milestone?
* Who is responsible?
* What needs management attention?

---

## Module 2: Project Detail Page

Each project needs one central page.

Tabs:

| Tab                  | Purpose                                                         |
| -------------------- | --------------------------------------------------------------- |
| **Overview**         | Project code, part code, mold code, PO date, target dates       |
| **Timeline**         | Planned vs actual project gates                                 |
| **Tasks**            | Daily/weekly tasks by department                                |
| **Issues**           | DFM, design, trial, QC, machining, assembly issues              |
| **Trials**           | T0/T1/T2 reports and correction loops                           |
| **Purchasing**       | Steel, mold base, components, outsourced parts                  |
| **Customer Queries** | Questions from sales/marketing and approved replies             |
| **Files**            | DFM reports, Mold Flow, design files, trial reports, QC reports |
| **Lessons Learned**  | Rework causes and prevention notes                              |

This becomes the single source of truth after PO confirmation.

---

## Module 3: Timeline / Stage Gate Tracker

Each project should have planned and actual dates.

Example:

| Gate                 | Planned Date | Actual Date | Owner                   | Status      |
| -------------------- | -----------: | ----------: | ----------------------- | ----------- |
| PO Confirmed         |        Mar 1 |       Mar 1 | Marketing / Planning PM | Done        |
| DFM Complete         |        Mar 5 |       Mar 6 | Technical PM            | Late        |
| Mold Design Complete |       Mar 12 |           — | Technical PM            | In Progress |
| Steel Ordered        |        Mar 8 |       Mar 8 | Purchasing              | Done        |
| CNC Start            |       Mar 15 |           — | Machining Leader        | Not Started |
| Fitting Start        |       Mar 22 |           — | Assembly Leader         | Not Started |
| T0 Trial             |        Apr 1 |           — | Injection Manager       | At Risk     |
| T1 Trial             |       Apr 10 |           — | Injection Manager       | Not Started |
| Sample Approval      |       Apr 18 |           — | QC / Marketing          | Not Started |

The timeline should support optional gates:

* Mold Flow required? Yes / No
* Customer design confirmation required? Yes / No
* T2 required? Yes / No
* Shipment required? Yes / No
* Production handoff required? Yes / No

---

## Module 4: Daily Task Board

This is one of the most important MVP features.

The system should show daily tasks by person or group.

Example:

| Task                   | Project     | Department            | Owner              |      Due | Status         | Blocker           |
| ---------------------- | ----------- | --------------------- | ------------------ | -------: | -------------- | ----------------- |
| Finish cavity EDM      | MP-2026-014 | Machining Night Shift | Machining Leader N |    Today | In Progress    | None              |
| Polish core insert     | MP-2026-014 | Assembly Group 1      | Assembly Leader 1  | Tomorrow | Not Started    | Waiting EDM       |
| Confirm cooling change | MP-2026-014 | Technical             | Technical PM       |    Today | Waiting Review | Needs trial photo |
| Order H13 steel        | MP-2026-015 | Purchasing            | Tooling Purchaser  |    Today | Done           | None              |
| Upload T0 report       | MP-2026-013 | QC                    | QC                 |    Today | Not Started    | Waiting sample    |

This solves your “marketing keeps pushing everyone” problem.

Every department leader should know:

* what they need to do today
* what is due this week
* what is overdue
* what is blocked
* what depends on them

Tasks can be assigned to:

* individual person
* department leader
* group
* shift

For machining and assembly, I would assign tasks to the **group leader**, not every worker.

---

## Module 5: Trial and Rework Control

This should be the heart of the MVP because your business goal is to reduce rework.

The system should treat every trial as a learning and correction loop.

## T0/T1/T2 trial record

Each trial should record:

| Field             | Example                        |
| ----------------- | ------------------------------ |
| Trial             | T0                             |
| Trial date        | Apr 1                          |
| Machine           | IMM-03                         |
| Material          | ABS                            |
| Mold status       | First trial                    |
| Sample quantity   | 30                             |
| Trial result      | Not approved                   |
| Main issues       | Sink mark, flash, short shot   |
| Next action       | Modify cooling, adjust venting |
| Next target trial | T1 Apr 10                      |

## Trial issue record

Each trial issue should have:

| Field             | Example                                |
| ----------------- | -------------------------------------- |
| Issue title       | Sink mark near boss                    |
| Found at          | T0                                     |
| Severity          | High                                   |
| Issue type        | Appearance / tooling / process         |
| Root cause        | Rib too thick, cooling insufficient    |
| Corrective action | Modify rib / add cooling / adjust gate |
| Owner             | Technical PM / Assembly Leader         |
| Due date          | Apr 5                                  |
| Verification      | Check at T1                            |
| Status            | Open / In Progress / Verified / Closed |

Critical rule:

> A trial issue cannot be closed unless it has a corrective action and verification result.

That prevents fake closure.

---

## Module 6: T0 Readiness Checklist

This is one of the best features for reducing unnecessary trials.

Before T0, the system should force a readiness check.

Example T0 readiness checklist:

| Checklist Item                            | Owner                                   | Status              |
| ----------------------------------------- | --------------------------------------- | ------------------- |
| DFM closed                                | Technical PM                            | Done                |
| Mold Flow completed, if required          | Technical PM                            | Done / Not Required |
| Mold design approved                      | Technical PM                            | Done                |
| Customer design confirmation, if required | Marketing / PM                          | Done / Not Required |
| Steel received                            | Purchasing                              | Done                |
| CNC complete                              | Machining Leader                        | Done                |
| EDM complete                              | Machining Leader                        | Done                |
| Fitting complete                          | Assembly Leader                         | Done                |
| Cooling checked                           | Assembly Leader / Technical PM          | Done                |
| Ejection checked                          | Assembly Leader / Technical PM          | Done                |
| Venting checked                           | Technical PM                            | Done                |
| Trial machine arranged                    | Injection Manager                       | Done                |
| Material ready                            | Injection Purchaser / Injection Manager | Done                |
| QC inspection plan ready                  | QC                                      | Done                |
| Sample quantity confirmed                 | Planning PM                             | Done                |

T0 should have a status:

* Ready
* Not ready
* Ready with risk
* Overridden by GM / Planning PM

Sometimes business reality means you trial even when not everything is perfect. That is okay, but the system should record the risk.

Example:

> T0 launched with risk because customer urgently requested samples before texture confirmation.

That becomes useful later when reviewing rework.

---

## Module 7: Purchasing and Outsourcing Tracker

This should be in the MVP because steel and outsourced parts can delay everything.

The purchasing tracker does not need to be a full purchasing ERP.

It only needs project-critical status.

Example:

| Item                | Project     | Type               | Owner               | Status      | Ordered Date |    ETA | Received Date | Blocker                 |
| ------------------- | ----------- | ------------------ | ------------------- | ----------- | -----------: | -----: | ------------: | ----------------------- |
| H13 steel           | MP-2026-014 | Steel              | Tooling Purchaser   | Ordered     |        Mar 3 |  Mar 8 |             — | None                    |
| Hot runner          | MP-2026-014 | Component          | Tooling Purchaser   | Delayed     |        Mar 4 | Mar 15 |             — | Supplier delay          |
| Resin               | MP-2026-014 | Injection material | Injection Purchaser | Ready       |       Mar 10 | Mar 12 |        Mar 12 | None                    |
| Texture outsourcing | MP-2026-015 | Outsourcing        | Tooling Purchaser   | Not Started |            — |      — |             — | Waiting design approval |

Status options:

* Not requested
* Requested
* Ordered
* In progress
* Shipped
* Received
* Delayed
* Cancelled
* Not required

Suppliers can be manually entered by Purchasing or PM for now.

Supplier login can come later.

---

## Module 8: Customer Query Center

This is the bridge between Marketing/Sales and PM.

Because PM does not speak English and Sales is the communication channel, the system needs a clean request-and-answer workflow.

## Customer query workflow

1. Customer asks Sales a question.
2. Sales creates a query in MoldPilot Launch.
3. Query is linked to project code.
4. Planning PM or PM Assistant answers operational status.
5. Technical PM answers technical details when needed.
6. Sales receives an approved answer.
7. Sales replies to customer.

Example:

| Query                                   | Project     | Asked By | Assigned To  | Status    |      Due | Approved Reply                                    |
| --------------------------------------- | ----------- | -------- | ------------ | --------- | -------: | ------------------------------------------------- |
| Customer asks when T1 samples are ready | MP-2026-014 | Sales 2  | Planning PM  | Answered  |    Today | T1 is planned after EDM correction, target Mar 28 |
| Customer asks why flash occurred at T0  | MP-2026-014 | Sales 1  | Technical PM | In Review | Tomorrow | Pending technical explanation                     |

This keeps Sales from interrupting everyone randomly.

It also creates a record of what was promised to the customer.

Later, AI can help translate and polish replies:

Internal PM note:

> T0后发现分型面有披锋，今晚EDM修正，预计3月28日T1。

Customer-facing English:

> After the T0 trial, we found flash near the parting line. The mold correction is currently in progress, and the next T1 trial is targeted for March 28.

For MVP, the AI should draft, not auto-send.

---

# 7. Dashboards needed for MVP

You need different dashboards for different users.

## Dashboard 1: GM Dashboard

Purpose:

> See project health, rework, delays, bottlenecks, and team performance.

Widgets:

| Widget                      | Meaning                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| Active projects             | Number of ongoing PO-confirmed projects                                     |
| Projects by stage           | DFM, design, machining, fitting, T0, T1, sample approval                    |
| At-risk projects            | Projects likely to miss next milestone                                      |
| Late projects               | Projects already past planned date                                          |
| Open critical issues        | High-severity unresolved issues                                             |
| Overdue tasks by department | Machining, assembly, purchasing, QC, injection                              |
| Upcoming T0/T1/T2           | Trial schedule visibility                                                   |
| Trial count per project     | Shows projects needing too many trials                                      |
| Top rework causes           | Design issue, fitting issue, process issue, customer change, material delay |
| T0 readiness score          | Whether projects are trialing before truly ready                            |
| Repeat issue categories     | Shows where training/process improvement is needed                          |

The GM dashboard should not be only for punishment. It should show where leadership support is needed.

---

## Dashboard 2: Planning PM Dashboard

Purpose:

> Run the daily project execution.

Widgets:

| Widget                     | Meaning                                        |
| -------------------------- | ---------------------------------------------- |
| Today’s tasks              | Everything due today                           |
| This week’s milestones     | DFM close, design approval, T0, T1, shipment   |
| Overdue tasks              | What needs follow-up                           |
| Blocked tasks              | What cannot move                               |
| Tasks by department        | Machining, assembly, injection, QC, purchasing |
| Upcoming trials            | T0/T1/T2 schedule                              |
| Steel / outsourcing status | Critical purchasing blockers                   |
| Customer queries waiting   | Questions from Sales needing PM answer         |
| Projects at risk           | Where PM needs to act today                    |

This is the main working screen for the Planning PM.

---

## Dashboard 3: Technical PM Dashboard

Purpose:

> Focus on technical risk and rework prevention.

Widgets:

| Widget                               | Meaning                                   |
| ------------------------------------ | ----------------------------------------- |
| DFM / DFA items pending              | Technical review workload                 |
| Mold Flow required / pending         | Simulation-related tasks                  |
| Design changes awaiting review       | Customer or internal design changes       |
| Trial issues needing root cause      | T0/T1/T2 problems not yet analyzed        |
| High-severity technical issues       | Major technical risks                     |
| Corrective actions awaiting approval | Proposed fixes needing technical sign-off |
| Repeat technical issues              | Training/process improvement signal       |
| T0 readiness technical checklist     | Prevent poor first trials                 |

The Technical PM dashboard should not be crowded with every machining task. It should focus on technical decisions.

---

## Dashboard 4: Marketing / Sales Dashboard

Purpose:

> Let Sales answer customers without becoming project managers.

Sales should see a simplified, approved project status.

Columns:

| Field                          | Example                     |
| ------------------------------ | --------------------------- |
| Project code                   | MP-2026-014                 |
| Customer code                  | C-027                       |
| Current stage                  | T0 correction               |
| Next customer-facing milestone | T1 trial                    |
| Target date                    | Mar 28                      |
| Latest approved update         | T1 planned after correction |
| Customer query status          | 2 answered, 1 pending       |
| Sample approval status         | Pending                     |

Sales should not see:

* internal blame comments
* employee performance comments
* sensitive cost data
* unnecessary technical chaos
* full customer contact data inside this system

They should see enough to communicate professionally.

---

## Dashboard 5: Department Leader Dashboard

Purpose:

> Every department knows what they owe.

Separate views for:

* Machining Day Shift
* Machining Night Shift
* Assembly Group 1
* Assembly Group 2
* Injection Manager
* QC
* Purchasing Tooling
* Purchasing Injection

Example:

| Task                       | Project     | Priority |      Due | Status      | Blocker          |
| -------------------------- | ----------- | -------- | -------: | ----------- | ---------------- |
| EDM cavity insert          | MP-2026-014 | High     |    Today | In Progress | None             |
| Correct ejector pin length | MP-2026-013 | Medium   | Tomorrow | Not Started | Waiting drawing  |
| Check cooling leak         | MP-2026-015 | High     |    Today | Blocked     | Waiting assembly |

This should be simple. Department leaders do not need a complex ERP screen.

They need:

* my tasks
* due date
* priority
* blocker
* update button
* upload photo/report, when needed

---

## Dashboard 6: PM Assistant Dashboard

Purpose:

> Keep data clean and reduce PM’s admin burden.

Widgets:

| Widget                      | Meaning                                    |
| --------------------------- | ------------------------------------------ |
| Missing actual dates        | Gates completed but no actual date entered |
| Tasks without owners        | Accountability gap                         |
| Tasks without due dates     | Weak planning                              |
| Projects not updated today  | Stale project status                       |
| Customer queries unanswered | Sales waiting for information              |
| Trial reports missing       | QC/injection follow-up needed              |
| Purchasing ETAs missing     | Unknown material risk                      |

The PM Assistant may still exist, but the system makes their role less about chasing manually and more about maintaining process discipline.

---

# 8. Updated MVP feature priority

## P0 — Must have in first MVP

These are required.

| Feature                                    | Why it is needed                                                      |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Login and role permissions                 | Each person sees their own responsibilities                           |
| Project creation after PO confirmation     | MVP starts only after PO                                              |
| Customer code / project code system        | Protects customer identity                                            |
| Project timeline / gate tracker            | Shows planned vs actual progress                                      |
| Daily task board                           | Makes responsibilities visible                                        |
| Department task assignment                 | Planning PM can assign machining, assembly, injection, QC, purchasing |
| Issue tracker                              | Tracks DFM, design, trial, QC, machining, assembly issues             |
| T0/T1/T2 trial records                     | Core to rework reduction                                              |
| Trial issue root cause + corrective action | Prevents shallow issue closure                                        |
| T0 readiness checklist                     | Prevents unnecessary bad trials                                       |
| Purchasing status tracker                  | Steel and outsourcing status visibility                               |
| Customer Query Center                      | Sales can ask PM through system instead of chasing                    |
| Basic dashboards                           | GM, PM, Technical PM, Sales, Department Leaders                       |
| File attachment                            | DFM, Mold Flow, trial photos, QC reports                              |
| Activity log                               | Traceability: who changed what and when                               |

## P1 — Strong second layer

These should come after the first version works.

| Feature                           | Why                                              |
| --------------------------------- | ------------------------------------------------ |
| AI customer update draft          | Helps Sales communicate in English               |
| AI internal weekly summary        | Saves PM reporting time                          |
| Bilingual note translation        | PM can write Chinese; Sales can reply in English |
| Repeat issue library              | Helps reduce recurring rework                    |
| Lessons learned module            | Converts mistakes into training                  |
| Shift handoff log                 | Useful for machining day/night coordination      |
| Approval workflow                 | GM/PM approval for risky decisions               |
| Customer-facing PDF update export | Clean external communication                     |

## P2 — Later

| Feature                    | Why later                                  |
| -------------------------- | ------------------------------------------ |
| Supplier portal            | Purchasing can manually update first       |
| Customer portal            | Privacy and communication risk             |
| Full CRM integration       | Sales pipeline is outside this MVP         |
| RFQ / quote tracking       | You said tracking starts after PO          |
| Machine live data          | More complex hardware/software integration |
| Inventory system           | Too broad for MVP                          |
| Automatic employee scoring | Data must mature first                     |
| Full ERP integration       | Later platform phase                       |

---

# 9. Updated MVP data model

The data model should avoid customer identity leakage.

## Main objects

| Object                 | What it stores                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| **User**               | Login, role, department                                                                       |
| **Department / Group** | Machining day, machining night, assembly group 1, assembly group 2, QC, purchasing, injection |
| **Customer Code**      | Only alias/code, not real customer name                                                       |
| **Project**            | PO-confirmed project information                                                              |
| **Part / Mold**        | Part code, mold code, cavity, material, basic technical info                                  |
| **Gate**               | DFM, Mold Flow, design, steel order, machining, fitting, T0, T1, T2, approval                 |
| **Task**               | Work assigned to a person/group                                                               |
| **Issue**              | DFM issue, trial issue, quality issue, machining issue, assembly issue                        |
| **Trial**              | T0/T1/T2 trial record                                                                         |
| **Trial Issue**        | Defect, root cause, corrective action, verification                                           |
| **Purchasing Item**    | Steel, components, outsourcing, material status                                               |
| **Customer Query**     | Question from Sales and approved PM/technical answer                                          |
| **File**               | DFM report, Mold Flow, photos, QC report, trial report                                        |
| **Activity Log**       | Change history                                                                                |
| **KPI Snapshot**       | Saved dashboard data over time                                                                |

## Project object

Example fields:

| Field                  | Example                   |
| ---------------------- | ------------------------- |
| Project ID             | internal database ID      |
| Project Code           | MP-2026-014               |
| Customer Code          | C-027                     |
| Part Code              | P-014-A                   |
| Mold Code              | M-014-01                  |
| PO Confirmed Date      | Mar 1                     |
| Target T0              | Apr 1                     |
| Target T1              | Apr 10                    |
| Target Sample Approval | Apr 18                    |
| Current Stage          | T0 Correction             |
| Planning PM            | Planning PM               |
| Technical PM           | Technical PM              |
| Health                 | On Track / At Risk / Late |
| Priority               | Normal / High / Critical  |

Do not include:

* customer full name
* customer contact person
* customer email
* customer phone number
* quote history
* sensitive pricing

---

# 10. Issue types

To reduce rework, issue categories matter.

Suggested issue types:

| Issue Type               | Example                                             |
| ------------------------ | --------------------------------------------------- |
| DFM issue                | Wall thickness, draft angle, undercut               |
| DFA issue                | Assembly interference, fastening problem            |
| Mold design issue        | Cooling, ejection, gating, venting                  |
| Mold Flow issue          | Warpage, weld line, pressure, filling imbalance     |
| Machining issue          | CNC delay, EDM error, tolerance issue               |
| Assembly / fitting issue | Insert fit, ejector issue, leak, parting line       |
| Trial issue              | Flash, sink, short shot, burn mark, deformation     |
| QC issue                 | Dimension NG, appearance NG, sample report issue    |
| Purchasing issue         | Steel delay, component delay, outsourcing delay     |
| Customer change          | Late design change, requirement change              |
| Process issue            | Injection parameter, material drying, machine setup |

Severity:

* Low
* Medium
* High
* Critical

Status:

* Open
* In Progress
* Waiting Internal
* Waiting Customer
* Waiting Supplier
* Waiting Verification
* Closed

Closure should require:

* owner
* corrective action
* verification
* closed date

For trial issues, closure should also require:

* found at T0/T1/T2
* root cause
* correction method
* verified at next trial or QC check

---

# 11. KPI design based on your philosophy

Your KPI philosophy is good:

> Visibility first, coaching second, improvement third, reward good performance, train weak performance, punish only when repeated incompetence continues after support.

The MVP should support that culture.

## Good KPIs for MVP

| KPI                              | Why it matters                                        |
| -------------------------------- | ----------------------------------------------------- |
| Planned vs actual T0 date        | Measures project planning and execution               |
| Number of trials per project     | Directly tied to rework reduction                     |
| T0 readiness score               | Shows whether the team prepared properly              |
| Open trial issues                | Shows unresolved technical/rework problems            |
| Average days from T0 to T1       | Measures correction speed                             |
| Average days from T1 to approval | Measures launch efficiency                            |
| Rework issue count by category   | Shows root causes                                     |
| Repeat issue category            | Shows training/process weakness                       |
| Overdue tasks by department      | Shows execution bottlenecks                           |
| Blocked tasks by reason          | Shows leadership problems, not just worker problems   |
| Customer query response time     | Helps Sales communicate better                        |
| Purchasing delay rate            | Shows steel/component risk                            |
| Task completion reliability      | Shows discipline, but should be interpreted carefully |

## Reward signals

The system should highlight good behavior, not only problems.

Examples:

| Positive behavior             | How system can detect it                                  |
| ----------------------------- | --------------------------------------------------------- |
| Early risk escalation         | Person marked blocker before deadline                     |
| Fast critical issue closure   | High-severity issue closed on time                        |
| Good documentation            | Root cause + photo + verification uploaded                |
| Rework prevention             | Issue found before T0 instead of after T0                 |
| Strong department reliability | Group completes tasks on time consistently                |
| Good cross-team support       | Purchasing/technical/assembly helped unblock another team |

## Be careful with bad KPI design

Avoid ranking people only by:

* number of tasks closed
* number of comments written
* number of issues closed
* speed without quality

That creates bad behavior.

Someone can close many easy tasks and look good. Another person may solve one difficult technical problem and create much more value.

So the system should measure:

* task difficulty
* issue severity
* rework prevented
* blocker raised early
* verification quality
* repeated mistakes

---

# 12. MVP permissions

A simple permission model is enough.

| Role                  | Can view                                        | Can edit                                                            |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------- |
| **GM**                | All projects, dashboards, KPIs                  | Comments, escalations, approvals                                    |
| **Planning PM**       | All project execution data                      | Timeline, tasks, owners, due dates, project status                  |
| **Technical PM**      | All technical/project data                      | DFM, Mold Flow, design issues, trial root cause, corrective actions |
| **PM Assistant**      | Most project data                               | Timeline updates, task updates, missing data follow-up              |
| **Marketing / Sales** | Approved project status, customer query center  | Customer queries, customer-facing notes                             |
| **QC**                | Assigned projects, QC/trial data                | QC reports, inspection issues, sample approval status               |
| **Injection Manager** | Trial schedule, trial tasks, injection issues   | Trial records, process notes, trial completion                      |
| **Assembly Leader**   | Assembly/correction tasks                       | Task status, blockers, photos, completion notes                     |
| **Machining Leader**  | CNC/EDM tasks                                   | Task status, blockers, shift handoff                                |
| **Purchasing**        | Purchasing items and related project milestones | Order status, ETA, received date, supplier status                   |
| **Viewer**            | Limited read-only                               | Nothing                                                             |

Sales should not edit technical project details.

Department leaders should not edit the entire timeline.

Purchasing should not edit trial issues.

Technical PM should not be responsible for updating every machining task.

---

# 13. Main MVP screens

The MVP should have these screens.

## 1. Login

Each user enters their portal based on role.

## 2. Project Command Center

Main list of all active PO-confirmed projects.

## 3. New Project Setup

Created after PO confirmation.

Minimum fields:

* project code
* customer code
* part code
* mold code
* PO confirmed date
* target T0
* target sample approval
* planning PM
* technical PM
* project priority
* required gates: DFM, Mold Flow, design confirmation, T0/T1/T2, shipment

## 4. Project Detail Page

Timeline, tasks, issues, trials, purchasing, customer queries, files.

## 5. Daily Task Board

Shows tasks by owner, group, department, due date, and blocker.

## 6. Trial Control Page

T0/T1/T2 records, trial issues, root cause, correction, verification.

## 7. T0 Readiness Checklist

Pre-trial checklist to reduce avoidable rework.

## 8. Purchasing Tracker

Steel, mold base, hot runner, outsourced parts, material status.

## 9. Customer Query Center

Sales asks questions, PM/Technical PM answers, Sales replies to customer.

## 10. Dashboard / KPI

Different view for GM, Planning PM, Technical PM, Sales, department leaders.

## 11. Admin Settings

Users, roles, departments, issue categories, project gate templates.

---

# 14. What should not be included in MVP

To keep the first version clean, do not include:

| Not MVP                         | Reason                                   |
| ------------------------------- | ---------------------------------------- |
| RFQ / quote tracking            | You start tracking after PO              |
| Full customer database          | Customer info should stay with marketing |
| Customer contacts               | Privacy risk                             |
| Full CRM                        | Different system                         |
| Full ERP                        | Too broad                                |
| Accounting                      | Not related to immediate pain            |
| Payroll / HR                    | Too sensitive                            |
| Inventory management            | Later                                    |
| Machine scheduling automation   | Later                                    |
| Supplier portal                 | Manual update first                      |
| Customer portal                 | Later                                    |
| Automatic punishment system     | Dangerous before data is mature          |
| Direct machine data integration | Later                                    |
| Complex AI agents               | Start with controlled AI summaries only  |

---

# 15. Best MVP definition

Here is the clean MVP definition:

## **MoldPilot Launch MVP**

**Purpose:**
An internal project execution system that tracks tooling projects from PO confirmation to sample approval / production handoff, with a focus on reducing rework, reducing unnecessary T0/T1/T2 trials, visualizing daily tasks, and improving customer communication through Sales.

**Primary users:**
GM, Planning PM, Technical PM, PM Assistant, Marketing/Sales, QC, Injection Manager, Assembly Leaders, Machining Leaders, Purchasing.

**Starts at:**
PO confirmed.

**Ends at:**
Sample approval, shipment, or production handoff.

**Core workflow:**
PO → DFM/DFA → Mold Flow if needed → mold design → customer design confirmation if needed → steel/component order → CNC/EDM → fitting/assembly → T0 readiness → T0 → correction → T1 → correction → T2 if needed → sample approval → shipment/production.

**Core modules:**
Project command center, timeline tracker, daily task board, issue tracker, trial control, T0 readiness checklist, purchasing tracker, customer query center, dashboards.

**Privacy rule:**
Only customer codes and project codes are used. No customer names, contacts, emails, or sales-sensitive details in the MVP.

**Main business goal:**
Reduce rework and unnecessary tool trials while making daily responsibilities clear.

---

# 16. The most important MVP principle

The system should not only ask:

> “Who is late?”

It should ask:

> “Why are we late, what is blocked, what can we learn, and how do we prevent this from happening again?”

That is how this becomes more than a KPI system.

The MVP should create a culture where:

* problems are visible early
* owners are clear
* departments know their daily tasks
* Sales stops chasing everyone manually
* Technical PM focuses on technical judgment
* Planning PM controls execution
* GM sees bottlenecks
* good employees are recognized
* weak employees are trained with evidence
* repeated incompetence can be addressed fairly

My recommendation is to make the first build extremely focused:

> **PO-confirmed project tracking + daily task visibility + T0/T1/T2 rework control + customer query workflow.**

That is the real MVP.
