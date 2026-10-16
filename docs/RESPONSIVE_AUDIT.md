# Responsive audit

Audited 2026-10-16 against the dev build (`pnpm dev`, seeded data). Findings only: no code was changed for this audit.

**Responsive score: 3 / 4 (Good).** No screen scrolls sideways, no text is clipped, nothing is hidden behind hover, and every tap target meets the WCAG 2.2 AA minimum of 24 px. The issues below are about comfort and polish, plus one broken link: a few targets are under the 44 px touch size, logos are soft on high-density phones, carousels are taller than short laptop screens, and the college page squeezes its text at 1024 px.

## Scope

| Screen | Route audited | Notes |
|---|---|---|
| Home | `/` | |
| College carousel | `/colleges` | Redirects to `/colleges?focus=cat` |
| College page | `/colleges/cea` | |
| SBO carousel | `/colleges/cea/organizations` | Redirects to `?focus=icpep-se` |
| Org page (with logo) | `/orgs/jpice` | |
| Org page (initials, no description) | `/orgs/iecep` | |
| Paperworks | `/orgs/jpice/paperworks` | **No route yet**: renders the 404 page |
| Login | `/login` | |
| Forgot password | `/forgot-password` | |
| Change password | `/change-password` | Reached via `/account`: the seeded officer still has a temporary password |
| Document detail | — | **Not built** |
| Admin pages | — | **Not built** |
| Account | `/account` | Audited signed in as the ISSC admin (temporary password already replaced) |

Viewports: 360×740, 390×844, 768×1024, 1024×768, 1366×768, 1920×1080, 2560×1440. That is 11 screens × 7 widths = 77 runs.

## Method

- **Browser:** Playwright with headless Chromium. Phones and tablets were emulated with touch at their real pixel density (3× for 360 and 390, 2× for 768 and 1024); desktops at 1×.
- **Screenshots:** each run scrolled the page once so every scroll reveal fired, then took a viewport screenshot and a full-page screenshot.
- **Measured in the page:**
  - horizontal overflow, and which element caused it
  - clipped text
  - tap targets under 44 px, and under 24 px
  - visible text under 14 px
  - images that are stretched or upscaled for the screen's pixel density
  - carousel arrows sitting over other content
  - dialogs taller than the screen
- **Reviewed by eye:** hexagon grids, carousels and overall composition, at all widths.
- **Code scan:** hover-only interactions, fixed widths, and use of `vh` against `dvh`.

**Limits:**

- This is emulated Chromium only. Safari/WebKit, real devices and a real on-screen keyboard were not tested.
- Swipe gestures on the carousels were not exercised; the arrows and layout were.
- Screenshots are kept outside the repo (scratchpad). Re-run the audit to regenerate them.

## Findings

Severity: **High** = broken for users. **Medium** = works but noticeably worse on that device class. **Low** = polish.

| # | Screen | Width(s) | Issue | Severity | Status |
|---|---|---|---|---|---|
| 1 | Paperworks | all | Every "Paperworks" pill (home ISSC section, college page CSC card, org pages) links to `/orgs/:slug/paperworks`, which has no route, so users land on "Page not found". | High | Open |
| 2 | SBO carousel | 1024×768, 1366×768 | The carousel is taller than the screen (page 835 px and 945 px against a 768 px viewport). Slides size from the width only, so on short landscape screens the selected slide's text and its **Proceed** button fall below the fold. | Medium | Fixed: slides capped by screen height (foundation) |
| 3 | College carousel | 1366×768 | Same cause: the page is 843 px tall against 768 px, and **Proceed** sits on the fold edge. | Medium | Fixed: slides capped by screen height (foundation) |
| 4 | College page | 1024×768 | The two-column layout starts at 1024 with a narrow text column. The H1 breaks one word per line ("College of / Engineering / and / Architecture"), and the description runs about 25 characters per line. | Medium | Fixed: stacks below 1280px (foundation) |
| 5 | Home (ISSC logo) | 360, 390, 768, 1024 | The logo is drawn 1.31×, 1.40×, 1.19× and 1.11× larger than its 512 px source on high-density screens, so it looks soft. | Medium | Open |
| 6 | College page (CSC logo) | 360, 390 | The logo is upscaled 1.14× and looks soft. | Low | Open |
| 7 | Home | all | The header "Login" link is 56×30 px. It's the only way into sign-in from home, and it's under 44 px tall on touch. | Medium | Open |
| 8 | College page | all | The "← All colleges" back link is 115×26 px: the main way back, under 44 px tall. | Medium | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |
| 9 | Paperworks (404) | all | The "Back to home" button is 119×32 px. | Low | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |
| 10 | Login, Change password | all | The "Show password" toggle is 40×40 px. | Low | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |
| 11 | Login / Forgot password | all | The "Forgot your password?" and "Back to sign in" text links are 24 px tall. | Low | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |
| 12 | Org pages | 360 | The inline "College of Engineering and Architecture" link wraps to a 23 px-tall line. Inline links are exempt from WCAG 2.5.8 but are hard to tap on small phones. | Low | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |
| 13 | College carousel | 768×1024, 1024×768 | The college motto inside the selected slide renders at 13.2 px (it scales with the slide width). | Low | Fixed: motto never below 14px (component 3) |
| 14 | College & SBO carousels | 768×1024 | On a portrait tablet the carousel fills only the top ~40% of the screen, slides are small and the lower half is empty. | Low | Fixed: tablet slides 36% / 48% of the width, carousel fills ~75% of the screen (component 3) |
| 15 | Change password | 1366×768 | "Save new password" sits on the fold edge (the page is 948 px tall). The page scrolls normally. | Low | Open |
| 16 | Org pages | 360, 390 | The organization's logo hexagon comes after the description, so on phones the page's main image is below the fold. | Low | Open |
| 17 | All screens | 2560×1440 | Content is capped at roughly 1280–1400 px and centred, which leaves wide empty margins; the 404 page is small in the middle of the screen. Acceptable, noted for the container work. | Low | Open |
| 18 | Account | all | The "Change password" text link is 167×29 px. | Low | Fixed: 44px hit area (`tap-area` / larger control), look unchanged |

