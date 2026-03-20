import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const PORT = 4173;
const HOST = '127.0.0.1';
const APP_URL = `http://${HOST}:${PORT}`;
const OUTPUT_DIR = path.resolve('artifacts');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'json-navigator-mobile.png');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is not ready yet.
    }
    await wait(250);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', HOST], {
    cwd: process.cwd(),
    stdio: 'ignore',
  });

  try {
    await waitForServer(APP_URL);

    const browser = await chromium.launch({
      headless: true,
      executablePath: executablePath || undefined,
    });
    const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });

    await page.goto(APP_URL, { waitUntil: 'networkidle' });
    await page.setInputFiles('#file-input', {
      name: 'sample.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({
        user: {
          name: 'Mika',
          notifications: true,
          stats: {
            projects: 6,
            storageGb: 14.2
          }
        },
        workspace: {
          theme: 'night',
          devices: ['phone', 'tablet', 'desktop'],
          shortcuts: {
            open: 'Cmd+O',
            save: 'Cmd+S'
          }
        }
      }, null, 2)),
    });

    await page.waitForFunction(() => !document.querySelector('#download-button')?.disabled);
    await page.locator('.tree-node').nth(1).click();
    await page.screenshot({ path: OUTPUT_PATH, fullPage: true });
    await browser.close();

    console.log(`Saved screenshot to ${OUTPUT_PATH}`);
  } finally {
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  const message = String(error?.message || error);

  if (message.includes('Executable doesn\'t exist') || message.includes('browserType.launch')) {
    console.error([
      'Chromium is not available for Playwright.',
      'Run `npx playwright install chromium` in an environment that permits browser downloads,',
      'or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chromium/Chrome binary.',
    ].join(' '));
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
