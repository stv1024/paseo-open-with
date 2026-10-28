// Renders docs/media-src/*.html to docs/images/*.png with a local Chrome/Edge.
// Usage: node docs/media-src/render.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../images");
mkdirSync(out, { recursive: true });

const browser = [
  process.env.CHROME,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!browser) throw new Error("No Chrome/Edge found; set CHROME=/path/to/chrome");

for (const name of ["menu", "settings"]) {
  const html = join(here, `${name}.html`);
  // Each page declares its own canvas size as --w / --h.
  const css = readFileSync(html, "utf8");
  const w = css.match(/--w:\s*(\d+)px/)[1];
  const h = css.match(/--h:\s*(\d+)px/)[1];
  // A throwaway profile keeps headless runs independent of an open browser.
  const profile = mkdtempSync(join(tmpdir(), "open-with-render-"));
  execFileSync(browser, [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${w},${h}`,
    `--screenshot=${join(out, `${name}.png`)}`,
    pathToFileURL(html).href,
  ], { stdio: "ignore", timeout: 60000 });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  console.log(`${name}.png  ${w}x${h} @2x`);
}
