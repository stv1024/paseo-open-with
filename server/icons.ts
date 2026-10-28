import { execFile } from "node:child_process";

/**
 * Reads PNG icons of Windows programs. Paths go in through an environment variable as
 * base64 UTF-8 lines, and icons come back one base64 line per path, so no path text
 * crosses the console code page.
 */
const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Drawing
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPEN_WITH_ICON_PATHS))
foreach ($p in $text.Split([char]10)) {
  $png = '-'
  $icon = $null
  if (Test-Path -LiteralPath $p) { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($p) }
  if ($icon) {
    $bmp = $icon.ToBitmap()
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = [Convert]::ToBase64String($ms.ToArray())
  }
  [Console]::Out.WriteLine($png)
}
`;

const cache = new Map<string, string | null>();

/** PNG data URLs keyed by path. Paths without an icon are missing from the result. */
export async function readIcons(paths: readonly string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const missing = [...new Set(paths)].filter((path) => !cache.has(path));
  if (process.platform === "win32" && missing.length > 0) {
    const pngs = await runScript(missing).catch(() => null);
    missing.forEach((path, index) => {
      const png = pngs?.[index];
      // A failed run is not cached, so the next menu load tries again.
      if (pngs) cache.set(path, png ? `data:image/png;base64,${png}` : null);
    });
  }
  for (const path of paths) {
    const url = cache.get(path);
    if (url) result.set(path, url);
  }
  return result;
}

function runScript(paths: readonly string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT, "utf16le").toString("base64")],
      {
        env: { ...process.env, OPEN_WITH_ICON_PATHS: Buffer.from(paths.join("\n"), "utf8").toString("base64") },
        timeout: 15_000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) return reject(error);
        const lines = stdout.split(/\r?\n/).filter(Boolean);
        if (lines.length !== paths.length) return reject(new Error("Unexpected icon output"));
        resolve(lines.map((line) => (line === "-" ? "" : line)));
      },
    );
  });
}
