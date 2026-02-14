import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBinaryCandidatesForScan,
  findBinary,
  getWindowsExecutableExtensions,
} from '../../src/core/discovery.js';

describe('findBinary', () => {
  it('finds node binary', () => {
    const path = findBinary('node');
    expect(path).toBeTruthy();
    expect(path).toContain('node');
  });

  it('returns null for nonexistent binary', () => {
    const path = findBinary('totally-nonexistent-binary-xyz-123');
    expect(path).toBeNull();
  });

  it('finds npm binary', () => {
    const path = findBinary('npm');
    expect(path).toBeTruthy();
  });
});

describe('getWindowsExecutableExtensions', () => {
  it('normalizes and preserves order from PATHEXT', () => {
    expect(getWindowsExecutableExtensions('.EXE;.Cmd;.BAT')).toEqual([
      '.exe',
      '.cmd',
      '.bat',
      '.com',
    ]);
  });

  it('falls back to default executable extensions when PATHEXT is empty', () => {
    expect(getWindowsExecutableExtensions('')).toEqual([
      '.com',
      '.exe',
      '.bat',
      '.cmd',
    ]);
  });
});

describe('buildBinaryCandidatesForScan', () => {
  it('returns one candidate on non-windows', () => {
    expect(
      buildBinaryCandidatesForScan('/tools', 'codex', 'linux', '.EXE;.CMD'),
    ).toEqual([join('/tools', 'codex')]);
  });

  it('returns extension candidates on windows', () => {
    expect(
      buildBinaryCandidatesForScan('/tools', 'codex', 'win32', '.EXE;.CMD'),
    ).toEqual([
      join('/tools', 'codex.exe'),
      join('/tools', 'codex.cmd'),
      join('/tools', 'codex.com'),
      join('/tools', 'codex.bat'),
      join('/tools', 'codex'),
    ]);
  });

  it('does not append extensions when command already has one', () => {
    expect(
      buildBinaryCandidatesForScan('/tools', 'codex.cmd', 'win32', '.EXE;.CMD'),
    ).toEqual([join('/tools', 'codex.cmd')]);
  });
});
