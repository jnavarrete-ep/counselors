import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { CONFIG_FILE, CONFIG_FILE_MODE } from '../constants.js';
import {
  type Config,
  ConfigSchema,
  type ReadOnlyLevel,
  type ToolConfig,
} from '../types.js';
import { safeWriteFile } from './fs-utils.js';

/** Strictness ranking: higher = stricter. */
const READ_ONLY_STRICTNESS: Record<ReadOnlyLevel, number> = {
  none: 0,
  bestEffort: 1,
  enforced: 2,
};

/** Return the stricter of two read-only levels. */
function stricterReadOnly(a: ReadOnlyLevel, b: ReadOnlyLevel): ReadOnlyLevel {
  return READ_ONLY_STRICTNESS[a] >= READ_ONLY_STRICTNESS[b] ? a : b;
}

const DEFAULT_CONFIG: Config = {
  version: 1,
  defaults: {
    timeout: 900,
    outputDir: './agents/counselors',
    readOnly: 'bestEffort',
    maxContextKb: 50,
    maxParallel: 4,
  },
  tools: {},
  groups: {},
};

export function loadConfig(globalPath?: string): Config {
  const path = globalPath ?? CONFIG_FILE;
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${path}: ${e instanceof Error ? e.message : e}`,
    );
  }
  return ConfigSchema.parse(raw);
}

/** Schema for project config — only defaults are allowed, not tools.
 *  Uses .optional() (not .default()) so missing fields stay absent
 *  and don't clobber global config during merge. */
const ProjectConfigSchema = z.object({
  defaults: z
    .object({
      timeout: z.number().optional(),
      outputDir: z.string().optional(),
      readOnly: z.enum(['enforced', 'bestEffort', 'none']).optional(),
      maxContextKb: z.number().optional(),
      maxParallel: z.number().optional(),
    })
    .optional(),
});

type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export function loadProjectConfig(cwd: string): ProjectConfig | null {
  const path = resolve(cwd, '.counselors.json');
  if (!existsSync(path)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    throw new Error(
      `Invalid JSON in ${path}: ${e instanceof Error ? e.message : e}`,
    );
  }
  return ProjectConfigSchema.parse(raw);
}

export function mergeConfigs(
  global: Config,
  project: ProjectConfig | null,
  cliFlags?: Partial<Config['defaults']>,
): Config {
  const merged: Config = {
    version: 1,
    defaults: { ...global.defaults },
    tools: { ...global.tools },
    groups: { ...global.groups },
  };

  if (project) {
    if (project.defaults) {
      merged.defaults = { ...merged.defaults, ...project.defaults };
      // Project configs cannot weaken the global read-only policy.
      // Clamp to the stricter of global vs project.
      merged.defaults.readOnly = stricterReadOnly(
        global.defaults.readOnly,
        merged.defaults.readOnly,
      );
    }
    // Project configs can only override defaults, never inject tools.
  }

  if (cliFlags) {
    merged.defaults = { ...merged.defaults, ...cliFlags };
  }

  return merged;
}

export function saveConfig(config: Config, path?: string): void {
  const filePath = path ?? CONFIG_FILE;
  mkdirSync(dirname(filePath), { recursive: true });
  safeWriteFile(filePath, `${JSON.stringify(config, null, 2)}\n`, {
    mode: CONFIG_FILE_MODE,
  });
}

export function addToolToConfig(
  config: Config,
  id: string,
  tool: ToolConfig,
): Config {
  return {
    ...config,
    tools: { ...config.tools, [id]: tool },
  };
}

export function removeToolFromConfig(config: Config, id: string): Config {
  const tools = { ...config.tools };
  delete tools[id];

  // Remove references from any groups and prune empty groups.
  const groups = Object.fromEntries(
    Object.entries(config.groups)
      .map(([name, toolIds]) => [name, toolIds.filter((t) => t !== id)])
      .filter(([, ids]) => (ids as string[]).length > 0),
  );

  return { ...config, tools, groups };
}

export function renameToolInConfig(
  config: Config,
  oldId: string,
  newId: string,
): Config {
  const tools = { ...config.tools };
  tools[newId] = tools[oldId];
  delete tools[oldId];

  const groups = Object.fromEntries(
    Object.entries(config.groups).map(([name, toolIds]) => [
      name,
      toolIds.map((t) => (t === oldId ? newId : t)),
    ]),
  );

  return { ...config, tools, groups };
}

export function getConfiguredTools(config: Config): string[] {
  return Object.keys(config.tools);
}

export function addGroupToConfig(
  config: Config,
  name: string,
  toolIds: string[],
): Config {
  return {
    ...config,
    groups: { ...config.groups, [name]: [...toolIds] },
  };
}

export function removeGroupFromConfig(config: Config, name: string): Config {
  const groups = { ...config.groups };
  delete groups[name];
  return { ...config, groups };
}

export function getConfiguredGroups(config: Config): string[] {
  return Object.keys(config.groups);
}
