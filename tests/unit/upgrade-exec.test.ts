import { describe, expect, it, vi } from 'vitest';
import {
  type InstallDetection,
  performUpgrade,
} from '../../src/core/upgrade.js';

function makeDetection(
  partial: Partial<InstallDetection> & { method: InstallDetection['method'] },
): InstallDetection {
  return {
    method: partial.method,
    binaryPath: null,
    resolvedBinaryPath: null,
    installedVersion: null,
    brewVersion: null,
    npmVersion: null,
    npmPrefix: null,
    brewPath: null,
    npmPath: null,
    pnpmPath: null,
    yarnPath: null,
    upgradeCommand: null,
    ...partial,
  };
}

describe('performUpgrade', () => {
  it('runs brew upgrade when method is homebrew', async () => {
    const runCommand = vi.fn().mockReturnValue({ ok: true, exitCode: 0 });
    const detection = makeDetection({
      method: 'homebrew',
      brewPath: '/usr/local/bin/brew',
    });
    const result = await performUpgrade(detection, {}, { runCommand });
    expect(runCommand).toHaveBeenCalledWith('/usr/local/bin/brew', [
      'upgrade',
      'counselors',
    ]);
    expect(result.ok).toBe(true);
  });

  it('runs npm install -g when method is npm', async () => {
    const runCommand = vi.fn().mockReturnValue({ ok: true, exitCode: 0 });
    const detection = makeDetection({ method: 'npm', npmPath: '/usr/bin/npm' });
    const result = await performUpgrade(detection, {}, { runCommand });
    expect(runCommand).toHaveBeenCalledWith('/usr/bin/npm', [
      'install',
      '-g',
      'counselors@latest',
    ]);
    expect(result.ok).toBe(true);
  });

  it('runs pnpm add -g when method is pnpm', async () => {
    const runCommand = vi.fn().mockReturnValue({ ok: true, exitCode: 0 });
    const detection = makeDetection({
      method: 'pnpm',
      pnpmPath: '/usr/bin/pnpm',
    });
    const result = await performUpgrade(detection, {}, { runCommand });
    expect(runCommand).toHaveBeenCalledWith('/usr/bin/pnpm', [
      'add',
      '-g',
      'counselors@latest',
    ]);
    expect(result.ok).toBe(true);
  });

  it('runs yarn global add when method is yarn', async () => {
    const runCommand = vi.fn().mockReturnValue({ ok: true, exitCode: 0 });
    const detection = makeDetection({
      method: 'yarn',
      yarnPath: '/usr/bin/yarn',
    });
    const result = await performUpgrade(detection, {}, { runCommand });
    expect(runCommand).toHaveBeenCalledWith('/usr/bin/yarn', [
      'global',
      'add',
      'counselors@latest',
    ]);
    expect(result.ok).toBe(true);
  });

  it('refuses unsafe standalone upgrades without --force', async () => {
    const detection = makeDetection({
      method: 'standalone',
      binaryPath: '/usr/bin/counselors',
    });
    const result = await performUpgrade(detection, { force: false });
    expect(result.ok).toBe(false);
    expect(result.message).toContain('--force');
  });

  it('returns an error for unknown method', async () => {
    const detection = makeDetection({ method: 'unknown' });
    const result = await performUpgrade(detection);
    expect(result.ok).toBe(false);
  });
});
