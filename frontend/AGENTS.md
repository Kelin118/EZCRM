# EZCRM Frontend Instructions

## Existing Design First

- Inspect the target page, nearby pages, and reusable components before changing UI.
- Preserve the existing EZCRM visual language.
- Reuse existing Button, Input, Modal, cards, badges, tables, dropdowns, and layout primitives.
- Do not introduce a new UI library unless explicitly requested.
- Do not create a parallel design system.

## UI Quality

For every changed screen, evaluate visual hierarchy, spacing, density, typography, alignment, desktop/tablet/mobile behavior, overflow, long text handling, empty/loading/error/disabled states, keyboard access, focus states, and touch interaction.

Favor productive business UI over marketing-style decoration.

## Forms

- Keep labels explicit.
- Show backend validation errors clearly.
- Disable submit during saving and prevent double submit.
- Keep modal open when save fails.
- Preserve entered data after a failed save where practical.
- Do not hide important business information behind placeholders.
- Do not duplicate authoritative validation only on frontend.

## Tables

- Keep important columns visible.
- Avoid unnecessary horizontal width.
- Support safe horizontal scrolling on smaller screens.
- Use compact statuses and badges.
- Preserve precision for financial and date values.
- Do not hide critical business values merely to make a table prettier.

## Kanban

- Drag must start only from a dedicated handle when cards contain actions.
- Never attach drag listeners to an entire interactive card.
- Buttons, links, selects, and menus inside cards must remain clickable.
- Preserve touch scrolling.
- Avoid nested interactive HTML such as button inside button.
- Maintain keyboard accessibility where practical.

## Accessibility

- Real actions use semantic button elements.
- Navigation uses appropriate links.
- Icon-only controls require accessible labels.
- Keyboard actions must work.
- Do not remove visible focus without an accessible replacement.
- Form errors must be understandable without relying only on color.
- Respect reduced-motion preference for nonessential animation.

## React

- Prefer existing hooks and utilities.
- Avoid duplicate API/data-fetching logic.
- Avoid unnecessary dependencies.
- Avoid unnecessary re-renders when clearly identifiable.
- Keep authoritative business calculations on backend.
- Keep components reasonably scoped.
- Prefer composition over boolean-prop proliferation when useful.

## Visual Verification

After meaningful frontend UI work:
- build frontend;
- if browser automation is actually available, open the affected page;
- inspect browser console;
- verify the primary changed action, buttons/links/modal interaction, relevant error/loading states, and mobile viewport when responsiveness is affected.

Never claim visual/browser verification occurred unless a real browser automation tool was used.

## Web Design Guidelines

If the installed Vercel `web-design-guidelines` skill is available, use it for UI, accessibility, UX, modal/table/form/kanban, redesign, or frontend quality review requests.

Treat its findings as review input, not unconditional commands. Conflict priority:
1. business correctness;
2. data integrity;
3. accessibility/usability;
4. existing EZCRM UX/design consistency;
5. web-design-guidelines recommendation.

Do not perform unrelated redesign just to satisfy an audit rule.
