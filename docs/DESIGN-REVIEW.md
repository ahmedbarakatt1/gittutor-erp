# Git Tutor design record

## Scope and source

The T01 public shell follows `docs/07-ui-spec.md`, the supplied product copy and confirmed public group prices. The original preview and approved logo are absent. The text wordmark is the specified development fallback. No testimonials, learner totals, tutor biographies, availability claims or payment destinations are invented.

Loaded skills:

- `C:/Users/barak/.codex/skills/design-taste-frontend/SKILL.md`, exact-name upstream revision `3c7017d636c3a4aad378433ea6d0cfa6c921da4a`.
- `C:/Users/barak/.codex/plugins/cache/openai-curated-remote/impeccable/4.3.1/skills/impeccable/SKILL.md`, version 4.3.1, including new-work and craft-floor references.
- `C:/Users/barak/.agents/skills/playwright-cli/SKILL.md`, official CLI 0.1.24.
- `C:/Users/barak/.codex/skills/img2threejs/SKILL.md`, version 2.0.1; bounded accent implemented with the reference and render limitations below.

The product and visual requirements were supplied in the implementation pack. They control the work; no additional design approval is introduced. This is an extension of those requirements, not a new brand direction.

## Art direction

Reading this as a university tutoring landing page with a direct editorial language. The public page makes the student's own course material the starting point, then helps them choose a subject and understand private versus small-group learning. Taste dials: design variance 6, motion intensity 3, visual density 4.

The approved starting palette remains brand red `#CF302F`, ink `#202121`, warm ivory `#F8F6EF`, surface white, yellow accent `#F9CB49` and border `#DDD9D0`. The layout uses an asymmetric introduction, a working educational demonstration, subject rows, a compact tuition comparison and native FAQ disclosure. Typography and content do the work; there are no decorative statistics, fabricated testimonials or simulated operational dashboards.

The study example demonstrates binary search with actual state transitions and labeled example data. It is educational content, not a claim that a particular tutor or session is available. Its controls remain independent of booking.

Public navigation targets existing sections. Operational portal controls will appear with their owning milestones and real authorization/transaction boundaries. Customer surfaces never import the internal pricing-authoring manifest.

Customer pages use generous line lengths and plain-language amounts. The later CS/admin interfaces should use Impeccable's Operate mode: compact task queues, explicit ownership, visible state and period labels, and safe scoped drilldowns. Tutor compensation belongs only on separately authorized tutor/admin surfaces.

## Accessibility and responsive contract

- Semantic headings, landmarks, native buttons, links and disclosures; a skip link and visible focus.
- At least 16px body copy; logical CSS properties and a locale dictionary.
- Single-column reading order at 360px, no clipped money amounts or page overflow.
- Motion restricted to interaction feedback and disabled when reduced motion is requested.
- Educational interaction status announced through a live region.
- Browser verification must include desktop and 360px mobile, keyboard, console, network and sensitive-field inspection.

## Verification record

2026-11-11: Impeccable mechanical source detector executed after implementation:

```powershell
& 'C:\Users\barak\.codex\plugins\cache\openai-curated-remote\impeccable\4.3.1\skills\impeccable\scripts\impeccable.cmd' detect --json src/app/page.tsx src/app/layout.tsx src/app/globals.css src/components/study-example.tsx
```

Exit 0; result `[]` (no mechanical source findings). This is a source audit, not a rendered-browser or acceptance pass.

Executed on 2026-11-11:

- `pnpm test:e2e tests/e2e/smoke.spec.ts`: **10 passed (17.0s)**, exit 0. Both desktop and 360px projects checked real navigation targets, supplied public tuition, absence of confidential field names in HTML, binary-search transitions, native FAQ, keyboard skip-link focus, body sizing, horizontal overflow, RTL layout, and lazy 3D loading.
- `pnpm typecheck`: exit 0 after the accent was implemented. The coordinating agent subsequently executed `pnpm check`: lint, typecheck, 46 unit tests, 14 integration tests, 10 browser tests and production build all passed, exit 0.
- Official Playwright CLI 0.1.24, named session `git-tutor-ui`, browser `msedge`: desktop 1440px, mobile 360px, RTL mobile and 720px reflow captured and inspected. Console inspection found **0 errors and 0 warnings** after the favicon fix. Current application, font and lazy 3D requests returned HTTP 200 and remained local. No live provider calls were made.
- Captures: `.impeccable/review/desktop.png`, `mobile.png`, `mobile-rtl.png`, `reflow-720.png`, and `footer-accent.png`. Capture script: `.impeccable/final-review.code.txt`. The 720px view is a reflow check, not evidence of actual browser 200% zoom.

