---
name: automated-site-demo
description: Create, record, update, and verify repeatable browser walkthrough videos for websites and web applications using Playwright and FFmpeg. Use when a user asks for an automated site demo, product-tour video, headless browser capture, desktop and mobile walkthrough, shareable UI demo artifact, or a web-interface equivalent to asciinema.
---

# Automated Site Demo

Create a deterministic browser walkthrough from a small JSON plan. Use the bundled runner instead of rewriting Playwright and FFmpeg orchestration for each site.

## Workflow

1. Read the target repository guidance and inspect the worktree.
2. Identify the authoritative start or build command. Do not invent a second lifecycle.
3. Confirm the walkthrough will not expose credentials, private data, internal hostnames, or destructive controls.
4. Inspect the rendered routes and choose representative interactions. Prefer stable IDs, roles, labels, and durable component classes over layout-dependent selectors.
5. Read [references/demo-plan.md](references/demo-plan.md), then copy [assets/demo-plan.template.json](assets/demo-plan.template.json) to a temporary or repo-approved location and customize it.
6. Validate the plan before launching a browser:

   ```bash
   bash scripts/record_site_demo.sh --plan /absolute/path/demo-plan.json --validate
   ```

7. Record using one of these modes:

   - Static files or a built output directory:

     ```bash
     bash scripts/record_site_demo.sh \
       --plan /absolute/path/demo-plan.json \
       --site-root /absolute/path/to/site
     ```

   - An existing development, preview, or deployed server:

     ```bash
     bash scripts/record_site_demo.sh \
       --plan /absolute/path/demo-plan.json \
       --base-url http://127.0.0.1:3000
     ```

8. Inspect the generated contact sheet with an image-viewing tool. Sample the first frame, a transition, and the last frame when the contact sheet is ambiguous.
9. Report the absolute MP4 path, duration, resolution, codec, size, and whether audio is present. State any skipped routes or unverified interactions.

## Walkthrough standards

- Target 45 to 90 seconds unless the user specifies otherwise.
- Include desktop and mobile segments for responsive sites.
- Start each segment only after its initial page and images settle.
- Show the primary value proposition, navigation, one or two meaningful interactions, responsive behavior, and a clear closing state.
- Use short chapter overlays to orient viewers.
- Use deliberate pointer movement and pauses. Avoid frantic scrolling or exhaustive route tours.
- Do not submit forms, trigger mail links, create records, make purchases, or change remote state without explicit authorization.
- Use sanitized demo accounts and fixtures when authentication is necessary. Never place secrets in a demo plan.
- Produce a silent MP4 by default. Add narration, music, captions, or branding only when requested and use properly licensed material.

## Operating modes

For static sites, let the runner create its temporary loopback server. For framework projects, use the repository's existing dev or preview command and pass its URL. For a deployed preview, verify the exact target first and pass that URL.

Keep generated videos out of source control by default. If the user wants the workflow retained in the repository, add the plan and a thin package/task wrapper using existing project conventions, ignore the output directory, and do not copy the bundled recorder.

## Validation requirements

The runner must complete all built-in gates:

- every planned selector and action succeeds;
- raw segments are encoded into an H.264-compatible MP4 when available;
- the final file fully decodes through FFmpeg;
- FFprobe confirms dimensions, duration, pixel format, and codec;
- a nine-frame contact sheet is generated.

Do not claim a usable demo from file existence alone. Visually inspect the contact sheet before handoff.

## Dependencies

Require Node.js, npm, FFmpeg, and FFprobe. On first recording, the launcher installs the pinned Playwright package under this skill and its isolated Chromium build in Playwright's user cache. Validation-only runs do not install the browser runtime.
