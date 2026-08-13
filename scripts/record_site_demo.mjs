import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';

const supportedActions = new Set([
  'chapter',
  'click',
  'fill',
  'goto',
  'horizontalScroll',
  'hover',
  'press',
  'scroll',
  'scrollTop',
  'select',
  'wait',
]);

const options = parseOptions(process.argv.slice(2));
const planPath = resolve(options.plan);
const planDirectory = dirname(planPath);
const plan = JSON.parse(await readFile(planPath, 'utf8'));
validatePlan(plan);

if (options.validate) {
  console.log(`Demo plan is valid: ${planPath}`);
  process.exit(0);
}

const output = {
  background: plan.output?.background ?? '#111827',
  fps: plan.output?.fps ?? 30,
  height: plan.output?.height ?? 1080,
  width: plan.output?.width ?? 1920,
};
const outputDirectory = options.outputDir
  ? resolve(options.outputDir)
  : resolve(planDirectory, 'demo-output');
const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const outputPath = join(outputDirectory, `${plan.slug}-${timestamp}.mp4`);
const contactSheetPath = join(outputDirectory, `${plan.slug}-${timestamp}-contact-sheet.jpg`);
const temporaryDirectory = await mkdtemp(join(tmpdir(), `${plan.slug}-`));

let browser;
let localServer;
let completed = false;

try {
  await mkdir(outputDirectory, { recursive: true });

  const explicitBaseUrl = options.baseUrl ?? plan.baseUrl;
  const siteRoot = resolveSiteRoot(options.siteRoot ?? plan.siteRoot ?? '.');
  const baseUrl = explicitBaseUrl?.replace(/\/$/, '') ?? await startStaticServer(siteRoot, plan.server?.spaFallback === true);
  await assertSiteAvailable(baseUrl, plan.segments[0].startPath);

  const { chromium } = await import('playwright');
  browser = await chromium.launch({ headless: true });

  const rawSegments = [];
  for (const [index, segment] of plan.segments.entries()) {
    console.log(`Recording ${index + 1}/${plan.segments.length}: ${segment.name}`);
    const rawPath = join(temporaryDirectory, `${String(index + 1).padStart(2, '0')}.webm`);
    await recordSegment(browser, baseUrl, plan, segment, rawPath);
    rawSegments.push({
      duration: probeDuration(rawPath),
      path: rawPath,
      presentation: segment.presentation ?? 'fit',
    });
  }

  console.log('Encoding MP4');
  encodeVideo(rawSegments, output, outputPath);
  verifyVideo(outputPath, output);
  createContactSheet(outputPath, contactSheetPath, output.background);

  const outputStats = await stat(outputPath);
  const media = probeMedia(outputPath);
  completed = true;

  console.log(`Demo ready: ${outputPath}`);
  console.log(`Contact sheet: ${contactSheetPath}`);
  console.log(`Duration: ${media.duration.toFixed(1)} seconds`);
  console.log(`Video: ${media.codec} ${media.width}x${media.height} ${media.pixelFormat}`);
  console.log(`Size: ${(outputStats.size / 1024 / 1024).toFixed(1)} MB`);
} finally {
  await browser?.close();
  await closeServer(localServer);
  if (completed || options.discardFailed) {
    await rm(temporaryDirectory, { recursive: true, force: true });
  } else {
    console.error(`Raw captures retained after failure: ${temporaryDirectory}`);
  }
}

function parseOptions(argumentsList) {
  const parsed = {};

  for (const argument of argumentsList) {
    if (argument === '--validate') parsed.validate = true;
    else if (argument === '--discard-failed') parsed.discardFailed = true;
    else if (argument.startsWith('--plan=')) parsed.plan = argument.slice('--plan='.length);
    else if (argument.startsWith('--base-url=')) parsed.baseUrl = argument.slice('--base-url='.length);
    else if (argument.startsWith('--site-root=')) parsed.siteRoot = argument.slice('--site-root='.length);
    else if (argument.startsWith('--output-dir=')) parsed.outputDir = argument.slice('--output-dir='.length);
    else throw new Error(`Unknown option: ${argument}`);
  }

  if (!parsed.plan) throw new Error('Pass an absolute or relative plan path with --plan=<path>.');
  return parsed;
}

