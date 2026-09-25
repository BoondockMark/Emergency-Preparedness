import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import puppeteer from 'puppeteer';
import { inspectAccessibility, formatAccessibilityIssue } from './accessibility-validation.mjs';
import { sanitizeSvg } from './asset-validation.mjs';
import { createCalibrationPdf } from './calibration-pdf.mjs';
import { renderHandout } from './content-rendering.mjs';
import { generateBinderIndex, generateMoodleIndex } from './index-generation.mjs';
import { inspectSheetGeometry, formatLayoutIssue } from './layout-validation.mjs';
import { validateImages, validateLocalLinks } from './page-validation.mjs';
import { getPdfPageCount, inspectEmbeddedFonts, normalizePdfDates } from './pdf-validation.mjs';
import { compareFixture, VISUAL_TOLERANCE } from './visual-regression.mjs';

const PRINT_PPI = 200;
const FONT_HASHES = {
  'DejaVuSans.ttf': 'ae7b7855e115a5966d8b1b3f80f254ccc117ec86f9965e202ee2940453837280',
  'DejaVuSans-Bold.ttf': '5c1247acef7f2b8522a31742c76d6adcb5569bacc0be7ceaa4dc39dd252ce895'
};

async function prepareDirectories(root, outputRoot) {
  await fs.rm(outputRoot, { recursive: true, force: true });
  for (const directory of [
    'html',
    'assets/fonts',
    'assets/handouts',
    'diagnostics',
    'calibration',
    'pdfs',
    'previews'
  ]) {
    await fs.mkdir(path.join(outputRoot, directory), { recursive: true });
  }
  await fs.copyFile(
    path.join(root, 'assets/styles/print.css'),
    path.join(outputRoot, 'assets/print.css')
  );
}

async function copyAssets(root, outputRoot, manifests) {
  for (const [code, entries] of manifests) {
    const destination = path.join(outputRoot, 'assets/handouts', code);
    await fs.mkdir(destination, { recursive: true });
    for (const file of entries.keys()) {
      const source = path.join(root, 'assets/handouts', code, file);
      const target = path.join(destination, file);
      if (path.extname(file).toLowerCase() === '.svg') {
        await fs.writeFile(target, sanitizeSvg(await fs.readFile(source, 'utf8'), `${code}/${file}`));
      } else {
        await fs.copyFile(source, target);
      }
    }
  }
  for (const [font, expectedHash] of Object.entries(FONT_HASHES)) {
    const encoded = await fs.readFile(path.join(root, 'assets/fonts', `${font}.gz.base64`), 'ascii');
    const decoded = gunzipSync(Buffer.from(encoded.replace(/\s/g, ''), 'base64'));
    const actualHash = createHash('sha256').update(decoded).digest('hex');
    if (actualHash !== expectedHash) {
      throw Error(`${font}: decoded font hash ${actualHash} does not match the reviewed font ${expectedHash}`);
    }
    await fs.writeFile(path.join(outputRoot, 'assets/fonts', font), decoded);
  }
}

async function renderSources(root, outputRoot, documents, manifests) {
  const template = await fs.readFile(path.join(root, 'templates/handout.html'), 'utf8');
  for (const document of documents) {
    const html = renderHandout(template, document);
    const htmlFile = path.join(outputRoot, 'html', `${document.meta.code}.html`);
    await fs.writeFile(htmlFile, html);
    await validateLocalLinks(html, htmlFile, document.meta.code);
  }

  const fixtureSource = await fs.readFile(path.join(root, 'test/fixtures/components.html'), 'utf8');
  validateImages(fixtureSource, 'FIX-00', manifests);
  await fs.writeFile(
    path.join(outputRoot, 'html/components-fixture.html'),
    fixtureSource.replace('{{cssPath}}', '../assets/print.css')
  );
  await fs.copyFile(
    path.join(root, 'test/fixtures/baseline.css'),
    path.join(outputRoot, 'assets/baseline.css')
  );
  await fs.writeFile(
    path.join(outputRoot, 'html/components-baseline.html'),
    fixtureSource.replace('{{cssPath}}', '../assets/baseline.css')
  );
}

