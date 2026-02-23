import type { ExecResult, ToolReport } from '../types.js';

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export function buildToolReport(
  toolId: string,
  result: ExecResult,
): ToolReport {
  return {
    toolId,
    status: result.timedOut
      ? 'timeout'
      : result.exitCode === 0
        ? 'success'
        : 'error',
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    wordCount: countWords(result.stdout),
    outputFile: '',
    stderrFile: '',
    error: result.exitCode !== 0 ? result.stderr.slice(0, 500) : undefined,
  };
}
