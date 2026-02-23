import { describe, expect, it } from 'vitest';
import { buildToolReport, countWords } from '../../src/core/text-utils.js';
import type { ExecResult } from '../../src/types.js';

describe('countWords', () => {
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });

  it('returns 0 for whitespace-only string', () => {
    expect(countWords('   \n\t  ')).toBe(0);
  });

  it('counts words in normal text', () => {
    expect(countWords('hello world foo bar')).toBe(4);
  });

  it('handles multiple whitespace between words', () => {
    expect(countWords('  hello   world  ')).toBe(2);
  });
});

describe('buildToolReport', () => {
  function makeResult(overrides: Partial<ExecResult> = {}): ExecResult {
    return {
      exitCode: 0,
      stdout: 'some output text',
      stderr: '',
      timedOut: false,
      durationMs: 1234,
      ...overrides,
    };
  }

  it('builds a success report', () => {
    const report = buildToolReport('claude', makeResult());
    expect(report.toolId).toBe('claude');
    expect(report.status).toBe('success');
    expect(report.exitCode).toBe(0);
    expect(report.durationMs).toBe(1234);
    expect(report.wordCount).toBe(3);
    expect(report.outputFile).toBe('');
    expect(report.stderrFile).toBe('');
    expect(report.error).toBeUndefined();
  });

  it('builds a timeout report', () => {
    const report = buildToolReport(
      'amp',
      makeResult({ timedOut: true, exitCode: 1 }),
    );
    expect(report.status).toBe('timeout');
  });

  it('builds an error report with truncated stderr', () => {
    const longStderr = 'x'.repeat(1000);
    const report = buildToolReport(
      'codex',
      makeResult({ exitCode: 1, stderr: longStderr }),
    );
    expect(report.status).toBe('error');
    expect(report.error).toHaveLength(500);
  });

  it('does not set error for exit code 0', () => {
    const report = buildToolReport(
      'test',
      makeResult({ stderr: 'some warning' }),
    );
    expect(report.error).toBeUndefined();
  });
});
