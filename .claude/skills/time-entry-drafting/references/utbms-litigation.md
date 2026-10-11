# UTBMS Litigation Code Reference

Standard litigation codes used for time entry classification. This skill uses task codes (L-series) and activity codes (A-series) from the Uniform Task-Based Management System.

## Task Codes (L-series)

What area of litigation work was performed.

| Code | Description | Common signals |
|------|-------------|----------------|
| L110 | Case Assessment, Development and Administration | File review, case strategy, conflict checks, engagement letters |
| L120 | Pre-Trial Pleadings and Motions | Drafting/reviewing pleadings, NOCCs, responses, affidavits |
| L130 | Discovery | Document production, interrogatories, examinations for discovery |
| L140 | Document Management | Document organization, indexing, privilege review |
| L150 | Trial Preparation and Trial | Trial binders, witness prep, court appearances, trial attendance |
| L160 | Appeal | Notice of appeal, factum drafting, appeal book preparation |
| L170 | Alternative Dispute Resolution | Mediation prep, mediation attendance, settlement negotiations |
| L190 | Other Litigation Activities | Work not fitting other categories |

## Activity Codes (A-series)

What type of activity was performed within the task area.

| Code | Description | Common signals |
|------|-------------|----------------|
| A101 | Plan and Prepare | Strategy meetings, case planning, calendaring |
| A102 | Research | CanLII, Westlaw, legal databases, case law review |
| A103 | Draft/Revise | Word processing, document creation and editing |
| A104 | Review/Analyze | Reading documents, reviewing correspondence, analysis |
| A105 | Communicate (in firm) | Internal emails, staff meetings, file discussions |
| A106 | Communicate (with client) | Client calls, client emails, client meetings |
| A107 | Communicate (other outside counsel) | Opposing counsel calls/emails/letters |
| A108 | Communicate (other external) | Court registry, experts, witnesses, third parties |
| A109 | Appear in court | Court appearances, chambers applications, trials |
| A110 | Manage data/files | File organization, scanning, data management |
| A111 | Other | Activities not fitting other categories |

## Signal-to-Code Mapping Heuristics

These are starting heuristics for UTBMS assignment. The pattern database overrides these as it accumulates practitioner corrections.

### Research indicators (A102)
- CanLII, Westlaw, LexisNexis, SOQUIJ in window title or URL
- Chrome/Edge tabs with legal database domains
- "Research" in TimeCamp task name

### Drafting indicators (A103)
- Microsoft Word with document title containing legal terms
- LEAP document editor open
- Extended Word sessions (>15 minutes continuous)

### Communication indicators
- **A106 (client):** Phone calls to known client numbers, emails with client name in subject
- **A107 (opposing counsel):** Phone calls to known OC numbers, emails with OC firm name
- **A108 (external):** Court registry calls, expert calls
- **A105 (internal):** Teams/Slack, internal email domains

### Court appearance indicators (A109)
- Google Calendar events with "court", "chambers", "trial", "hearing"
- Telus calls to court registry numbers preceding calendar events
- Location data indicating courthouse

### Task code assignment
Task codes require understanding the matter context. A phone call about a pre-trial conference is L150/A106, not L110/A106. When the matter context is ambiguous, default to the broadest applicable task code (L110 for general case work, L120 for anything pleadings-related) and let the practitioner correct.
