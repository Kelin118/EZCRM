---
name: ezcrm-ui-audit
description: Systematic EZCRM UI/UX review. Use when asked to check design, improve UI, fix UX, review accessibility, redesign a modal/table/form/kanban, or verify mobile behavior.
metadata:
  short-description: Audit EZCRM UI/UX
---

# EZCRM UI Audit

Use this skill for focused UI, UX, accessibility, and interaction review in EZCRM.

## Workflow

1. Read `frontend/AGENTS.md`.
2. Inspect the target page and nearby pages.
3. Inspect reusable components used by the target page.
4. If available and relevant, use `web-design-guidelines` as a review layer for the affected files.
5. Identify issues in hierarchy, spacing, density, typography, alignment, forms, actions, status visibility, responsiveness, accessibility, keyboard/touch behavior, and loading/error/empty states.
6. Classify relevant findings as critical, important, or improvement.
7. Fix only findings relevant to the requested task.
8. Do not change unrelated business logic.
9. Do not redesign unrelated screens.
10. Run the frontend build.
11. If browser tooling exists, visually verify the affected page and changed action.
12. Report material issues fixed and remaining relevant findings.

Do not show hundreds of raw findings if they have already been fixed.

## Web Design Guidelines Integration

When using `web-design-guidelines`, first determine the frontend files related to the task. Apply the findings only where they support the current request.

Priority when recommendations conflict:
1. business correctness;
2. security and data integrity;
3. accessibility/usability;
4. existing EZCRM UX/design consistency;
5. external guideline recommendation.

Do not run a full repository audit for a small local UI task.
