# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Students of Northwest Samar State University (NwSSU)** browse an organization's Paperworks and download approved documents: proposals, reports, resolutions, accomplishment reports. Mostly on phones (inferred, not confirmed).
- **Organization officers** upload and edit their own organization's documents.
- **Organization heads** (CSC Governor, SBO or ISSC President) approve documents along the chain in `docs/DOMAIN_RULES.md`.
- **ISSC admins** manage organizations, memberships and everything else.

## Product Purpose

Orghive is NwSSU's official digital archive for student-organization documents. It replaces scattered folders and group-chat attachments with one place where each organization's Paperworks are kept, versioned, approved and findable. Success means a student can find an organization and its approved documents in seconds, and an officer can file a document without asking anyone where it goes.

## Positioning

It is the university's own record, organized the way the student government actually is: ISSC, then one Collegiate Student Council (CSC) per college, then that college's Student Body Organizations (SBOs). Navigation follows that hierarchy.

## Operating Context

- Three organization levels: ISSC (one), CSC (one per college: CAT, CCIS, CCJS, CEA, CoED, COM, CON), SBO (under a college's CSC).
- "Paperworks" is the user-facing name for an organization's document archive.
- Document lifecycle: draft, pending, approved or rejected, archived. Re-uploads create versions; nothing is overwritten.
- Organization pages get shared as links. Facebook and Messenger previews are the likely channel (inferred, not confirmed).

## Capabilities and Constraints

- Approval chain is confirmed; required semester reports and several visibility rules are still open questions (see `docs/DOMAIN_RULES.md`). Do not design compliance features until answered.
- Client-rendered React SPA; link-preview tags are set client-side for now, so crawlers that do not run JavaScript see the default card.

## Brand Commitments

- The prototype PNGs in `design/` are binding: NwSSU greens, hexagon frames, wave dividers, Poppins, pill buttons. Light theme only.
- Real organization logos, names and descriptions; descriptions are transcribed from the prototype.

## Evidence on Hand

- Prototype screens in `design/`. Descriptions exist for ISSC, CSC-CEA, CEA, JPICE, UAPSA and JIIEE. IECEP, ICpEP.SE and PSME have none, and none should be invented.
- Logos are uploaded per organization; until then pages show initials.

## Product Principles

1. The hierarchy is the navigation: every page says where it sits (ISSC, college, organization).
2. Official, not promotional: plain descriptions, no invented claims about an organization.
3. Every page works on a phone over a slow connection, with loading, empty and error states.
4. Never invent a domain rule; ask.

## Accessibility & Inclusion

WCAG 2.2 AA. Carousels work with arrow keys, logos have alt text, green text passes contrast, and `prefers-reduced-motion` turns off the WebGL background and carousel blur.
