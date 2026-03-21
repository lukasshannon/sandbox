import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
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

const installCommand = ['playwright', 'install', 'chromium'];
const systemBrowserCandidates = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

async function fileExists(filePath) {
  if (!filePath) return false;

  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureChromiumExecutable() {
  if (await fileExists(executablePath)) return executablePath;

  for (const candidate of systemBrowserCandidates) {
    if (await fileExists(candidate)) return candidate;
  }

  const browserExecutable = chromium.executablePath();
  if (await fileExists(browserExecutable)) return browserExecutable;

  console.log('Chromium is missing. Installing Playwright Chromium...');

  await new Promise((resolve, reject) => {
    const installer = spawn('npx', installCommand, {
      cwd: process.cwd(),
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });

    installer.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Chromium install failed with exit code ${code ?? 'unknown'}.`));
    });

    installer.on('error', reject);
  });

  const installedExecutable = chromium.executablePath();
  if (await fileExists(installedExecutable)) return installedExecutable;

  throw new Error('Chromium installation completed but no executable was found.');
}

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

    const chromiumExecutable = await ensureChromiumExecutable();
    const browser = await chromium.launch({
      headless: true,
      executablePath: chromiumExecutable,
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

  if (message.includes('Executable doesn\'t exist') || message.includes('browserType.launch') || message.includes('Chromium install failed')) {
    console.error([
      'Chromium could not be prepared automatically for Playwright.',
      'Make sure `npx playwright install chromium` can run in this environment,',
      'or set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to an existing Chromium/Chrome binary.',
    ].join(' '));
  } else {
    console.error(error);
  }

  process.exitCode = 1;
});
