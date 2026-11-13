# Instagram brand integration — 13 November 2026

The user authorized the Git Tutor Instagram account as the visual reference and requested its actual logo. Source: [@gittutor](https://www.instagram.com/gittutor/). The public profile was inspected in Edge using official `@playwright/cli` 0.1.24, session `git-tutor-brand`. Its login overlay was dismissed without signing in. The reference capture is retained privately at `.local/screenshots/instagram-brand-reference.png`.

## Asset provenance

- Local asset: `public/brand/git-tutor-instagram.jpg`.
- Original public profile image, unchanged JPEG, 150 × 150 pixels. No reconstruction or generated replacement.
- Browser-observed CDN filename: `597895707_17844153162621475_2363585192106335381_n.jpg`.
- SHA-256: `16f03f4924b462367f2524d5019694c2a00ff301cebffc86bcd29712a821a566`.
- Expiring CDN URL is retained only in ignored `.local/instagram-logo-source.txt`; the application serves its local asset and does not depend on Instagram availability.
- The available image is a small profile JPEG, suitable for its displayed 60–88px size. No high-resolution/vector original is claimed.

The observed design references include the pinned posts [Dcv7vgVCEUy](https://www.instagram.com/gittutor/p/Dcv7vgVCEUy/), [DboK_9KCNHY](https://www.instagram.com/gittutor/p/DboK_9KCNHY/) and [DaaJaKUiP2h](https://www.instagram.com/gittutor/p/DaaJaKUiP2h/). No student or tutor photographs were copied.

## Applied design

The original graduation-cap mark replaces the substitute wordmark on the homepage, catalog, authentication, support, teaching application and all portal shells, and supplies the favicon. Its light-gray background is preserved. Red/charcoal identity, warm cream surfaces and a bounded yellow headline highlight follow the profile's observed palette. The public pages retain their expressive headings; operational portals retain compact navigation and task-focused forms. The existing subject taxonomy, accessible labels, customer pricing projection and confidential portal boundaries are preserved.

## Tooling and executed review

- Taste loaded: `C:/Users/barak/.codex/skills/design-taste-frontend/SKILL.md`; applied its existing-design refinement and preflight guidance.
- Impeccable 4.3.1 loaded: `C:/Users/barak/.codex/plugins/cache/openai-curated-remote/impeccable/4.3.1/skills/impeccable/SKILL.md`. Target context and craft-floor review executed; changed-target detector returned `[]` (exit 0), retained in `docs/evidence/brand-detect.json`.
- Official Playwright CLI skill: `C:/Users/barak/.agents/skills/playwright-cli/SKILL.md`; version 0.1.24. Browser sessions: `git-tutor-brand` for the reference, `git-tutor-preview` for the application review.
- Next's installed local Image guide was read before implementing the shared component. No dependency versions changed.
- `pnpm typecheck`, scoped ESLint and `pnpm build` passed. Logs: `docs/evidence/brand-{types,lint,build}.log`.
- `pnpm exec playwright test tests/e2e/smoke.spec.ts tests/e2e/subjects.spec.ts --output=.local/test-results-brand`: **12/12 passed**, 1.1 minutes. Log: `docs/evidence/brand-browser-tests.log`.
- Browser review: home, subjects, login, support and apply-to-teach at 1440×1000 and 360×780. All ten states loaded the original asset; no horizontal overflow, console warnings/errors, page errors or HTTP responses ≥400. Body text remained 16px. Report: `docs/evidence/brand-inspection.json`.
- The first subjects screenshot caught its loading state; the final run waited for the rendered heading before capture. Final home desktop/mobile, login mobile and subjects desktop were visually inspected. Portable captures: `docs/evidence/brand-home-desktop.png`, `brand-home-mobile.png`, `brand-subjects-desktop.png`; remaining captures are in `.local/screenshots/`.

The previously implemented bounded Three.js accent and its img2threejs reference/model evidence are unchanged. This pass does not claim a new 3D build or formal accessibility certification.
