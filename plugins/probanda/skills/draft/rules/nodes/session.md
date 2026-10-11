<!-- node id=draft/session title="Session open" parents=draft when="Session entry has returned a token. The fast open and opening lines run here, and every later position descends from it." -->
<!-- edge to=draft/job weight=0.18 -->
<!-- edge to=draft/outline weight=0.34 -->
<!-- edge to=draft/setup weight=0.17 -->
<!-- edge to=draft/filing weight=0.18 -->
<!-- edge to=draft/revise weight=0.03 -->
<!-- edge to=draft/reply weight=0 -->
<!-- edge to=draft/retire weight=0.03 -->
<!-- edge to=draft/finish weight=0.03 -->
<!-- edge to=draft/housekeeping weight=0 -->
<!-- edge to=draft/side weight=0.04 -->
<!-- edge to=draft/court-oral weight=0 -->

<!-- rule id=draft.shelve.suppress-unattended when=unattended:true provenance="rules-DAG 6.3 substitute, 2026-10-10: pilot acceptance tests 2 and 3, contextual-rule-injection spec 16" -->
- An unattended run never offers, applies or removes a suppression.
