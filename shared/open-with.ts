import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Built-in apps, in their default menu order. The daemon finds where each one is installed. */
export const PRESET_IDS = ["fork", "github-desktop", "vscode", "cursor", "terminal", "file-manager"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** Replaced with the workspace folder in each argument. */
export const PATH_TOKEN = "{path}";

export const entrySchema = z.object({
  id: z.string().min(1).max(64),
  /** A preset id, or "" for an app the user added. */
  preset: z.string().max(64).default(""),
  /** Empty fields fall back to the preset. */
  name: z.string().trim().max(80).default(""),
  icon: z.string().trim().max(64).default(""),
  command: z.string().trim().max(1024).default(""),
  args: z.string().trim().max(2048).default(""),
  enabled: z.boolean().default(true),
});
export type Entry = z.infer<typeof entrySchema>;

export const settingsSchema = z.object({
  entries: z.array(entrySchema).max(64).default([]),
});
export type Settings = z.infer<typeof settingsSchema>;

/** Host scope: each computer keeps its own app list, because install paths differ. */
export const openWithSettings = defineSettings({
  id: "apps",
  scope: "host",
  version: 1,
  schema: settingsSchema,
});

export function isPresetId(value: string): value is PresetId {
  return (PRESET_IDS as readonly string[]).includes(value);
}

export function presetEntry(preset: PresetId): Entry {
  return { id: preset, preset, name: "", icon: "", command: "", args: "", enabled: true };
}

/** Stored entries in their order, then every preset the user has not stored yet. */
export function mergeEntries(stored: readonly Entry[]): Entry[] {
  const ids = new Set<string>();
  const merged: Entry[] = [];
  for (const entry of stored) {
    if (ids.has(entry.id)) continue;
    if (entry.preset && !isPresetId(entry.preset)) continue;
    ids.add(entry.id);
    merged.push(entry);
  }
  const storedPresets = new Set(merged.map((entry) => entry.preset));
  for (const preset of PRESET_IDS) {
    if (!storedPresets.has(preset) && !ids.has(preset)) merged.push(presetEntry(preset));
  }
  return merged;
}

/**
 * Splits an argument line on spaces. Double quotes group a value with spaces.
 * Backslashes stay literal, so Windows paths need no escaping.
 */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

export const appSchema = z.object({
  id: z.string(),
  preset: z.string(),
  enabled: z.boolean(),
  name: z.string(),
  icon: z.string(),
  /** A PNG data URL of the program icon, when the daemon could read one. */
  image: z.string().optional(),
  /** The program that runs, or null when it is not installed. */
  command: z.string().nullable(),
  args: z.string(),
  defaults: z.object({
    name: z.string(),
    icon: z.string(),
    command: z.string().nullable(),
    args: z.string(),
  }),
});
export type App = z.infer<typeof appSchema>;

export const appsRpc = defineRpc({
  name: "open-with.apps",
  input: z.object({}),
  output: z.object({ apps: z.array(appSchema) }),
});

export const launchFailureSchema = z.enum(["unknown-app", "not-installed", "no-folder", "failed"]);
export type LaunchFailure = z.infer<typeof launchFailureSchema>;

export const launchRpc = defineRpc({
  name: "open-with.launch",
  input: z.object({
    workspaceId: z.string().min(1).max(512),
    appId: z.string().min(1).max(64),
  }),
  output: z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }),
    z.object({ ok: z.literal(false), reason: launchFailureSchema, message: z.string().optional() }),
  ]),
});
