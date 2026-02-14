import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addToolToConfig,
  getConfiguredTools,
  loadConfig,
  loadProjectConfig,
  mergeConfigs,
  removeToolFromConfig,
  renameToolInConfig,
  saveConfig,
} from '../../src/core/config.js';
import type { Config, ToolConfig } from '../../src/types.js';

const testDir = join(tmpdir(), `counselors-test-${Date.now()}`);
const testConfigFile = join(testDir, 'config.json');

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns default config when file does not exist', () => {
    const config = loadConfig(join(testDir, 'nonexistent.json'));
    expect(config.version).toBe(1);
    expect(config.defaults.timeout).toBe(540);
    expect(config.defaults.maxParallel).toBe(4);
    expect(Object.keys(config.tools)).toHaveLength(0);
  });

  it('loads valid config file', () => {
    const validConfig = {
      version: 1,
      defaults: {
        timeout: 300,
        outputDir: './out',
        readOnly: 'enforced',
        maxContextKb: 100,
        maxParallel: 2,
      },
      tools: {
        claude: {
          binary: '/usr/bin/claude',
          readOnly: { level: 'enforced' },
        },
      },
    };
    writeFileSync(testConfigFile, JSON.stringify(validConfig));
    const config = loadConfig(testConfigFile);
    expect(config.version).toBe(1);
    expect(config.defaults.timeout).toBe(300);
    expect(config.tools.claude).toBeDefined();
    expect(config.tools.claude.binary).toBe('/usr/bin/claude');
  });

  it('throws on invalid config', () => {
    writeFileSync(testConfigFile, JSON.stringify({ version: 2 }));
    expect(() => loadConfig(testConfigFile)).toThrow();
  });
});

describe('saveConfig', () => {
  it('writes config to file', () => {
    const config: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    saveConfig(config, testConfigFile);
    expect(existsSync(testConfigFile)).toBe(true);
    const loaded = loadConfig(testConfigFile);
    expect(loaded.version).toBe(1);
  });

  it('writes config with restrictive file permissions (0o600)', () => {
    if (process.platform === 'win32') return;

    const config: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    saveConfig(config, testConfigFile);
    const mode = statSync(testConfigFile).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe('mergeConfigs', () => {
  it('merges global and project configs (defaults only, not tools)', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {
        claude: {
          binary: '/bin/claude',
          readOnly: { level: 'enforced' },
        },
      },
    };
    const project = {
      defaults: { timeout: 300 },
    };
    const merged = mergeConfigs(global, project);
    expect(merged.defaults.timeout).toBe(300);
    expect(merged.defaults.maxParallel).toBe(4); // from global
    expect(merged.tools.claude).toBeDefined();
  });

  it('ignores tools from project config', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {
        claude: {
          binary: '/bin/claude',
          readOnly: { level: 'enforced' },
        },
      },
    };
    // Even if somehow a project config had tools, they should not be merged
    const project = { defaults: { timeout: 300 } };
    const merged = mergeConfigs(global, project);
    // Only global tools should be present
    expect(Object.keys(merged.tools)).toEqual(['claude']);
  });

  it('prevents project config from weakening global readOnly policy', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'enforced',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    const project = { defaults: { readOnly: 'none' as const } };
    const merged = mergeConfigs(global, project);
    // Project tried to downgrade to none, but it should stay at enforced
    expect(merged.defaults.readOnly).toBe('enforced');
  });

  it('allows project config to strengthen global readOnly policy', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    const project = { defaults: { readOnly: 'enforced' as const } };
    const merged = mergeConfigs(global, project);
    // Project strengthened to enforced — should be allowed
    expect(merged.defaults.readOnly).toBe('enforced');
  });

  it('CLI flags can still override readOnly (explicit user intent)', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'enforced',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    const merged = mergeConfigs(global, null, { readOnly: 'none' });
    // CLI flags represent explicit user intent, so they override everything
    expect(merged.defaults.readOnly).toBe('none');
  });

  it('applies CLI flags over everything', () => {
    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };
    const merged = mergeConfigs(global, null, { timeout: 60 });
    expect(merged.defaults.timeout).toBe(60);
  });
});

describe('loadConfig error handling', () => {
  it('throws with clear message on malformed JSON', () => {
    writeFileSync(testConfigFile, '{ invalid json }');
    expect(() => loadConfig(testConfigFile)).toThrow(/Invalid JSON in/);
  });
});