function validatePlan(candidate) {
  const errors = [];

  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) errors.push('Plan must be a JSON object.');
  if (typeof candidate?.name !== 'string' || !candidate.name.trim()) errors.push('name must be a non-empty string.');
  if (typeof candidate?.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidate.slug)) {
    errors.push('slug must contain lowercase letters, digits, and single hyphens.');
  }
  if (!Array.isArray(candidate?.segments) || candidate.segments.length === 0) errors.push('segments must contain at least one segment.');

  for (const [segmentIndex, segment] of (candidate?.segments ?? []).entries()) {
    const prefix = `segments[${segmentIndex}]`;
    if (typeof segment.name !== 'string' || !segment.name.trim()) errors.push(`${prefix}.name must be a non-empty string.`);
    if (!positiveInteger(segment.viewport?.width) || !positiveInteger(segment.viewport?.height)) {
      errors.push(`${prefix}.viewport must have positive integer width and height.`);
    }
    if (segment.presentation && !['fit', 'phone'].includes(segment.presentation)) {
      errors.push(`${prefix}.presentation must be fit or phone.`);
    }
    if (typeof segment.startPath !== 'string' || !segment.startPath.trim()) errors.push(`${prefix}.startPath must be a non-empty string.`);
    if (!Array.isArray(segment.actions)) errors.push(`${prefix}.actions must be an array.`);

    for (const [actionIndex, action] of (segment.actions ?? []).entries()) {
      const actionPrefix = `${prefix}.actions[${actionIndex}]`;
      if (!supportedActions.has(action.type)) errors.push(`${actionPrefix}.type is unsupported: ${action.type}`);
      if (['click', 'fill', 'horizontalScroll', 'hover', 'press', 'scroll', 'select'].includes(action.type)
          && (typeof action.selector !== 'string' || !action.selector.trim())) {
        errors.push(`${actionPrefix}.selector must be a non-empty string.`);
      }
      if (action.type === 'chapter' && (typeof action.title !== 'string' || !action.title.trim())) {
        errors.push(`${actionPrefix}.title must be a non-empty string.`);
      }
      if (action.type === 'goto' && (typeof action.path !== 'string' || !action.path.trim())) {
        errors.push(`${actionPrefix}.path must be a non-empty string.`);
      }
      if (action.type === 'wait' && !nonNegativeNumber(action.ms)) errors.push(`${actionPrefix}.ms must be a non-negative number.`);
      if (action.type === 'fill' && typeof action.value !== 'string') errors.push(`${actionPrefix}.value must be a string.`);
      if (action.type === 'press' && typeof action.key !== 'string') errors.push(`${actionPrefix}.key must be a string.`);
      if (action.type === 'select' && typeof action.value !== 'string') errors.push(`${actionPrefix}.value must be a string.`);
      if (action.type === 'horizontalScroll'
          && !['start', 'end'].includes(action.position)
          && !Number.isFinite(action.position)) {
        errors.push(`${actionPrefix}.position must be start, end, or a pixel number.`);
      }
    }
  }

  if (candidate.output) {
    for (const field of ['width', 'height', 'fps']) {
      if (candidate.output[field] !== undefined && !positiveInteger(candidate.output[field])) {
        errors.push(`output.${field} must be a positive integer.`);
      }
    }
    if (candidate.output.background !== undefined
        && (typeof candidate.output.background !== 'string' || !/^#[0-9a-f]{6}$/i.test(candidate.output.background))) {
      errors.push('output.background must be a six-digit hexadecimal color.');
    }
  }

  if (errors.length) throw new Error(`Invalid demo plan:\n- ${errors.join('\n- ')}`);
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function resolveSiteRoot(value) {
  if (isAbsolute(value)) return value;
  return resolve(planDirectory, value);
}

function startStaticServer(siteRoot, spaFallback) {
  return new Promise((resolveUrl, reject) => {
    localServer = createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
        const requestPath = decodeURIComponent(requestUrl.pathname);
        const relativePath = requestPath.endsWith('/') ? `${requestPath}index.html` : requestPath;
        let filePath = resolve(siteRoot, `.${relativePath}`);

        if (filePath !== siteRoot && !filePath.startsWith(`${siteRoot}${sep}`)) {
          response.writeHead(403).end('Forbidden');
          return;
        }

        let fileStats;
        try {
          fileStats = await stat(filePath);
        } catch (error) {
          if (!spaFallback) throw error;
          filePath = resolve(siteRoot, 'index.html');
          fileStats = await stat(filePath);
        }
        if (!fileStats.isFile()) throw new Error('Not a file');

        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Type': mimeType(filePath),
        });
        createReadStream(filePath).pipe(response);
      } catch {
        response.writeHead(404).end('Not found');
      }
    });

    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', () => {
      const address = localServer.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to determine the local server address.'));
        return;
      }
      resolveUrl(`http://127.0.0.1:${address.port}`);
    });
  });
}

