import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CLI = resolve(import.meta.dirname, '../../dist/cli.js');

function run(args: string, options?: { env?: Record<string, string> }): string {
  try {
    return execSync(`node ${CLI} ${args}`, {
      encoding: 'utf-8',
      timeout: 15_000,
      env: { ...process.env, ...options?.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (e: any) {
    return `${(e.stdout || '').trim()}\n${(e.stderr || '').trim()}`;
  }
}

describe('CLI', () => {
  it('shows help', () => {
    const output = run('--help');
    expect(output).toContain('counselors');
    expect(output).toContain('run');
    expect(output).toContain('loop');
    expect(output).toContain('cleanup');
    expect(output).toContain('config');
    expect(output).toContain('doctor');
    expect(output).toContain('init');
    expect(output).toContain('upgrade');
    expect(output).toContain('tools');
    expect(output).toContain('groups');
  });

  it('shows version', () => {
    const output = run('--version');
    expect(output).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('tools list shows no tools when unconfigured', () => {
    const output = run('tools list', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('No tools configured');
  });

  it('tools discover finds tools', () => {
    const output = run('tools discover');
    // Should at least attempt to find tools
    expect(output).toContain('Discovered tools');
  });

  it('doctor runs without error', () => {
    const output = run('doctor', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('Doctor results');
  });

  it('doctor validates group references', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {
              valid: ['claude'],
              broken: ['claude', 'missing-tool'],
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('doctor', { env: { XDG_CONFIG_HOME: xdg } });
      expect(output).toContain('group "valid"');
      expect(output).toContain('1 tool(s)');
      expect(output).toContain('group "broken"');
      expect(output).toContain('missing-tool');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('run with no tools configured shows error', () => {
    const output = run('run "test"', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('No tools configured');
  });

  it('run --help shows options', () => {
    const output = run('run --help');
    expect(output).toContain('--file');
    expect(output).toContain('--tools');
    expect(output).toContain('--group');
    expect(output).toContain('--dry-run');
    expect(output).toContain('--read-only');
  });

  it('run --dry-run supports running the same tool multiple times', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('run --dry-run -t claude,claude,claude "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('claude');
      expect(output).toContain('claude__2');
      expect(output).toContain('claude__3');
      expect(output.split('$ /usr/bin/claude').length - 1).toBe(3);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('run --dry-run repeats built-in tools even when adapter is omitted', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
            version: 1,
            defaults: {
              timeout: 540,
              outputDir: './agents/counselors',
              readOnly: 'bestEffort',
              maxContextKb: 50,
              maxParallel: 4,
            },
            tools: {
              // Intentionally omit `adapter` to simulate a minimal/manual config.
              claude: {
                binary: '/usr/bin/claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('run --dry-run -t claude,claude "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      const lines = output.split('\n');
      const idx = lines.findIndex((l) => l.trim() === 'claude__2');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(lines[idx + 1]).toContain('$ /usr/bin/claude');
      expect(lines[idx + 1]).toContain('--output-format text');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('agent command prints instructions', () => {
    const output = run('agent');
    expect(output).toContain('Setup & Skill Installation');
    expect(output).toContain('counselors init');
    expect(output).toContain('counselors skill');
  });

  it('skill output mentions groups', () => {
    const output = run('skill');
    expect(output).toContain('counselors groups ls');
    expect(output).toContain('--group');
  });

  it('groups add/list/remove works', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      const configPath = join(configDir, 'config.json');
      writeFileSync(
        configPath,
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      run('groups add smart --tools claude', { env: { XDG_CONFIG_HOME: xdg } });

      const listOutput = run('groups list', { env: { XDG_CONFIG_HOME: xdg } });
      expect(listOutput).toContain('smart');
      expect(listOutput).toContain('claude');

      const saved = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(saved.groups.smart).toEqual(['claude']);

      run('groups remove smart', { env: { XDG_CONFIG_HOME: xdg } });
      const savedAfter = JSON.parse(readFileSync(configPath, 'utf-8'));
      expect(savedAfter.groups.smart).toBeUndefined();
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('groups add errors when tool is missing', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('groups add smart --tools missing', {
        env: { XDG_CONFIG_HOME: xdg },
      });
      expect(output).toContain('Tool "missing" is not configured');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('groups remove errors when group does not exist', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('groups remove missing', {
        env: { XDG_CONFIG_HOME: xdg },
      });
      expect(output).toContain('Group "missing" is not configured');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('run --dry-run supports --group expansion', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
              codex: {
                binary: '/usr/bin/codex',
                adapter: 'codex',
                readOnly: { level: 'enforced' },
              },
            },
            groups: { smart: ['claude', 'codex'] },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('run --dry-run --group smart "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('claude');
      expect(output).toContain('codex');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('run --group errors when group does not exist', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('run --dry-run --group missing "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });
      expect(output).toContain('Group "missing" is not configured');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('run --group errors when group references missing tool', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: { smart: ['missing'] },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('run --dry-run --group smart "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });
      expect(output).toContain('references tool "missing"');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('config prints path and JSON', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('config', { env: { XDG_CONFIG_HOME: xdg } });
      expect(output).toContain('Config file:');
      expect(output).toContain(join(configDir, 'config.json'));
      expect(output).toContain('"version": 1');
      expect(output).toContain('"claude"');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('config works with no config file', () => {
    const output = run('config', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('Config file:');
    expect(output).toContain('"version": 1');
  });

  it('ls is alias for tools list', () => {
    const output = run('ls', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('No tools configured');
  });

  it('upgrade --check reports install details', () => {
    const output = run('upgrade --check');
    expect(output).toContain('Install method');
    expect(output).toContain('Running version');
  });

  it('upgrade --dry-run does not error', () => {
    const output = run('upgrade --dry-run');
    expect(output).toContain('Dry run');
  });

  it('cleanup deletes old output directories by default (older than 1 day)', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });

      const outDir = join(xdg, 'out');
      mkdirSync(outDir, { recursive: true });

      const oldRun = join(outDir, 'old-run');
      const newRun = join(outDir, 'new-run');
      mkdirSync(oldRun, { recursive: true });
      mkdirSync(newRun, { recursive: true });

      const now = Date.now();
      const twoDaysAgo = new Date(now - 2 * 24 * 60 * 60 * 1000);
      utimesSync(oldRun, twoDaysAgo, twoDaysAgo);

      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
            version: 1,
            defaults: {
              timeout: 540,
              outputDir: outDir,
              readOnly: 'bestEffort',
              maxContextKb: 50,
              maxParallel: 4,
            },
            tools: {},
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('cleanup --yes', { env: { XDG_CONFIG_HOME: xdg } });
      expect(output).toContain('Deleted 1 directory');
      expect(existsSync(oldRun)).toBe(false);
      expect(existsSync(newRun)).toBe(true);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('cleanup refuses to delete in non-interactive mode without --yes', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });

      const outDir = join(xdg, 'out');
      mkdirSync(outDir, { recursive: true });

      const oldRun = join(outDir, 'old-run');
      mkdirSync(oldRun, { recursive: true });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      utimesSync(oldRun, twoDaysAgo, twoDaysAgo);

      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
            version: 1,
            defaults: {
              timeout: 540,
              outputDir: outDir,
              readOnly: 'bestEffort',
              maxContextKb: 50,
              maxParallel: 4,
            },
            tools: {},
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('cleanup', { env: { XDG_CONFIG_HOME: xdg } });
      expect(output).toContain(
        'Refusing to delete in non-interactive mode without --yes',
      );
      expect(existsSync(oldRun)).toBe(true);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  // ── Loop command tests ──

  it('loop --help shows loop-specific options', () => {
    const output = run('loop --help');
    expect(output).toContain('--rounds');
    expect(output).toContain('--duration');
    expect(output).toContain('--preset');
    expect(output).toContain('--list-presets');
    expect(output).toContain('--discovery-tool');
    expect(output).toContain('--convergence-threshold');
    expect(output).toContain('--file');
    expect(output).toContain('--tools');
    expect(output).toContain('--dry-run');
    expect(output).toContain('Multi-round dispatch');
  });

  it('run --help does not show loop-specific options', () => {
    const output = run('run --help');
    expect(output).not.toContain('--rounds');
    expect(output).not.toContain('--duration');
    expect(output).not.toContain('--preset');
    // But still has run-specific options
    expect(output).toContain('--file');
    expect(output).toContain('--tools');
    expect(output).toContain('--dry-run');
  });

  it('loop with no tools configured shows error', () => {
    const output = run('loop "test"', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });
    expect(output).toContain('No tools configured');
  });

  it('loop --list-presets prints built-in presets without requiring config', () => {
    const output = run('loop --list-presets', {
      env: { XDG_CONFIG_HOME: '/tmp/counselors-test-nonexistent' },
    });

    expect(output).toContain('Built-in presets:');
    expect(output).toContain('bughunt');
    expect(output).toContain('contracts');
    expect(output).toContain('hotspots');
    expect(output).toContain('invariants');
    expect(output).toContain('regression');
    expect(output).toContain('security');
  });

  it('loop --dry-run shows round plan info', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('loop --dry-run -t claude "test prompt"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('claude');
      expect(output).toContain('Rounds:');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('loop --dry-run with --rounds shows custom round count', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('loop --dry-run --rounds 7 -t claude "test prompt"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('Rounds: 7');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('loop --dry-run with --duration shows unlimited rounds', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run(
        'loop --dry-run --duration 30m -t claude "test prompt"',
        { env: { XDG_CONFIG_HOME: xdg } },
      );

      expect(output).toContain('unlimited');
      expect(output).toContain('30m');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('loop --preset resolves the bughunt preset in dry-run', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run(
        'loop --dry-run --preset bughunt "the billing module" -t claude',
        { env: { XDG_CONFIG_HOME: xdg } },
      );

      // In dry-run mode, the preset is resolved and shown in the output
      // without running the actual discovery and prompt-writing phases.
      expect(output).toContain('Preset: bughunt');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('loop --preset with unknown preset shows error', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
            },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('loop --preset nonexistent -t claude', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('Unknown preset "nonexistent"');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('loop --dry-run supports --group expansion', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
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
                binary: '/usr/bin/claude',
                adapter: 'claude',
                readOnly: { level: 'enforced' },
              },
              codex: {
                binary: '/usr/bin/codex',
                adapter: 'codex',
                readOnly: { level: 'enforced' },
              },
            },
            groups: { smart: ['claude', 'codex'] },
          },
          null,
          2,
        )}\n`,
      );

      const output = run('loop --dry-run --group smart "test"', {
        env: { XDG_CONFIG_HOME: xdg },
      });

      expect(output).toContain('claude');
      expect(output).toContain('codex');
      expect(output).toContain('Rounds:');
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it('cleanup --dry-run does not delete anything', () => {
    const xdg = mkdtempSync(join(tmpdir(), 'counselors-test-'));
    try {
      const configDir = join(xdg, 'counselors');
      mkdirSync(configDir, { recursive: true });

      const outDir = join(xdg, 'out');
      mkdirSync(outDir, { recursive: true });

      const oldRun = join(outDir, 'old-run');
      mkdirSync(oldRun, { recursive: true });
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      utimesSync(oldRun, twoDaysAgo, twoDaysAgo);

      writeFileSync(
        join(configDir, 'config.json'),
        `${JSON.stringify(
          {
            version: 1,
            defaults: {
              timeout: 540,
              outputDir: outDir,
              readOnly: 'bestEffort',
              maxContextKb: 50,
              maxParallel: 4,
            },
            tools: {},
            groups: {},
          },
          null,
          2,
        )}\n`,
      );

      const output = run('cleanup --dry-run', {
        env: { XDG_CONFIG_HOME: xdg },
      });
      expect(output).toContain('Dry run: would delete');
      expect(output).toContain('old-run');
      expect(existsSync(oldRun)).toBe(true);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });
});
