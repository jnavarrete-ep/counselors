import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
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
    expect(output).toContain('doctor');
    expect(output).toContain('init');
    expect(output).toContain('upgrade');
    expect(output).toContain('tools');
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
    expect(output).toContain('--dry-run');
    expect(output).toContain('--read-only');
  });

  it('agent command prints instructions', () => {
    const output = run('agent');
    expect(output).toContain('Setup & Skill Installation');
    expect(output).toContain('counselors init');
    expect(output).toContain('counselors skill');
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
});