function browserOptions() {
  return {
    headless: true,
    args: [
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-domain-reliability',
      '--disable-features=Translate,MediaRouter,OptimizationHints',
      '--disable-sync',
      '--font-render-hinting=none',
      '--force-color-profile=srgb',
      '--lang=en-US',
      '--no-first-run',
      '--no-pings',
      '--no-sandbox'
    ],
    env: { ...process.env, LANG: 'en_US.UTF-8', TZ: 'UTC' }
  };
}

async function openPrintPage(browser, file) {
  const page = await browser.newPage();
  await page.setViewport({ width: 816, height: 1056, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = request.url();
    if (url.startsWith('file:') || url.startsWith('data:')) request.continue();
    else request.abort('blockedbyclient');
  });
  await page.emulateMediaType('print');
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.evaluate(async () => document.fonts.ready);
  return page;
}

async function validateRenderedPage(page, code, pageCount, diagnostics) {
  const fontReady = await page.evaluate(() => document.fonts.check('12px "Binder Sans"'));
  if (!fontReady) throw Error(`${code}: pinned Binder Sans font did not load`);
  const lowResolution = await page.$$eval('img', (images, minimum) => images.flatMap(image => {
    if (image.currentSrc.toLowerCase().endsWith('.svg')) return [];
    const widthInches = image.getBoundingClientRect().width / 96;
    const ppi = image.naturalWidth / widthInches;
    return ppi + 0.01 < minimum
      ? [`${image.getAttribute('src')}: ${Math.floor(ppi)} PPI at ${widthInches.toFixed(2)}in wide`]
      : [];
  }), PRINT_PPI);
  if (lowResolution.length) {
    throw Error(`${code}: raster image below ${PRINT_PPI} PPI: ${lowResolution.join('; ')}`);
  }
  const sheetCount = await page.$$eval('.sheet', sheets => sheets.length);
  if (sheetCount !== pageCount) throw Error(`${code}: HTML page count ${sheetCount}, expected ${pageCount}`);
  const layoutIssues = await inspectSheetGeometry(page, code);
  if (layoutIssues.length) {
    await fs.writeFile(path.join(diagnostics, `${code}-layout.json`), JSON.stringify(layoutIssues, null, 2));
    await page.screenshot({ path: path.join(diagnostics, `${code}-layout.png`), fullPage: true });
    throw Error(`Layout validation failed:\n${layoutIssues.map(formatLayoutIssue).join('\n')}`);
  }
  const accessibilityIssues = await inspectAccessibility(page, code);
  if (accessibilityIssues.length) {
    throw Error(`Accessibility validation failed:\n${accessibilityIssues.map(formatAccessibilityIssue).join('\n')}`);
  }
}

async function createPdfAndPreviews(page, outputRoot, meta, derivedPageCount) {
  const pdf = normalizePdfDates(await page.pdf({
    width: '8.5in',
    height: '11in',
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
    printBackground: true,
    preferCSSPageSize: true,
    tagged: false,
    outline: false
  }));
  await fs.writeFile(path.join(outputRoot, 'pdfs', `${meta.code}.pdf`), pdf);
  const count = await getPdfPageCount(pdf);
  if (count !== derivedPageCount) throw Error(`${meta.code}: PDF page count ${count}, expected ${derivedPageCount}`);
  const fonts = inspectEmbeddedFonts(pdf);
  if (!fonts.embeddedPrograms) {
    throw Error(`${meta.code}: generated PDF has no embedded font program (${fonts.fontNames.join(', ') || 'no fonts found'})`);
  }
  if (!fonts.fontNames.some(name => name.includes('DejaVuSans'))) {
    throw Error(`${meta.code}: generated PDF does not identify the bundled DejaVu Sans family`);
  }
  const sheets = await page.$$('.sheet');
  for (let index = 0; index < sheets.length; index++) {
    await sheets[index].screenshot({
      path: path.join(outputRoot, 'previews', `${meta.code}-page-${index + 1}.png`),
      type: 'png',
      omitBackground: false
    });
  }
}

