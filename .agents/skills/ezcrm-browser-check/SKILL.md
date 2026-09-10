---
name: ezcrm-browser-check
description: Browser-level verification of meaningful EZCRM frontend UI changes when browser tooling is available. Use after UI changes to check console, network, interactions, modals, forms, desktop, and mobile.
metadata:
  short-description: Verify EZCRM UI in browser
---

# EZCRM Browser Check

Use this skill after meaningful frontend UI changes when browser automation is available.

## Workflow

1. Determine the target URL and environment.
2. Open the affected page.
3. Check the browser console.
4. Check failed network requests if supported.
5. Verify the changed action.
6. Verify buttons actually click.
7. Verify modal open/close behavior.
8. Verify form validation.
9. Verify saving/loading state.
10. Verify relevant error behavior.
11. Check desktop viewport.
12. Check mobile viewport if responsiveness is relevant.
13. Take screenshots where useful.
14. Report runtime and visual problems.

Never claim browser verification occurred if no browser automation tool was actually used.

Do not make destructive production mutations just to test UI.
