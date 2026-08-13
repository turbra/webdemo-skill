<h1 align="center">webdemo-skill</h1>

<p align="center">
  <strong>Record repeatable desktop and mobile website demos from a headless browser.</strong>
</p>

<p align="center">
  <a href="#install">Install</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#demo-plan">Demo Plan</a> •
  <a href="#output">Output</a> •
  <a href="#requirements">Requirements</a>
</p>

---

A Codex skill that turns a small JSON walkthrough plan into a shareable website demo. It drives Chromium with Playwright, records desktop and mobile segments, combines them with FFmpeg, verifies the final MP4, and generates a contact sheet for visual review.

## Install

Clone the repository into the personal Codex skills directory:

```sh
git clone https://github.com/turbra/webdemo-skill.git ~/.codex/skills/automated-site-demo
```

Start a fresh Codex session after installation so the skill registry is rebuilt.

The first recording installs the pinned Playwright package inside the skill and downloads its Chromium build into Playwright's user cache. Generated dependencies and recordings are ignored by Git.

## Quick Start

From a website project, ask Codex:

```text
Use $automated-site-demo to record a polished desktop and mobile walkthrough of this site.
```

Codex inspects the project, creates a site-specific plan, runs the recorder, validates the MP4, and visually checks the generated contact sheet.

To run the recorder directly, copy the template and adjust its selectors and actions:

```sh
cp ~/.codex/skills/automated-site-demo/assets/demo-plan.template.json ./demo-plan.json

bash ~/.codex/skills/automated-site-demo/scripts/record_site_demo.sh \
  --plan ./demo-plan.json \
  --site-root .
```

For an application already running locally or remotely, use `--base-url` instead of `--site-root`:

```sh
bash ~/.codex/skills/automated-site-demo/scripts/record_site_demo.sh \
  --plan ./demo-plan.json \
  --base-url http://127.0.0.1:3000
```

## Demo Plan

Each segment declares a viewport, starting route, presentation mode, and ordered browser actions. The runner supports:

| Action | Purpose |
|--------|---------|
| `chapter` | Add a short title overlay |
| `goto` | Navigate to another route |
| `hover` | Show a control's hover state |
| `click` | Activate a link, button, tab, or carousel control |
| `scroll` | Smoothly reveal a target element |
| `scrollTop` | Return to the top of the page |
| `horizontalScroll` | Demonstrate rails and mobile navigation |
| `fill` | Enter non-sensitive demonstration text |
| `press` | Send a keyboard action |
| `select` | Choose a form option |
| `wait` | Add a deliberate pause |

See the [demo plan reference](references/demo-plan.md) for the complete schema and examples.

Validate a plan without installing Chromium:

```sh
bash scripts/record_site_demo.sh \
  --plan ./demo-plan.json \
  --validate
```

Value options accept both `--option value` and `--option=value`. Run
`bash scripts/record_site_demo.sh --help` for the complete CLI reference.

## Output

Each run creates timestamped files in `demo-output/`:

- an H.264-compatible MP4 when the local FFmpeg build supports it
- a nine-frame JPEG contact sheet

The runner verifies that every planned browser action succeeds, fully decodes the finished video, and checks its duration, dimensions, codec, and pixel format with FFprobe.

Videos are silent by default. Add narration, captions, music, or additional branding only when the publishing context requires them.

## Requirements

- Node.js and npm
- FFmpeg and FFprobe
- Linux, macOS, or Windows with a Bash environment

The recorder can serve static files itself. Framework applications should use their existing development or preview command and pass the resulting URL with `--base-url`.

## Development

Run the CLI regression suite before publishing changes:

```sh
npm --prefix scripts test
```

## Safety

Do not place credentials, tokens, personal data, private customer information, or internal-only URLs in a demo plan. Avoid actions that submit forms, create records, make purchases, or change remote state unless that behavior is explicitly authorized and uses sanitized fixtures.