function mimeType(filePath) {
  return ({
    '.avif': 'image/avif',
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpeg': 'image/jpeg',
    '.jpg': 'image/jpeg',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  })[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

async function assertSiteAvailable(baseUrl, startPath) {
  const response = await fetch(new URL(startPath, `${baseUrl}/`));
  if (!response.ok) throw new Error(`The site returned HTTP ${response.status}: ${response.url}`);
}

async function recordSegment(browserInstance, baseUrl, candidatePlan, segment, videoPath) {
  const context = await browserInstance.newContext({
    colorScheme: 'light',
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    viewport: segment.viewport,
  });
  if (candidatePlan.cursor !== false) await context.addInitScript(installDemoCursor);

  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  let recording = false;
  try {
    await preparePage(page, new URL(segment.startPath, `${baseUrl}/`).href, segment);
    await page.screencast.start({ path: videoPath, size: segment.viewport });
    recording = true;

    for (const action of segment.actions) {
      await executeAction(page, baseUrl, segment, action);
    }

    await page.screencast.stop();
    recording = false;
  } finally {
    if (recording) await page.screencast.stop().catch(() => {});
    await context.close();
  }

  if (pageErrors.length) {
    const message = `Page errors during ${segment.name}:\n- ${pageErrors.join('\n- ')}`;
    if (candidatePlan.failOnPageError === true) throw new Error(message);
    console.warn(message);
  }
}

function installDemoCursor() {
  const mountCursor = () => {
    const cursor = document.createElement('div');
    cursor.id = 'automated-site-demo-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    Object.assign(cursor.style, {
      background: '#ffffff',
      border: '2px solid #111827',
      borderRadius: '50%',
      boxShadow: '0 2px 8px rgba(18, 27, 21, .38)',
      height: '18px',
      left: '0',
      opacity: '0',
      pointerEvents: 'none',
      position: 'fixed',
      top: '0',
      transform: 'translate(-50%, -50%)',
      transition: 'opacity 120ms ease',
      width: '18px',
      zIndex: '2147483647',
    });
    document.body.append(cursor);

    document.addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`;
      cursor.style.top = `${event.clientY}px`;
      cursor.style.opacity = '1';
    });

    document.addEventListener('mousedown', (event) => {
      const ring = document.createElement('div');
      Object.assign(ring.style, {
        border: '3px solid #2563eb',
        borderRadius: '50%',
        height: '28px',
        left: `${event.clientX}px`,
        pointerEvents: 'none',
        position: 'fixed',
        top: `${event.clientY}px`,
        transform: 'translate(-50%, -50%)',
        width: '28px',
        zIndex: '2147483646',
      });
      document.body.append(ring);
      ring.animate([
        { opacity: 1, transform: 'translate(-50%, -50%) scale(.65)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
      ], { duration: 520, easing: 'ease-out' }).finished.finally(() => ring.remove());
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountCursor, { once: true });
  else mountCursor();
}

async function preparePage(page, url, segment) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 10000 }).catch(() => {});
  if (segment.readySelector) await page.locator(segment.readySelector).waitFor({ state: 'visible' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(segment.settleMs ?? 700);
}

async function executeAction(page, baseUrl, segment, action) {
  const pause = action.pause ?? 600;

  switch (action.type) {
    case 'chapter':
      await page.screencast.showChapter(action.title, {
        description: action.description,
        duration: action.duration ?? 1100,
      });
      await page.waitForTimeout((action.duration ?? 1100) + 200);
      break;
    case 'wait':
      await page.waitForTimeout(action.ms);
      break;
    case 'goto':
      await preparePage(page, new URL(action.path, `${baseUrl}/`).href, {
        ...segment,
        readySelector: action.readySelector ?? segment.readySelector,
        settleMs: action.settleMs ?? segment.settleMs,
      });
      break;
    case 'scroll': {
      const target = locate(page, action);
      await target.evaluate((element, settings) => {
        element.scrollIntoView({ behavior: 'smooth', block: settings.block, inline: settings.inline });
      }, { block: action.block ?? 'center', inline: action.inline ?? 'nearest' });
      await page.waitForTimeout(pause);
      break;
    }
    case 'scrollTop':
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
      await page.waitForTimeout(pause);
      break;
    case 'horizontalScroll': {
      const target = locate(page, action);
      await target.evaluate((element, position) => {
        const left = position === 'end' ? element.scrollWidth : position === 'start' ? 0 : position;
        element.scrollTo({ left, behavior: 'smooth' });
      }, action.position);
      await page.waitForTimeout(pause);
      break;
    }
    case 'hover': {
      const target = locate(page, action);
      await target.scrollIntoViewIfNeeded();
      await target.hover({ timeout: action.timeout });
      await page.waitForTimeout(pause);
      break;
    }
    case 'click': {
      const target = locate(page, action);
      await target.scrollIntoViewIfNeeded();
      if (action.waitForUrl) {
        await Promise.all([
          page.waitForURL((url) => url.href.includes(action.waitForUrl), { timeout: action.timeout }),
          target.click({ timeout: action.timeout }),
        ]);
        await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 10000 }).catch(() => {});
      } else {
        await target.click({ timeout: action.timeout });
      }
      if (action.waitForLoad) await page.waitForLoadState('networkidle', { timeout: action.timeout ?? 10000 });
      await page.waitForTimeout(pause);
      break;
    }
    case 'fill':
      await locate(page, action).fill(action.value, { timeout: action.timeout });
      await page.waitForTimeout(pause);
      break;
    case 'press':
      await locate(page, action).press(action.key, { timeout: action.timeout });
      await page.waitForTimeout(pause);
      break;
    case 'select':
      await locate(page, action).selectOption(action.value, { timeout: action.timeout });
      await page.waitForTimeout(pause);
      break;
    default:
      throw new Error(`Unsupported action: ${action.type}`);
  }
}

function locate(page, action) {
  let locator = page.locator(action.selector);
  if (action.text !== undefined) locator = locator.filter({ hasText: action.text });
  return locator.nth(action.nth ?? 0);
}

function encodeVideo(segments, outputSettings, destination) {
  const encoder = selectEncoder();
  const encoderOptions = encoder === 'libx264'
    ? ['-c:v', encoder, '-preset', 'medium', '-crf', '19']
    : encoder === 'libopenh264'
      ? ['-c:v', encoder, '-b:v', '8M']
      : ['-c:v', encoder, '-q:v', '2'];

  const filters = segments.map((segment, index) => {
    const targetHeight = segment.presentation === 'phone' ? outputSettings.height - 80 : outputSettings.height;
    const scale = segment.presentation === 'phone'
      ? `scale=-2:${targetHeight}`
      : `scale=${outputSettings.width}:${outputSettings.height}:force_original_aspect_ratio=decrease`;
    const fades = [
      index === 0 ? 'fade=t=in:st=0:d=0.4' : null,
      index === segments.length - 1
        ? `fade=t=out:st=${Math.max(0, segment.duration - 0.5).toFixed(3)}:d=0.5`
        : null,
    ].filter(Boolean).join(',');
    const fadeChain = fades ? `,${fades}` : '';

    return `[${index}:v]fps=${outputSettings.fps},${scale},pad=${outputSettings.width}:${outputSettings.height}:(ow-iw)/2:(oh-ih)/2:color=${outputSettings.background},setsar=1,settb=AVTB,setpts=PTS-STARTPTS${fadeChain},format=yuv420p[s${index}]`;
  });
  const labels = segments.map((_, index) => `[s${index}]`).join('');
  filters.push(segments.length === 1
    ? '[s0]null[video]'
    : `${labels}concat=n=${segments.length}:v=1:a=0,format=yuv420p[video]`);

  const inputArguments = segments.flatMap((segment) => ['-i', segment.path]);
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-y',
    ...inputArguments,
    '-filter_complex', filters.join(';'),
    '-map', '[video]',
    '-an',
    ...encoderOptions,
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    destination,
  ], { encoding: 'utf8' });

  if (result.status !== 0) throw new Error(`FFmpeg failed:\n${result.stderr}`);
}

function selectEncoder() {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') throw new Error('FFmpeg is required.');
  const encoders = `${result.stdout}\n${result.stderr}`;
  if (encoders.includes('libx264')) return 'libx264';
  if (encoders.includes('libopenh264')) return 'libopenh264';
  return 'mpeg4';
}

function probeDuration(videoPath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    videoPath,
  ], { encoding: 'utf8' });
  const duration = Number.parseFloat(result.stdout);
  if (result.status !== 0 || !Number.isFinite(duration)) {
    throw new Error(`Unable to determine video duration:\n${result.stderr}`);
  }
  return duration;
}

function probeMedia(videoPath) {
  const result = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_name,width,height,pix_fmt',
    '-of', 'json',
    videoPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`FFprobe failed:\n${result.stderr}`);
  const data = JSON.parse(result.stdout);
  const video = data.streams?.find((stream) => stream.width && stream.height);
  return {
    codec: video?.codec_name,
    duration: Number.parseFloat(data.format?.duration),
    height: video?.height,
    pixelFormat: video?.pix_fmt,
    width: video?.width,
  };
}

function verifyVideo(videoPath, expected) {
  const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', videoPath, '-f', 'null', '-'], { encoding: 'utf8' });
  if (decode.status !== 0) throw new Error(`The final video does not decode cleanly:\n${decode.stderr}`);

  const media = probeMedia(videoPath);
  if (media.width !== expected.width || media.height !== expected.height) {
    throw new Error(`Unexpected output size: ${media.width}x${media.height}.`);
  }
  if (!Number.isFinite(media.duration) || media.duration <= 0) throw new Error('The final video has no valid duration.');
}

function createContactSheet(videoPath, destination, background) {
  const duration = probeDuration(videoPath);
  const interval = Math.max(0.2, duration / 9).toFixed(3);
  const result = spawnSync('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', videoPath,
    '-vf', `fps=1/${interval},scale=640:-2,tile=3x3:padding=8:margin=8:color=${background}`,
    '-frames:v', '1',
    destination,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Contact-sheet generation failed:\n${result.stderr}`);
}
