# Demo plan reference

## Contents

- Plan structure
- Segment structure
- Locator fields
- Supported actions
- Recording guidance
- Example commands

## Plan structure

Create one JSON document:

```json
{
  "name": "Example product website",
  "slug": "example-product-demo",
  "siteRoot": ".",
  "output": {
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "background": "#111827"
  },
  "segments": []
}
```

Fields:

- `name`: Human-readable demo name.
- `slug`: Safe filename stem containing lowercase letters, digits, and hyphens.
- `siteRoot`: Optional static-site root, resolved relative to the plan. CLI `--site-root` overrides it.
- `baseUrl`: Optional running-site URL. CLI `--base-url` overrides it.
- `output`: Optional final video settings. Defaults to 1920 by 1080 at 30 fps on a dark background.
- `cursor`: Set to `false` to suppress the visible demonstration pointer.
- `failOnPageError`: Set to `true` to fail when the page emits an uncaught JavaScript error.
- `segments`: One or more ordered recordings.

## Segment structure

```json
{
  "name": "Desktop overview",
  "viewport": { "width": 1920, "height": 1080 },
  "presentation": "fit",
  "startPath": "/",
  "readySelector": "main",
  "settleMs": 700,
  "actions": []
}
```

- `viewport`: Browser viewport for the segment.
- `presentation`: Use `fit` for ordinary layouts or `phone` to center a portrait capture with an inset margin.
- `startPath`: Relative path or absolute URL loaded before recording starts.
- `readySelector`: Optional selector that must be visible before recording.
- `settleMs`: Optional pause after page preparation.
- `actions`: Ordered browser actions.

## Locator fields

Actions that target an element accept:

- `selector`: Required CSS selector.
- `text`: Optional visible-text filter.
- `nth`: Optional zero-based match index. Defaults to the first match.
- `timeout`: Optional timeout in milliseconds.

Prefer unique, semantic selectors. Do not use generated class hashes when an accessible label, role-related attribute, ID, or stable component class exists.

## Supported actions

### Chapter

```json
{
  "type": "chapter",
  "title": "Reporting",
  "description": "Dashboard metrics and filters",
  "duration": 1200
}
```

### Wait

```json
{ "type": "wait", "ms": 800 }
```

### Navigate

```json
{ "type": "goto", "path": "/pricing", "settleMs": 700 }
```

### Hover

```json
{
  "type": "hover",
  "selector": ".service-link",
  "text": "Features",
  "pause": 600
}
```

### Click

```json
{
  "type": "click",
  "selector": ".service-link",
  "text": "Pricing",
  "waitForUrl": "pricing",
  "pause": 700
}
```

Use `waitForUrl` when a click navigates. It is matched as a substring of the resulting URL. Set `waitForLoad` to `true` when the page stays on the same URL but reloads resources.

### Scroll to an element

```json
{
  "type": "scroll",
  "selector": ".testimonial",
  "block": "center",
  "pause": 1500
}
```

`block` accepts `start`, `center`, `end`, or `nearest`.

### Scroll to the page top

```json
{ "type": "scrollTop", "pause": 1000 }
```

### Scroll a horizontal rail

```json
{
  "type": "horizontalScroll",
  "selector": ".service-links",
  "position": "end",
  "pause": 1200
}
```

`position` accepts `start`, `end`, or a pixel number.

### Fill a non-sensitive field

```json
{
  "type": "fill",
  "selector": "input[name=search]",
  "value": "sample query",
  "pause": 500
}
```

Never store credentials, personal data, access tokens, or private customer information in a plan.

### Press a key

```json
{
  "type": "press",
  "selector": "input[name=search]",
  "key": "Enter",
  "pause": 700
}
```

### Select an option

```json
{
  "type": "select",
  "selector": "select[name=region]",
  "value": "ca",
  "pause": 700
}
```

## Recording guidance

- Use two to six chapters total.
- Keep most pauses between 500 and 1800 milliseconds.
- Show hover states once, not on every control.
- Keep a mobile segment focused on responsive behavior that is materially different from desktop.
- Avoid recording loading failures, analytics consent prompts, browser chrome, or terminal output.
- Use a temporary plan when the user wants only the video. Retain the plan in the repository only when repeatability is part of the requested deliverable.

## Example commands

The runner accepts both `--option value` and `--option=value` forms. Use
`bash scripts/record_site_demo.sh --help` to list every option.

Validate without installing Chromium:

```bash
bash scripts/record_site_demo.sh --plan /tmp/site-demo.json --validate
```

Record static files:

```bash
bash scripts/record_site_demo.sh \
  --plan /tmp/site-demo.json \
  --site-root /workspace/site \
  --output-dir /workspace/site/demo-output
```

Record a running application:

```bash
bash scripts/record_site_demo.sh \
  --plan /tmp/site-demo.json \
  --base-url http://127.0.0.1:4173
```
