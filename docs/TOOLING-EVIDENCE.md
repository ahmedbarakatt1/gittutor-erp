# Requested tooling acquisition evidence

Recorded 2026-11-11 (Africa/Cairo). Acquisition and capability checks below were executed. They are **not application acceptance results**. Application browser, accessibility, booking and 3D render evidence belongs in the owning task's verification record after those checks run.

## Acquired versions and paths

| Resource | Verified source/version | Installed skill or executable | Result |
|---|---|---|---|
| Playwright Agent CLI | Official [`microsoft/playwright-cli`](https://github.com/microsoft/playwright-cli), npm `@playwright/cli@0.1.24` | Global executable `playwright-cli`; package root `C:/nvm4w/nodejs/node_modules/@playwright/cli`; skill `C:/Users/barak/.agents/skills/playwright-cli/SKILL.md` | Installed; version and help executed successfully; full agent skill read |
| Taste Skill | [`Leonxlnx/taste-skill`](https://github.com/Leonxlnx/taste-skill/tree/3c7017d636c3a4aad378433ea6d0cfa6c921da4a), revision `3c7017d636c3a4aad378433ea6d0cfa6c921da4a`, `skills/taste-skill` | `C:/Users/barak/.codex/skills/design-taste-frontend/SKILL.md` | Installed with the exact requested frontmatter name `design-taste-frontend` |
| Impeccable | Existing official Codex plugin package `4.3.1`, [upstream](https://github.com/pbakaus/impeccable); bundled launcher engine pin `0.1.5` | `C:/Users/barak/.codex/plugins/cache/openai-curated-remote/impeccable/4.3.1/skills/impeccable/SKILL.md` | Existing installation preserved; skill read and context command executed successfully |
| img2threejs base skill | [Direct repository link from img2threejs.io](https://img2threejs.io/) → [`img2threejs/img2threejs`](https://github.com/img2threejs/img2threejs/tree/0c0c49bc168e648dbaf9c8c080474de0b3a941b6), skill `2.0.1`, revision `0c0c49bc168e648dbaf9c8c080474de0b3a941b6` | `C:/Users/barak/.codex/skills/img2threejs/SKILL.md` | Full pinned base repository installed; Python state/next entrypoint help checks pass |

The Taste upstream default is now `taste-skill` 2.5.1. The named resource requested in this project is the preceding `design-taste-frontend` skill, so installation uses the final pre-v2 source revision with that name instead of silently substituting the renamed, substantially changed kit. Its public-page art-direction guidance is applicable to the customer website; its own scope excludes dashboards. Use Impeccable's **Operate** guidance for staff portals while preserving shared brand tokens.

The img2threejs [installer documentation](https://github.com/img2threejs/img2threejs/blob/0c0c49bc168e648dbaf9c8c080474de0b3a941b6/docs/INSTALL.md) says its Node installer does not support Windows. This machine runs Windows, so acquisition used the trusted Codex skill installer to copy the complete pinned base repository into the Codex skill directory. No symlinks, global Python aliases, optional domain plugins or harness installs were introduced. Its Python 3.10+ standard-library core accepts native `python` here (Python 3.11.1); generic and character profiles are available. This validates entrypoint availability only, not full rendering or reconstruction fidelity.

## Executed commands and results

All commands ran from PowerShell. The following acquisition commands exited successfully:

```powershell
node --version
# v22.22.2
npm --version
# 10.9.7
python --version
# Python 3.11.1
npm view @playwright/cli version repository dist.integrity --json
# version 0.1.24; repository microsoft/playwright-cli
npm install -g @playwright/cli@0.1.24
# added 3 packages
playwright-cli --version
# 0.1.24
playwright-cli install --help
playwright-cli install --skills=agents -g
# Skill installed to C:\Users\barak\.agents\skills\playwright-cli
playwright-cli open --help
python 'C:\Users\barak\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py' --repo Leonxlnx/taste-skill --ref 3c7017d636c3a4aad378433ea6d0cfa6c921da4a --path skills/taste-skill --name design-taste-frontend
# Installed design-taste-frontend
python 'C:\Users\barak\.codex\skills\.system\skill-installer\scripts\install-skill-from-github.py' --repo img2threejs/img2threejs --ref 0c0c49bc168e648dbaf9c8c080474de0b3a941b6 --path . --name img2threejs
# Installed img2threejs
python 'C:\Users\barak\.codex\skills\img2threejs\forge\state.py' init --help
# --profile {generic,character}
python 'C:\Users\barak\.codex\skills\img2threejs\forge\next.py' --help
# State-driven next-command interface available
& 'C:\Users\barak\.codex\plugins\cache\openai-curated-remote\impeccable\4.3.1\skills\impeccable\scripts\impeccable.cmd' context --target src/app
# exit 0; project D:\GitTutor System resolved
```

Impeccable context reported no existing `PRODUCT.md`, `DESIGN.md` or target implementation at acquisition time. Its instruction was to use `reference/init.md`, then `reference/new-work.md`, read `reference/craft-floor.md` immediately before editing, and run the mechanical detector once after completed UI edits. It detected ffmpeg as the available image converter. No context reload is needed during this session. The launcher reported newer skill 4.8.2 available; the loaded 4.3.1 installation was intentionally preserved during the active task.

The npm CLI package integrity returned by the registry was:

```text
sha512-AIO0AiPHh1ZB9e+i+ZiRwSTfqlkJtWcojgtPnW/BbBCgr96OojlL15dc1jWWclfbjdwPv5900qxuDyEHghjSqw==
```

`Get-FileHash -Algorithm SHA256` results:

| Installed SKILL.md | SHA-256 |
|---|---|
| Playwright | `B07A6CBE4E5B638046FE0B9DF0E84783CB9899F0AED3DB1EEF915601C3260A64` |
| Taste | `AA194351B246B8B4799099D4ED7B033D29EAB6E6E3D58D8D2172978BE7B3EC89` |
| Impeccable | `5CE02FC8F353D7F659535FB80E453963DC047A07C4396ADF098FE010B479E7C0` |
| img2threejs | `3CEDF8A1901E69C58F698529FCCFC42A61E03FB944721D62BDB28E1444EF3808` |

## Application evidence to record when executed

- **Playwright CLI:** use named, isolated sessions for role boundaries; record session names, routes, viewports, screenshots, console and request inspection. `console`, `requests`, `request <id>`, `screenshot --filename=...`, and `tab-new --isolated-context=...` are supported by the installed version. Application walkthroughs have not been executed by this acquisition task.
- **Taste:** load the installed skill before visual implementation. Record the inferred art direction and dial choices against the red, ink and warm-ivory UI specification, with the browser review/fix log. Do not imply skill installation itself proves visual quality.
- **Impeccable:** record critique/audit findings, responsive and keyboard/accessibility evidence, resolved defects and any remaining limitations. Use its Persuade mode for the public site and Operate mode for staff workspaces; the supplied brief has precedence over generic aesthetics.
- **img2threejs:** obtain a real, suitable tourism reference with provenance; record a bounded stylized approximation, generic profile, local state and sculpt spec. Run `forge/next.py` at each start/resume and correction, and use per-pass rendered screenshots compared with the reference. Save the TypeScript model factory source. Availability of the base skill does not satisfy these reconstruction gates.

New user-level skills become automatically discoverable on the next turn; agents in this active implementation can read the explicit installed paths immediately. No live-provider settings or application dependencies were changed by this acquisition task.
