// Renders docs/media-src/*.html to docs/images/*.png with Chrome Headless Shell,
// or a local Chrome/Edge when the Shell is not installed.
// Usage: node docs/media-src/render.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../images");
mkdirSync(out, { recursive: true });

// On Windows, full Chrome and Edge can check the account password when they create a
// new profile, and fail it. The Shell does not. Install it with
// `npx playwright install chromium --only-shell`.
function headlessShell() {
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? (
    process.platform === "win32" ? join(process.env.LOCALAPPDATA ?? "", "ms-playwright")
      : process.platform === "darwin" ? join(homedir(), "Library/Caches/ms-playwright")
        : join(homedir(), ".cache/ms-playwright"));
  if (!existsSync(cache)) return undefined;
  const builds = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
  for (const build of builds) {
    for (const sub of readdirSync(join(cache, build))) {
      const exe = join(cache, build, sub, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

const browser = [
  process.env.CHROME,
  headlessShell(),
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!browser) throw new Error("No Headless Shell, Chrome or Edge found; set CHROME=/path/to/chrome");

// [image name, mockup page, query]
const shots = [
  ["menu", "menu", ""],
  ["settings", "settings", ""],
  ["file-menu", "file-menu", ""],
  ["file-menu-zh-CN", "file-menu", "?lang=zh-CN"],
  ["promo", "promo", ""],
];

for (const [name, page, query] of shots) {
  const html = join(here, `${page}.html`);
  // Each page declares its own canvas size as --w / --h.
  const css = readFileSync(html, "utf8");
  const w = css.match(/--w:\s*(\d+)px/)[1];
  const h = css.match(/--h:\s*(\d+)px/)[1];
  // A throwaway profile keeps headless runs independent of an open browser.
  const profile = mkdtempSync(join(tmpdir(), "open-with-render-"));
  const shell = /headless-shell/.test(browser);
  execFileSync(browser, [
    ...(shell ? [] : ["--headless=new"]),
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    `--window-size=${w},${h}`,
    `--screenshot=${join(out, `${name}.png`)}`,
    pathToFileURL(html).href + query,
  ], { stdio: "ignore", timeout: 60000 });
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  console.log(`${name}.png  ${w}x${h} @2x`);
}