Review fixes: supplied a local text favicon to remove its initial 404; raised paragraph copy to the specified minimum; retained logical CSS and visible keyboard focus; made all navigation targets resolve; made the nonessential WebGL accent static, lazy and resilient to loading/context failure. The final mobile and footer captures were visually reviewed: text and tuition fit, controls remain readable, and the accent stays subordinate to the footer action. Development screenshots contain Next.js's development indicator; it is not application UI.

Earlier setup attempts are not acceptance failures or passes: the first test command was cancelled during dependency bootstrap, with no tests executed; the next failed because Chromium was absent. `pnpm exec playwright install chromium` completed, and subsequent browser runs passed (initially 6 tests, then the final 10).

This is T01 public-shell evidence. Full GT-1601 acceptance, real 200% zoom, complete accessibility/release audits, role-specific portal journeys and booking walkthroughs remain with later milestones. No booking functionality is claimed by this shell.

## Bounded tourism accent

Implemented a small, decorative Giza-inspired limestone sculpture in `src/components/giza-accent.tsx` and `src/components/giza-model.ts`. It is loaded near the footer, uses no animation loop or interaction listeners, is hidden from assistive technology, and caps pixel density at 1.5. The actual browser render contains 18 courses and 216 triangles. The typed model factory owns named parts and resource disposal. It is a stylized study of the reference, not an archaeological reconstruction.

Reference: [Kheops-Pyramid.jpg by Nina Aldin Thune, March 2005](https://commons.wikimedia.org/wiki/File:Kheops-Pyramid.jpg), used under [CC BY 2.5](https://creativecommons.org/licenses/by/2.5/). Provenance and observed/inferred features are recorded in `.img2threejs/reference-analysis.md`; the downloaded reference is development evidence, not a shipped photograph. Source installation was used because the official img2threejs CLI documents Windows as unsupported.

Evidence: `.img2threejs/state.json`, `assessment.json`, `giza-sculpt-spec.json`, `reference-admission.json`, `material-report.json`, generated factory evidence in `generated/createGizaModel.ts.txt`, and `.img2threejs/review/angle-0.png`, `angle-90.png`, `angle-180.png`, `angle-270.png`. The application uses the lean typed factory above; the generic generated factory is retained only as evidence. Solid matte material is intentional; extracted photographic maps are not loaded by the app.

Executed checks: reference admission passed; strict sculpt-spec validation passed; extracted material confidence was 0.829; the four-angle turntable gate passed with no missing azimuths, detected holes or collapsed views; multi-angle diagnostics reported nondegenerate views. The reference/render interior-difference measurement was 0.1791 and is a measurement, not a quality pass. Render inspection confirmed a coherent stepped silhouette and visible course structure. Final browser checks verified deferred initialization and a rendered canvas.

**Full img2threejs photo-fidelity acceptance is incomplete.** The following executed diagnostic returned `passed: false`:

```powershell
python C:\Users\barak\.codex\skills\img2threejs\forge\stage4_review\diagnose_render.py --reference .img2threejs/references/kheops-pyramid.jpg --render .img2threejs/review/angle-0.png --spec .img2threejs/giza-sculpt-spec.json --pass-id blockout --in-place --json
```

Measured silhouette IoU 0.299 (required 0.85), aspect-ratio delta 0.3451 (limit 0.05), scale delta 0.4595 (limit 0.08); a map-stripped comparison render was also absent. The photo has scenery and a different camera/framing from the bounded stylized miniature. These failures are retained; no staged pipeline completion, fabricated review score or full reference match is recorded. The state deliberately remains active. Final mesh self-intersection, attachment-anchor, part-coverage and complete staged emission gates have not been executed. The accent has bounded application-render evidence, while those skill-specific quality gates remain open.
