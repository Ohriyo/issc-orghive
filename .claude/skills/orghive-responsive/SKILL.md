---
name: orghive-responsive
description: Responsive and touch-accessibility rules plus the verification routine for Orghive's web app (apps/web). Use this whenever you build, change or review any screen, page, route, view, layout or component in apps/web, including "small" Tailwind class tweaks, new sections, carousels, grids, dialogs, forms, headers or images, and before you call any UI work done. Also use it when the user mentions mobile, tablet, phone, breakpoints, overflow, tap targets, screenshots of the app, or "check it on different screen sizes", even if they don't say "responsive".
---

# Orghive responsive rules and checks

Students mostly open Orghive on phones (PRODUCT.md), and the prototype in `design/` is drawn for desktop. Every UI change therefore has to work from a 360px phone to a 2560px monitor, and you prove that with screenshots and measurements rather than by reading the code. CLAUDE.md ("Responsive design rules") is the short version; this skill is the working checklist and the exact way to verify.

## 1. Build it right (checklist)

Work through this while you write the code, not after:

- **Mobile first.** Unprefixed classes style phones; add `sm:` 640, `md:` 768, `lg:` 1024, `xl:` 1280, `2xl:` 1536 upward. The values live in `@theme` in `apps/web/src/index.css`. In JS, use `useBreakpoint('md')` from `@/hooks/use-breakpoint` (a test keeps it in sync with the CSS); never write a raw `(min-width: …px)` query.
- **Page width from `<Container>`** (`@/components/container`): max 1280px, gutters 16/24/32/80px that also clear a landscape notch. Use `as="main"`/`"nav"` or `asChild` (e.g. around `<Reveal>`). Don't hand-write `mx-auto max-w-7xl px-4 sm:px-8 lg:px-20`.
- **Fluid type tokens.** `text-display` (page titles), `text-title` (a title beside a honeycomb), `text-h1`–`text-h3`, `text-lead`, `text-body-lg`, `text-body`, `text-small`, `text-caption`. They already scale between phone and desktop, so don't stack jumps like `text-h1 lg:text-display`, and never size text in `vw` alone (it stops growing with browser zoom, WCAG 1.4.4). Reading text is never below 14px.
- **44×44px hit areas** for every button and link. Text links get `tap-area` (an invisible layer, 12px above/below and 6px to the sides, that changes nothing visually). Icon buttons are `size-11`. Pills: `PillButton` `md` is 44px, `lg` 56px.
- **No page-level horizontal scroll at 360px.** Wide content (tables, code, long tokens) scrolls inside its own container (`overflow-x-auto`), or becomes cards on phones. A flex child holding an input needs `min-w-0`, or it refuses to shrink and pushes its siblings off-screen.
- **`dvh`, never `vh` or `h-screen`** for full-height sections, so mobile browser bars don't cut content. Bottom-fixed UI adds `pb-safe`.
- **Hover is never the only way.** Every `hover:` effect gets a matching `focus-visible:` (or `group-focus-visible:`/`has-[a:focus-visible]:`), and nothing is hidden until hover. Tailwind v4 only applies `hover:` on devices that can hover, so effects don't stick on touch.
- **Layout per tier.** Phones: one column; logo or image first, centred text under it. Tablets (md): two-up grids or three-column honeycombs. Desktop (lg/xl): the prototype's side-by-side compositions. Dialogs and sheets on phones use the Radix `Dialog` from `radix-ui` (focus trap, Esc, focus return); bottom sheets stay under about 85dvh.
- **Images.** `OrgLogo` takes `srcSet` from the API's `logoSrcSet` and a `sizes` value from `@/components/logo-sizes` that matches the slot's real drawn width. Below-the-fold images are lazy; the page's main image is `priority`.
- **Motion.** Use `usePrefersReducedMotion`. Decorative GPU work (the hero shader) stays off below md and on `isLowEndDevice()`.
- **Every screen still has loading, empty and error states**, and they must also fit at 360px.

## 2. Viewport matrix

