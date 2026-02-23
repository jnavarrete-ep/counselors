import { describe, expect, it, vi } from 'vitest';
import { createReporter, NullReporter } from '../../src/ui/reporter.js';

describe('NullReporter', () => {
  it('has all interface methods as no-ops', () => {
    const r = new NullReporter();
    // Should not throw
    r.discoveryStarted('claude');
    r.discoveryCompleted('claude');
    r.promptWritingStarted('claude');
    r.promptWritingCompleted('claude');
    r.executionStarted('/tmp/out', ['claude']);
    r.toolStarted('claude', 123);
    r.toolCompleted('claude', {
      toolId: 'claude',
      status: 'success',
      exitCode: 0,
      durationMs: 1000,
      wordCount: 100,
      outputFile: '/tmp/out/claude.md',
      stderrFile: '/tmp/out/claude.stderr',
    });
    r.executionFinished();
    r.roundStarted(1, 3);
    r.roundCompleted(1);
    r.convergenceDetected(2, 0.15, 0.3);
    r.printSummary(
      {
        timestamp: '',
        slug: 'test',
        prompt: 'test',
        promptSource: 'inline',
        readOnlyPolicy: 'none',
        tools: [],
      },
      {},
    );
  });

  it('printSummary produces no stdout output (dry-run safety)', () => {
    const originalWrite = process.stdout.write;
    let stdoutOutput = '';
    process.stdout.write = vi.fn((chunk: any) => {
      stdoutOutput += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    }) as any;
    try {
      const r = new NullReporter();
      r.printSummary(
        {
          timestamp: '',
          slug: 'test',
          prompt: 'test',
          promptSource: 'inline',
          readOnlyPolicy: 'none',
          tools: [
            {
              toolId: 'claude',
              status: 'success',
              exitCode: 0,
              durationMs: 1000,
              wordCount: 100,
              outputFile: '/tmp/claude.md',
              stderrFile: '/tmp/claude.stderr',
            },
          ],
        },
        { json: true },
      );
      expect(stdoutOutput).toBe('');
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});

describe('createReporter', () => {
  it('returns NullReporter for dry-run', () => {
    const r = createReporter({ dryRun: true });
    expect(r).toBeInstanceOf(NullReporter);
  });

  it('returns AgentReporter when stderr is not a TTY', async () => {
    const orig = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', {
      value: false,
      configurable: true,
    });
    try {
      const { AgentReporter } = await import('../../src/ui/agent-reporter.js');
      const r = createReporter();
      expect(r).toBeInstanceOf(AgentReporter);
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: orig,
        configurable: true,
      });
    }
  });

  it('returns TerminalReporter when stderr is a TTY', async () => {
    const orig = process.stderr.isTTY;
    Object.defineProperty(process.stderr, 'isTTY', {
      value: true,
      configurable: true,
    });
    try {
      const { TerminalReporter } = await import(
        '../../src/ui/terminal-reporter.js'
      );
      const r = createReporter();
      expect(r).toBeInstanceOf(TerminalReporter);
    } finally {
      Object.defineProperty(process.stderr, 'isTTY', {
        value: orig,
        configurable: true,
      });
    }
  });
});
