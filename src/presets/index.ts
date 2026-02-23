import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { PresetDefinition } from './types.js';
import { PresetDefinitionSchema } from './types.js';

function findPackageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    dir = dirname(dir);
  }
  throw new Error('Could not find package root (no package.json found)');
}

function builtinPresetsDir(): string {
  return join(findPackageRoot(), 'assets', 'presets');
}

function isFilePath(input: string): boolean {
  return (
    input.includes('/') ||
    input.includes('\\') ||
    input.endsWith('.yml') ||
    input.endsWith('.yaml')
  );
}

export function parsePresetYaml(
  content: string,
  source: string,
): PresetDefinition {
  let raw: unknown;
  try {
    raw = parseYaml(content);
  } catch (err) {
    throw new Error(
      `Invalid YAML in preset "${source}": ${err instanceof Error ? err.message : err}`,
    );
  }

  const result = PresetDefinitionSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid preset "${source}":\n${issues}`);
  }

  return result.data;
}

export function resolvePreset(input: string): PresetDefinition {
  if (isFilePath(input)) {
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`Preset file not found: ${filePath}`);
    }
    const content = readFileSync(filePath, 'utf-8');
    return parsePresetYaml(content, filePath);
  }

  const dir = builtinPresetsDir();
  const filePath = join(dir, `${input}.yml`);
  if (!existsSync(filePath)) {
    const available = getPresetNames().join(', ');
    throw new Error(
      `Unknown preset "${input}". Available presets: ${available}`,
    );
  }
  const content = readFileSync(filePath, 'utf-8');
  return parsePresetYaml(content, filePath);
}

export function getPresetNames(): string[] {
  const dir = builtinPresetsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => f.replace(/\.ya?ml$/, ''))
    .sort();
}
