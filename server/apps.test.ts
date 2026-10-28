import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeEntries, presetEntry, PRESET_IDS, splitArgs, type Entry } from "../shared/open-with";
import { buildCommand, describeEntry, expandEnv, resolveCommand, type Runtime } from "./apps";

function windows(files: string[], env: Record<string, string> = {}): Runtime {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return {
    platform: "win32",
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local", USERPROFILE: "C:\\Users\\me", PATH: "C:\\bin;C:\\tools", ...env },
    exists: (path) => set.has(path.toLowerCase()),
  };
}

function mac(files: string[]): Runtime {
  const set = new Set(files);
  return { platform: "darwin", env: { HOME: "/Users/me", PATH: "/usr/bin:/usr/local/bin" }, exists: (p) => set.has(p) };
}

const custom = (fields: Partial<Entry>): Entry => ({
  id: "custom-1",
  preset: "",
  name: "",
  icon: "",
  command: "",
  args: "",
  enabled: true,
  ...fields,
});

test("splitArgs keeps quoted values and backslashes", () => {
  assert.deepEqual(splitArgs('-d "{path}"'), ["-d", "{path}"]);
  assert.deepEqual(splitArgs('  --a  "C:\\Program Files\\x"  b '), ["--a", "C:\\Program Files\\x", "b"]);
  assert.deepEqual(splitArgs('--dir="{path}"'), ["--dir={path}"]);
  assert.deepEqual(splitArgs('""'), [""]);
  assert.deepEqual(splitArgs(""), []);
});

test("mergeEntries keeps stored order and appends missing presets", () => {
  const stored = [presetEntry("vscode"), custom({ command: "x.exe" }), presetEntry("vscode"), { ...presetEntry("fork"), preset: "gone", id: "gone" }];
  const merged = mergeEntries(stored);
  assert.deepEqual(
    merged.map((e) => e.id),
    ["vscode", "custom-1", ...PRESET_IDS.filter((id) => id !== "vscode")],
  );
  assert.deepEqual(mergeEntries([]).map((e) => e.id), [...PRESET_IDS]);
});

test("resolveCommand finds absolute paths, PATH entries and Windows extensions", () => {
  const r = windows(["C:\\tools\\code.cmd", "C:\\Apps\\Fork.exe"]);
  assert.equal(resolveCommand(["C:\\Missing\\Fork.exe", "C:\\Apps\\Fork.exe"], r), "C:\\Apps\\Fork.exe");
  assert.equal(resolveCommand(["code"], r), "C:\\tools\\code.cmd");
  assert.equal(resolveCommand(["nothing"], r), null);
  assert.equal(resolveCommand(["%LOCALAPPDATA%\\x.exe"], windows(["C:\\Users\\me\\AppData\\Local\\x.exe"])), "C:\\Users\\me\\AppData\\Local\\x.exe");
  assert.equal(resolveCommand(["code"], mac(["/usr/local/bin/code"])), "/usr/local/bin/code");
});

test("expandEnv expands variables case-insensitively and a leading tilde", () => {
  const r = windows([], { ProgramFiles: "C:\\Program Files" });
  assert.equal(expandEnv("%programfiles%\\App\\a.exe", r), "C:\\Program Files\\App\\a.exe");
  assert.equal(expandEnv("%NOPE%\\a.exe", r), "%NOPE%\\a.exe");
  assert.equal(expandEnv("~\\a.exe", r), "C:\\Users\\me\\a.exe");
  assert.equal(expandEnv("~/bin/x", mac([])), "/Users/me/bin/x");
});

test("describeEntry finds presets and lets stored fields win", () => {
  const fork = "C:\\Users\\me\\AppData\\Local\\Fork\\current\\Fork.exe";
  const r = windows([fork, "C:\\Other\\Fork.exe"]);
  const app = describeEntry(presetEntry("fork"), r);
  assert.equal(app.name, "Fork");
  assert.equal(app.command, fork);
  assert.equal(app.args, '"{path}"');

  const changed = describeEntry({ ...presetEntry("fork"), name: "My Fork", command: "C:\\Other\\Fork.exe" }, r);
  assert.equal(changed.name, "My Fork");
  assert.equal(changed.command, "C:\\Other\\Fork.exe");
  assert.equal(changed.defaults.command, fork);

  assert.equal(describeEntry(presetEntry("cursor"), r).command, null);
  assert.equal(describeEntry(presetEntry("terminal"), windows(["C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe"])).args, '-d "{path}"');

  const own = describeEntry(custom({ command: "C:\\Apps\\Tool.exe" }), windows(["C:\\Apps\\Tool.exe"]));
  assert.equal(own.name, "C:\\Apps\\Tool.exe");
  assert.equal(own.icon, "AppWindow");
  assert.equal(own.args, '"{path}"');
});

test("buildCommand puts the folder into each argument", () => {
  const r = windows(["C:\\Apps\\wt.exe"]);
  const app = describeEntry(custom({ command: "C:\\Apps\\wt.exe", args: '-d "{path}" --title "{path} x"' }), r);
  assert.deepEqual(buildCommand(app, "D:\\my project", r), {
    executable: "C:\\Apps\\wt.exe",
    args: ["-d", "D:\\my project", "--title", "D:\\my project x"],
    shell: false,
  });
});

test("buildCommand quotes batch files for cmd.exe", () => {
  const bat = "C:\\Users\\me\\AppData\\Local\\GitHubDesktop\\bin\\github.bat";
  const r = windows([bat]);
  const app = describeEntry(presetEntry("github-desktop"), r);
  assert.deepEqual(buildCommand(app, "D:\\a&b (1)", r), { executable: bat, args: ['"D:\\a&b (1)"'], shell: true });
  assert.deepEqual(buildCommand(app, "D:\\plain", r).args, ["D:\\plain"]);
});

test("buildCommand rejects an app that is not installed", () => {
  const r = windows([]);
  assert.throws(() => buildCommand(describeEntry(presetEntry("cursor"), r), "D:\\x", r));
});