| Width × height | Device | Required? |
|---|---|---|
| 360×740 | small Android | **yes** |
| 390×844 | iPhone | for phone-heavy screens |
| 768×1024 | tablet portrait | **yes** |
| 1024×768 | tablet landscape / small laptop | when the layout changes at lg |
| 1366×768 | common laptop (short!) | **yes** |
| 1920×1080 | desktop | **yes** |
| 2560×1440 | large monitor | when content is width-capped or bleeds |

The 1366×768 row matters more than it looks: content sized only from width (carousels, hero art) can push the main action below a 768px-tall fold.

## 3. Verify (before saying "done")

This is the webapp-testing routine, done with Node Playwright because the repo already has `@playwright/test` and its Chromium installed (Python Playwright is not).

1. **Make sure the app runs.** `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` should print 200. If not, start `pnpm dev` from the repo root in the background (`docker compose up -d` first if the API needs its services). Don't run it in the foreground; it never exits.
2. **Screenshot and measure** the routes you touched (plus any route that renders a component you changed) at the four required widths. Put output in your scratchpad, never in the repo:
   ```bash
   node .claude/skills/orghive-responsive/scripts/check-responsive.mjs \
     --routes /colleges/cea,/orgs/jpice --widths 360,768,1366,1920 --out <scratchpad>/responsive
   ```
   In Git Bash on Windows, prefix the command with `MSYS_NO_PATHCONV=1` (otherwise `/colleges` arrives as `C:/Program Files/Git/colleges`), or leave the leading slash off the routes.
   It prints one line per route and width. `FAIL` means a hard rule broke: page overflow (with the element causing it), a button or link under 44×44px, or a page error. It also reports small text, clipped text and upscaled images. Every value is also in `results.json`. To see signed-in views, add `--login` and set `ORGHIVE_EMAIL`/`ORGHIVE_PASSWORD` in the environment for that command. Ask the user for credentials; never hard-code them.
3. **Look at the screenshots.** Numbers don't catch everything: crowded headers, text over hexagons, broken honeycombs, arrows covering content, awkward wrapping. Tile each route into one image and read it:
   ```bash
   python .claude/skills/orghive-responsive/scripts/contact-sheet.py <scratchpad>/responsive colleges_cea --design design/college-cea.png
   ```
   (`--full` uses the full-page shots.) Compare with the matching PNG in `design/`; the prototype is binding on desktop.
4. **Interactions, when you built one.** Measuring layout doesn't prove a gesture. For carousels, dialogs, sheets and menus, script it: touch swipe with CDP `Input.dispatchTouchEvent`, keyboard (Tab, arrow keys, Esc returns focus) and taps. Then check the state change, e.g. `aria-current` moved, or focus is inside `[role="dialog"]`.
5. **Run the guard rails:** `pnpm --filter web test:e2e` (every public route at 360/768/1366/1920: no overflow, 44px targets, axe WCAG 2.2 AA; the API is stubbed in `apps/web/e2e/fixtures.ts`). **A new public route goes into `PUBLIC_ROUTES`** there, with stub data for its API calls. Then `pnpm lint && pnpm typecheck && pnpm test`.
6. **Report** per width what you checked and what you fixed. If you deviate from the prototype or a rule to make something fit, say so and why.

## Pitfalls already hit in this repo

- Scroll reveals start transparent and blurred. Scroll the page once before screenshots (the script does), or captures show half-faded headings.
- Don't wait for `networkidle` on the dev server; Vite's HMR socket keeps it busy. Wait for content (`h1`, no `[aria-busy="true"]`).
- With `srcset`, `img.naturalWidth` is density-corrected. Judge sharpness by the picked variant's real width (the script does).
- The dev database's seeded documents are `members`-only, so signed-out pages show empty Paperworks. Use `--login` to see data.
- `pnpm dev` restarts the API when its files change; a check run during an API edit shows error states. Rerun it.
- Run Prettier only on the files you changed, not on all of `src`.
- On the home page the hero honeycomb bleeds into the top right, which is why the header shows full links only from xl.