describe('loadProjectConfig', () => {
  it('returns null when no .counselors.json exists', () => {
    const result = loadProjectConfig(testDir);
    expect(result).toBeNull();
  });

  it('parses valid project config with defaults', () => {
    writeFileSync(
      join(testDir, '.counselors.json'),
      JSON.stringify({ defaults: { timeout: 120 } }),
    );
    const result = loadProjectConfig(testDir);
    expect(result).toBeDefined();
    expect(result?.defaults?.timeout).toBe(120);
  });

  it('strips tools from project config (security boundary)', () => {
    writeFileSync(
      join(testDir, '.counselors.json'),
      JSON.stringify({
        defaults: { timeout: 120 },
        tools: {
          evil: {
            binary: '/tmp/evil',
            readOnly: { level: 'none' },
          },
        },
      }),
    );
    const result = loadProjectConfig(testDir);
    // The Zod schema only picks 'defaults', so tools should not be present
    expect((result as any).tools).toBeUndefined();
  });

  it('throws on malformed JSON in project config', () => {
    writeFileSync(join(testDir, '.counselors.json'), '!!!not json');
    expect(() => loadProjectConfig(testDir)).toThrow(/Invalid JSON in/);
  });

  it('partial project config does not clobber unset global defaults', () => {
    // Project only sets timeout — readOnly, outputDir, etc. should survive merge
    writeFileSync(
      join(testDir, '.counselors.json'),
      JSON.stringify({ defaults: { timeout: 120 } }),
    );
    const project = loadProjectConfig(testDir);

    const global: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './custom-output',
        readOnly: 'enforced',
        maxContextKb: 100,
        maxParallel: 8,
      },
      tools: {},
    };

    const merged = mergeConfigs(global, project);
    expect(merged.defaults.timeout).toBe(120); // overridden
    expect(merged.defaults.outputDir).toBe('./custom-output'); // preserved
    expect(merged.defaults.readOnly).toBe('enforced'); // preserved
    expect(merged.defaults.maxContextKb).toBe(100); // preserved
    expect(merged.defaults.maxParallel).toBe(8); // preserved
  });
});

describe('schema strips removed fields', () => {
  it('parses config with legacy fields (defaultModel, promptMode, modelFlag, models)', () => {
    const legacyConfig = {
      version: 1,
      defaults: { timeout: 300 },
      tools: {
        claude: {
          binary: '/usr/bin/claude',
          defaultModel: 'opus',
          models: ['opus', 'sonnet'],
          readOnly: { level: 'enforced' },
          promptMode: 'argument',
          modelFlag: '--model',
          extraFlags: ['--model', 'opus'],
        },
      },
    };
    writeFileSync(testConfigFile, JSON.stringify(legacyConfig));
    const config = loadConfig(testConfigFile);
    expect(config.tools.claude).toBeDefined();
    expect(config.tools.claude.binary).toBe('/usr/bin/claude');
    expect(config.tools.claude.extraFlags).toEqual(['--model', 'opus']);
    // Legacy fields should be stripped by Zod
    expect((config.tools.claude as any).defaultModel).toBeUndefined();
    expect((config.tools.claude as any).models).toBeUndefined();
    expect((config.tools.claude as any).promptMode).toBeUndefined();
    expect((config.tools.claude as any).modelFlag).toBeUndefined();
  });

  it('parses config with legacy execFlags as unknown field', () => {
    const legacyConfig = {
      version: 1,
      defaults: {},
      tools: {
        custom: {
          binary: '/usr/bin/custom',
          readOnly: { level: 'none' },
          execFlags: ['--verbose'],
          custom: true,
        },
      },
    };
    writeFileSync(testConfigFile, JSON.stringify(legacyConfig));
    const config = loadConfig(testConfigFile);
    expect(config.tools.custom).toBeDefined();
    // execFlags is no longer in the schema, should be stripped
    expect((config.tools.custom as any).execFlags).toBeUndefined();
  });
});

describe('addToolToConfig / removeToolFromConfig', () => {
  it('adds and removes tools', () => {
    let config: Config = {
      version: 1,
      defaults: {
        timeout: 540,
        outputDir: './agents/counselors',
        readOnly: 'bestEffort',
        maxContextKb: 50,
        maxParallel: 4,
      },
      tools: {},
    };

    const tool: ToolConfig = {
      binary: '/bin/test',
      readOnly: { level: 'none' },
    };

    config = addToolToConfig(config, 'test-tool', tool);
    expect(config.tools['test-tool']).toBeDefined();
    expect(getConfiguredTools(config)).toContain('test-tool');

    config = removeToolFromConfig(config, 'test-tool');
    expect(config.tools['test-tool']).toBeUndefined();
    expect(getConfiguredTools(config)).not.toContain('test-tool');
  });
});

describe('renameToolInConfig', () => {
  const baseTool: ToolConfig = {
    binary: '/bin/test',
    readOnly: { level: 'enforced' },
  };

  const baseConfig: Config = {
    version: 1,
    defaults: {
      timeout: 540,
      outputDir: './agents/counselors',
      readOnly: 'bestEffort',
      maxContextKb: 50,
      maxParallel: 4,
    },
    tools: { 'old-name': baseTool },
  };

  it('moves tool config to new key', () => {
    const updated = renameToolInConfig(baseConfig, 'old-name', 'new-name');
    expect(updated.tools['new-name']).toBeDefined();
    expect(updated.tools['old-name']).toBeUndefined();
  });

  it('preserves all tool settings', () => {
    const toolWithExtras: ToolConfig = {
      ...baseTool,
      extraFlags: ['-c', 'model_reasoning_effort=high'],
      timeout: 900,
    };
    const config = { ...baseConfig, tools: { 'old-name': toolWithExtras } };
    const updated = renameToolInConfig(config, 'old-name', 'new-name');
    expect(updated.tools['new-name'].extraFlags).toEqual([
      '-c',
      'model_reasoning_effort=high',
    ]);
    expect(updated.tools['new-name'].timeout).toBe(900);
    expect(updated.tools['new-name'].binary).toBe('/bin/test');
  });

  it('does not mutate original config', () => {
    const updated = renameToolInConfig(baseConfig, 'old-name', 'new-name');
    expect(baseConfig.tools['old-name']).toBeDefined();
    expect(updated).not.toBe(baseConfig);
  });
});
