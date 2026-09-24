import fs from 'node:fs/promises';
import path from 'node:path';

export const VISUAL_TOLERANCE = { pixelThreshold: 0.1, maxDifferentPixelRatio: 0.001 };

export async function compareFixture(page, actualPath, baselinePath, diagnosticsDir) {
  let expectedBytes;
  try { expectedBytes = await fs.readFile(baselinePath); }
  catch (error) { throw new Error(`Missing generated visual baseline ${baselinePath}`, { cause: error }); }
  const actualBytes = await fs.readFile(actualPath);
  const comparison = await page.evaluate(async ({ actualUrl, expectedUrl, threshold }) => {
    const load = source => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = source; });
    const [actual, expected] = await Promise.all([load(actualUrl), load(expectedUrl)]);
    if (actual.width !== expected.width || actual.height !== expected.height) return { dimensions: [actual.width, actual.height, expected.width, expected.height] };
    const canvas = document.createElement('canvas'); canvas.width = actual.width; canvas.height = actual.height;
    const context = canvas.getContext('2d'); context.drawImage(actual, 0, 0); const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(expected, 0, 0); const expectedPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const diff = context.createImageData(canvas.width, canvas.height); let differentPixels = 0;
    for (let index = 0; index < actualPixels.data.length; index += 4) {
      const delta = Math.max(...[0, 1, 2, 3].map(channel => Math.abs(actualPixels.data[index + channel] - expectedPixels.data[index + channel]))) / 255;
      const changed = delta > threshold; if (changed) differentPixels++;
      diff.data.set(changed ? [255, 0, 255, 255] : [actualPixels.data[index], actualPixels.data[index + 1], actualPixels.data[index + 2], 45], index);
    }
    context.putImageData(diff, 0, 0); document.body.replaceChildren(canvas);
    return { width: canvas.width, height: canvas.height, differentPixels, diffUrl: canvas.toDataURL('image/png') };
  }, { actualUrl: `data:image/png;base64,${actualBytes.toString('base64')}`, expectedUrl: `data:image/png;base64,${expectedBytes.toString('base64')}`, threshold: VISUAL_TOLERANCE.pixelThreshold });
  if (comparison.dimensions) throw new Error(`Visual fixture dimensions changed: actual ${comparison.dimensions[0]}x${comparison.dimensions[1]}, expected ${comparison.dimensions[2]}x${comparison.dimensions[3]}`);
  const { differentPixels } = comparison;
  const ratio = differentPixels / (comparison.width * comparison.height);
  if (ratio > VISUAL_TOLERANCE.maxDifferentPixelRatio) {
    await fs.mkdir(diagnosticsDir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(diagnosticsDir, 'components-diff.png'), Buffer.from(comparison.diffUrl.split(',')[1], 'base64')),
      fs.copyFile(actualPath, path.join(diagnosticsDir, 'components-actual.png')),
      fs.copyFile(baselinePath, path.join(diagnosticsDir, 'components-expected.png'))
    ]);
    throw new Error(`Visual regression: ${differentPixels} pixels (${(ratio * 100).toFixed(4)}%) differ; allowed ${(VISUAL_TOLERANCE.maxDifferentPixelRatio * 100).toFixed(2)}%. See build/diagnostics/components-*.png`);
  }
  return { updated: false, differentPixels, ratio };
}
