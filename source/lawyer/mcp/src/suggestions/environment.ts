// The environment facts a suggestion carries (docs/Plans/2026-10-25_suggestion-design.md, decision
// 19): each Probanda plugin, installed or not, with its version; for each installed one, which of
// Probanda's tools the session sees and which expected ones are missing; every other tool as a count
// only; the host (Cowork or Code); and the computer's operating system.
//
// What this server sees by itself: the plugin installs beside its own (siblingInstalls, the same
// lookup that serves skill source, on every install layout), their manifests' versions, the tools of
// the servers this package builds (lawyer's data and contacts-calendars-email servers, file-manager's
// files server, timekeeper's timecamp server), and the operating system it runs on. What only the
// session sees is which tools it was given, so the calling skill passes its tool names in, and this
// code reduces them to Probanda's own tool names and a count of the rest. The host is read from those
// names too: in Cowork, Probanda's tools reach the session bridged, under a prefix
// (mcp__<bridge>__plugin_...), and in Claude Code under their plain names. No Cowork tool is needed.
//
// Usernames, hostnames and paths are excluded by code: every value is a fixed word, a count, a
// version or a tool name that passed a strict pattern, and a last pass drops any value that holds a
// path separator or this computer's user name, host name or home or install folder.

import { arch as osArch, homedir, hostname as osHostname, platform as osPlatform, release as osRelease, userInfo } from "node:os";
import { basename } from "node:path";

import { ValidationError } from "../errors.js";
import { INSTALL_ROOT, pluginManifest, siblingInstalls } from "../repo-root.js";
import {
  buildContactsCalendarsEmailToolDefinitions,
  buildFileManagerToolDefinitions,
  buildToolDefinitions,
} from "../schema-gen.js";
import { timecampToolDefinitions } from "../timecamp/tools.js";

export const PROBANDA_PLUGINS = ["lawyer", "researcher", "litigator", "solicitor", "file-manager", "timekeeper", "developer"] as const;
export type ProbandaPlugin = (typeof PROBANDA_PLUGINS)[number];

/** Each plugin's MCP server keys (CLAUDE.md, Permanent names). */
const SERVERS: Record<ProbandaPlugin, readonly string[]> = {
  lawyer: ["data", "contacts-calendars-email"],
  researcher: ["canlii", "commons"],
  litigator: [],
  solicitor: [],
  "file-manager": ["files"],
  timekeeper: ["timecamp"],
  developer: [],
};

/** The tools of each server this package builds. A server built elsewhere (researcher's) is unknown here. */
function expectedTools(plugin: ProbandaPlugin, server: string): string[] | null {
  const names = (defs: { name: string }[]) => defs.map((d) => d.name).sort();
  if (plugin === "lawyer" && server === "data") return names(buildToolDefinitions());
  if (plugin === "lawyer" && server === "contacts-calendars-email") return names(buildContactsCalendarsEmailToolDefinitions());
  if (plugin === "file-manager" && server === "files") return names(buildFileManagerToolDefinitions());
  if (plugin === "timekeeper" && server === "timecamp") return names(timecampToolDefinitions());
  return null;
}

export interface ServerFacts {
  server: string;
  /** The tools of this server the session sees, by their own names. */
  visible: string[];
  /** The tools this server's version in this package has that the session does not see; null when
   * this package does not know the server's tools (it is built in another plugin). */
  missing: string[] | null;
}

export interface PluginFacts {
  plugin: ProbandaPlugin;
  installed: boolean;
  version: string | null;
  /** Present for an installed plugin when the session's tool names were given. */
  servers?: ServerFacts[];
}

export interface EnvironmentFacts {
  plugins: PluginFacts[];
  /** Tools the session sees that are not Probanda's, as a count only; null when no tool names were given. */
  other_tools: number | null;
  host: "Cowork" | "Code" | "unknown";
  os: { platform: string; release: string | null; arch: string | null };
}

/** Test seams. Each defaults to what this process sees. */
export interface EnvironmentSeams {
  installRoot?: string;
  env?: NodeJS.ProcessEnv;
  platform?: string;
  release?: string;
  arch?: string;
  hostname?: string;
  username?: string;
}

// mcp__[<bridge>__]plugin_<plugin>_<server>__<tool>. Plugin names hold no underscore, so the first
// underscore after `plugin_` ends the plugin's name.
const PROBANDA_TOOL = new RegExp(`^mcp__(?:(.+)__)?plugin_(${PROBANDA_PLUGINS.join("|")})_([a-z0-9-]+)__([a-z0-9_]+)$`);
const VERSION = /^\d{1,4}(?:\.\d{1,6}){0,3}(?:[-+][0-9A-Za-z.-]{1,40})?$/;
const RELEASE = /^[0-9A-Za-z._+-]{1,60}$/;
const PLATFORMS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

interface SeenTool {
  plugin: ProbandaPlugin;
  server: string;
  tool: string;
  bridged: boolean;
}

/** The session's tool names, split into Probanda's (by plugin and server) and a count of the rest. */
export function reduceToolNames(toolNames: string[]): { probanda: SeenTool[]; others: number } {
  const probanda: SeenTool[] = [];
  let others = 0;
  for (const name of new Set(toolNames)) {
    const m = typeof name === "string" ? PROBANDA_TOOL.exec(name) : null;
    const plugin = m?.[2] as ProbandaPlugin | undefined;
    if (!m || plugin === undefined || !SERVERS[plugin].includes(m[3])) {
      others += 1;
      continue;
    }
    probanda.push({ plugin, server: m[3], tool: m[4], bridged: m[1] !== undefined });
  }
  return { probanda, others };
}