## Fix log

| Date | Component | Findings closed | Verified |
|---|---|---|---|
| 2026-10-16 | Foundation: breakpoints, fluid type, Container, safe areas, carousel height cap | #2, #3, #4 | Re-screenshot at all 7 widths: no overflow, Proceed above the fold at 1366x768 |
| 2026-10-16 | 1. Tap targets and focus | #8, #9, #10, #11, #12, #18 | Re-screenshot at 360/768/1366/1920: every control's hit area >= 44x44 (probed with elementFromPoint), visuals unchanged against design/college-cea.png |
| 2026-10-16 | 2. HexGrid | — (layout request) | 2 centred columns of smaller hexagons in 16rem on phones, 3 columns in 36rem on tablets, full honeycomb with fillers from lg. Re-screenshot at 360/768/1366/1920: no overflow; desktop unchanged against design/home.png and design/college-cea.png. Honeycomb `sizes` recalculated, so tablets no longer get a too-small logo variant. |
| 2026-10-16 | 3. SpotlightCarousel | #13, #14 | Arrows from lg; below lg swipe plus 44px dot buttons (a counter above 10 items), smaller centre card on phones with neighbours peeking, larger slides on tablets. Verified in Chromium at 360 with touch emulation: a CDP touch swipe, ArrowRight and a dot tap each moved the carousel; no horizontal scroll. Re-screenshot at 360/768/1366/1920 against design/csc-carousel-cat.png and design/sbo-carousel-icpep.png. |

Hover effects now also run on `:focus-visible` (pill lift and brightness, hexagon logo zoom, carousel arrow nudge, document card lift). Tailwind only applies `hover:` on devices that can hover, so nothing sticks or hides on touch.

## Checks that passed everywhere

| Check | Result |
|---|---|
| Horizontal scroll | None at any width; no element extends past the viewport. |
| Overflowing or clipped text | None. |
| Hexagon grids | Hold their honeycomb at every width: 2 columns on phones, then the larger grid. Partial hexagons at the right edge (home, college page) are the intended edge-bleed from the prototype, not breakage. |
| Carousel arrows | 48 px on phones, 80 px on tablets, 96 px on desktop. They never cover the selected slide's text or Proceed button; they only overlap the neighbouring slides that are partly offscreen. |
| Tap targets under 24 px | None (WCAG 2.2 AA 2.5.8 passes). |
| Unreadable text (< 12 px) | None. |
| Stretched images | None: every logo uses `object-contain`. |
| Modals taller than the screen | No modals, drawers or menus exist yet. |
| Hover-only interactions | None hide content or actions. The hover effects (hexagon ring reveal, logo zoom, arrow nudge, card lift) are decorative, and the hexagon ring also appears on keyboard focus. |
| Full-height sections | Already use `min-h-dvh`; no `vh` or `h-screen` in the app. |
| Page errors | None at any width. |

## Not responsive, but found along the way

- The home footer shows the same placeholder number next to both the email and the phone icon. This is a known `TODO(contact)` in `apps/web/src/features/home/contact.ts`; it needs the ISSC's real email, phone and Facebook page.

## How this maps to the responsive foundation

| Foundation item | Findings it addresses |
|---|---|
| 1. Breakpoints in the theme | Done 2026-10-16. Declared explicitly (same values as before). |
| 2. Fluid type scale | #4 (oversized H1 in a narrow column), #13 (motto size) |
| 3. Spacing tokens + Container | #4 (column split at 1024), #17 (large monitors) |
| 4. `dvh` + safe-area insets | `dvh` already in place. Safe areas are not yet handled, and there are no notch-specific findings because emulation has no notch. |
| 5. `useBreakpoint` / reduced motion | #2, #3 (carousel sizing that also has to respect height, not only width) |
| 6. Responsive images | #5, #6 (512 px logos upscaled on high-density screens; needs 768–1024 px variants and `srcset`) |
| Not covered by the foundation | #1 (build the Paperworks route), #7–#12 (tap target sizes), #14–#16 (layout tweaks) |
