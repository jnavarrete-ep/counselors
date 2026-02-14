import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeWriteFile } from '../../src/core/fs-utils.js';

const testDir = join(tmpdir(), `counselors-fs-test-${Date.now()}`);

beforeEach(() => {
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe('safeWriteFile', () => {
  it('writes a file atomically', () => {
    const path = join(testDir, 'test.txt');
    safeWriteFile(path, 'hello world');
    expect(readFileSync(path, 'utf-8')).toBe('hello world');
  });

  it('overwrites existing files', () => {
    const path = join(testDir, 'overwrite.txt');
    safeWriteFile(path, 'first');
    safeWriteFile(path, 'second');
    expect(readFileSync(path, 'utf-8')).toBe('second');
  });

  it('does not leave temp files on success', () => {
    const path = join(testDir, 'clean.txt');
    safeWriteFile(path, 'content');
    const files = readdirSync(testDir);
    expect(files).toEqual(['clean.txt']);
  });

  it('applies file mode when option is provided', () => {
    if (process.platform === 'win32') return;

    const path = join(testDir, 'secure.txt');
    safeWriteFile(path, 'secret', { mode: 0o600 });
    expect(readFileSync(path, 'utf-8')).toBe('secret');
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('throws on write failure instead of swallowing', () => {
    // Writing to a nonexistent directory should throw
    const path = join(testDir, 'no-such-dir', 'nested', 'file.txt');
    expect(() => safeWriteFile(path, 'content')).toThrow();
  });

  it('cleans up temp file on failure', () => {
    const path = join(testDir, 'no-such-dir', 'nested', 'file.txt');
    try {
      safeWriteFile(path, 'content');
    } catch {
      // expected
    }
    // No temp files should remain in testDir
    const files = readdirSync(testDir);
    expect(files).toHaveLength(0);
  });

  it('overwrites symlinks atomically (rename replaces target)', () => {
    if (process.platform === 'win32') return;

    // Create a regular file and a symlink pointing to it
    const realFile = join(testDir, 'real.txt');
    const symlink = join(testDir, 'link.txt');
    safeWriteFile(realFile, 'original');
    symlinkSync(realFile, symlink);

    // Writing to the symlink path should replace the symlink with a regular file
    safeWriteFile(symlink, 'new content');
    // The content at the symlink path should be the new content
    expect(readFileSync(symlink, 'utf-8')).toBe('new content');
  });
});