function cleanVersion(version: string | null): string | null {
  return version !== null && VERSION.test(version) ? version : null;
}

/** Every plugin found installed: this server's own, then each one beside it. */
function installedVersions(installRoot: string): Map<ProbandaPlugin, string | null> {
  const found = new Map<ProbandaPlugin, string | null>();
  // This server runs inside lawyer, whether or not this is a packaged install (a checkout has no manifest).
  const own = pluginManifest(installRoot);
  found.set("lawyer", own.name === "lawyer" ? cleanVersion(own.version) : null);
  for (const sibling of siblingInstalls(installRoot, PROBANDA_PLUGINS.filter((p) => p !== "lawyer"))) {
    found.set(sibling.name as ProbandaPlugin, cleanVersion(sibling.version));
  }
  return found;
}

function hostOf(seen: SeenTool[] | null, env: NodeJS.ProcessEnv): EnvironmentFacts["host"] {
  if (seen && seen.length) return seen.some((t) => t.bridged) ? "Cowork" : "Code";
  // No Probanda tool names to read: only a Claude Code process says so in its environment.
  return env.CLAUDECODE === "1" ? "Code" : "unknown";
}

/** What must never appear in a fact: this computer's user name, host name and home folder. Any path is
 * dropped by its separator. */
function forbiddenValues(seams: EnvironmentSeams, env: NodeJS.ProcessEnv): string[] {
  const values: (string | undefined)[] = [
    seams.hostname ?? safe(() => osHostname()),
    seams.username ?? safe(() => userInfo().username),
    env.USER, env.USERNAME, env.LOGNAME, env.COMPUTERNAME, env.HOSTNAME, env.HOME, env.USERPROFILE,
    safe(() => homedir()),
  ];
  for (const home of [env.HOME, env.USERPROFILE, safe(() => homedir())]) if (home) values.push(basename(home));
  return [...new Set(values.filter((v): v is string => typeof v === "string" && v.trim().length >= 3).map((v) => v.toLowerCase()))];
}

function safe(read: () => string): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Drops (to null, or out of a list) every string that holds a path separator or a forbidden value. */
type Unscrubbed = Omit<EnvironmentFacts, "plugins"> & { plugins: (Omit<PluginFacts, "servers"> & { servers?: (ServerFacts & { known: string[] })[] })[] };

function scrubFacts(facts: Unscrubbed, forbidden: string[]): EnvironmentFacts {
  const bad = (value: string) => /[\\/]/.test(value) || forbidden.some((f) => value.toLowerCase().includes(f));
  const keep = (value: string | null) => (value !== null && bad(value) ? null : value);
  return {
    plugins: facts.plugins.map((p) => ({
      ...p,
      version: keep(p.version),
      ...(p.servers ? {
        servers: p.servers.map((s) => ({
          server: s.server,
          // A tool this package ships is a fixed name; only another name is screened.
          visible: s.visible.filter((t) => s.known.includes(t) || !bad(t)),
          missing: s.missing,
        })),
      } : {}),
    })),
    other_tools: facts.other_tools,
    host: facts.host,
    os: { platform: facts.os.platform, release: keep(facts.os.release), arch: keep(facts.os.arch) },
  };
}

/** The environment facts. `toolNames` is every tool name the session sees, or undefined when it has none to give. */
export function environmentFacts(toolNames: string[] | undefined, seams: EnvironmentSeams = {}): EnvironmentFacts {
  if (toolNames !== undefined && (!Array.isArray(toolNames) || !toolNames.every((t) => typeof t === "string"))) {
    throw new ValidationError("tool_names must be a list of the tool names this session sees");
  }
  const env = seams.env ?? process.env;
  const installRoot = seams.installRoot ?? INSTALL_ROOT;
  const installed = installedVersions(installRoot);
  const reduced = toolNames === undefined ? null : reduceToolNames(toolNames);

  const plugins = PROBANDA_PLUGINS.map((plugin): Unscrubbed["plugins"][number] => {
    const seen = reduced?.probanda.filter((t) => t.plugin === plugin) ?? [];
    const isInstalled = installed.has(plugin) || seen.length > 0;
    const facts: Unscrubbed["plugins"][number] = { plugin, installed: isInstalled, version: installed.get(plugin) ?? null };
    if (isInstalled && reduced) {
      facts.servers = SERVERS[plugin].map((server) => {
        const visible = [...new Set(seen.filter((t) => t.server === server).map((t) => t.tool))].sort();
        const expected = expectedTools(plugin, server);
        return { server, visible, missing: expected === null ? null : expected.filter((t) => !visible.includes(t)), known: expected ?? [] };
      });
    }
    return facts;
  });

  const platform = seams.platform ?? osPlatform();
  const release = seams.release ?? safe(() => osRelease()) ?? null;
  const arch = seams.arch ?? osArch();
  const facts: Unscrubbed = {
    plugins,
    other_tools: reduced ? reduced.others : null,
    host: hostOf(reduced ? reduced.probanda : null, env),
    os: {
      platform: PLATFORMS[platform] ?? "other",
      release: release !== null && RELEASE.test(release) ? release : null,
      arch: /^[a-z0-9_]{1,16}$/.test(arch) ? arch : null,
    },
  };
  return scrubFacts(facts, forbiddenValues(seams, env));
}