async function renderArtifacts(root, outputRoot, documents) {
  const browser = await puppeteer.launch(browserOptions());
  try {
    const calibrationPdf = createCalibrationPdf();
    await fs.writeFile(path.join(outputRoot, 'calibration/printer-calibration.pdf'), calibrationPdf);
    if (await getPdfPageCount(calibrationPdf) !== 2) {
      throw Error('Printer calibration PDF must contain exactly two pages');
    }
    for (const { meta } of documents) {
      const derivedPageCount = meta.pageCount;
      const page = await openPrintPage(browser, path.join(outputRoot, 'html', `${meta.code}.html`));
      await validateRenderedPage(page, meta.code, derivedPageCount, path.join(outputRoot, 'diagnostics'));
      await createPdfAndPreviews(page, outputRoot, meta, derivedPageCount);
      await page.close();
    }

    const fixturePage = await openPrintPage(browser, path.join(outputRoot, 'html/components-fixture.html'));
    await validateRenderedPage(fixturePage, 'FIX-00', 2, path.join(outputRoot, 'diagnostics'));
    const fixtureActual = path.join(outputRoot, 'diagnostics/components-actual.png');
    await fixturePage.screenshot({ path: fixtureActual, type: 'png', omitBackground: false, fullPage: true });
    const baselinePage = await openPrintPage(browser, path.join(outputRoot, 'html/components-baseline.html'));
    const fixtureBaseline = path.join(outputRoot, 'diagnostics/components-baseline.png');
    await baselinePage.screenshot({ path: fixtureBaseline, type: 'png', omitBackground: false, fullPage: true });
    await compareFixture(
      fixturePage,
      fixtureActual,
      fixtureBaseline,
      path.join(outputRoot, 'diagnostics')
    );
    await baselinePage.close();
    await fixturePage.close();
  } finally {
    await browser.close();
  }
}

async function validateApprovals(root, outputRoot, documents) {
  for (const { meta } of documents) {
    if (meta.status !== 'approved') continue;
    if (!meta.proofRecord) throw Error(`${meta.code}: approved handouts require proofRecord metadata`);
    const recordPath = path.resolve(root, meta.proofRecord);
    if (!recordPath.startsWith(path.join(root, 'docs/publishing/proofs') + path.sep)) {
      throw Error(`${meta.code}: proofRecord must be under docs/publishing/proofs/`);
    }
    const record = await fs.readFile(recordPath, 'utf8');
    const field = name => record.match(new RegExp(`^${name}:\\s*["']?([^\\n"']+)["']?\\s*$`, 'm'))?.[1].trim();
    const expected = { handoutCode: meta.code, pdfPath: `docs/pdfs/${meta.code}.pdf` };
    for (const [name, value] of Object.entries(expected)) {
      if (field(name) !== value) throw Error(`${meta.code}: proof record ${name} must be ${value}`);
    }
    for (const name of ['sourceCommit', 'pdfSha256', 'printerModel', 'driverOrApplication', 'paperSize', 'scaling', 'duplex', 'reviewer', 'date', 'grayscaleOutcome', 'punchClearanceOutcome', 'measuredAlignment']) {
      if (!field(name)) throw Error(`${meta.code}: proof record is missing ${name}`);
    }
    if (!/^[0-9a-f]{40}$/.test(field('sourceCommit'))) {
      throw Error(`${meta.code}: proof record sourceCommit must be a full Git commit SHA`);
    }
    const pdf = await fs.readFile(path.join(outputRoot, 'pdfs', `${meta.code}.pdf`));
    const checksum = createHash('sha256').update(pdf).digest('hex');
    if (field('pdfSha256') !== checksum) {
      throw Error(`${meta.code}: proof record checksum does not match ${expected.pdfPath}`);
    }
    if (!/^pass\b/i.test(field('grayscaleOutcome')) || !/^pass\b/i.test(field('punchClearanceOutcome'))) {
      throw Error(`${meta.code}: approved proof outcomes must begin with PASS`);
    }
  }
}

export async function generateArtifacts({ root, outputRoot, documents, manifests }) {
  await prepareDirectories(root, outputRoot);
  await copyAssets(root, outputRoot, manifests);
  await renderSources(root, outputRoot, documents, manifests);
  await renderArtifacts(root, outputRoot, documents);
  await validateApprovals(root, outputRoot, documents);
  await fs.writeFile(path.join(outputRoot, 'BINDER_INDEX.md'), generateBinderIndex(documents));
  await fs.writeFile(path.join(outputRoot, 'moodle-index.html'), generateMoodleIndex(documents));
  return VISUAL_TOLERANCE;
}
