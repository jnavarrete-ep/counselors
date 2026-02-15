import { mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseDurationMs,
  scanCleanupCandidates,
} from '../../src/core/cleanup.js';

describe('parseDurationMs', () => {
  it('parses duration with units', () => {
    expect(parseDurationMs('1d')).toBe(24 * 60 * 60 * 1000);
    expect(parseDurationMs('12h')).toBe(12 * 60 * 60 * 1000);
    expect(parseDurationMs('30m')).toBe(30 * 60 * 1000);
    expect(parseDurationMs('45s')).toBe(45 * 1000);
    expect(parseDurationMs('500ms')).toBe(500);
    expect(parseDurationMs('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  it('supports decimals and trimming', () => {
    expect(parseDurationMs('1.5h')).toBe(90 * 60 * 1000);
    expect(parseDurationMs('  1D  ')).toBe(24 * 60 * 60 * 1000);
  });

  it('treats a bare number as days', () => {
    expect(parseDurationMs('7')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('throws on invalid input', () => {
    expect(() => parseDurationMs('')).toThrow();
    expect(() => parseDurationMs('abc')).toThrow();
    expect(() => parseDurationMs('1x')).toThrow();
  });
});

describe('scanCleanupCandidates', () => {
  it('reports base dir missing', () => {
    const base = join(tmpdir(), `counselors-cleanup-missing-${Date.now()}`);
    const result = scanCleanupCandidates(base, Date.now());
    expect(result.baseExists).toBe(false);
    expect(result.candidates).toEqual([]);
  });

  it('returns directories older than cutoff', () => {
    const base = join(tmpdir(), `counselors-cleanup-test-${Date.now()}`);
    mkdirSync(base, { recursive: true });

    try {
      const oldDir = join(base, 'old');
      const newDir = join(base, 'new');
      mkdirSync(oldDir, { recursive: true });
      mkdirSync(newDir, { recursive: true });

      const now = Date.now();
      const cutoff = now - parseDurationMs('1d');
      const oldTime = new Date(now - parseDurationMs('2d'));
      utimesSync(oldDir, oldTime, oldTime);

      const result = scanCleanupCandidates(base, cutoff);
      expect(result.baseExists).toBe(true);
      expect(result.candidates.map((c) => c.name)).toEqual(['old']);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
