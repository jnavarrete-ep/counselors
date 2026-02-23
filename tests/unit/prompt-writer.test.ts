import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../../src/types.js';

vi.mock('../../src/core/executor.js', () => ({
  execute: vi
    .fn()
    .mockImplementation(
      async (
        _inv: any,
        _timeout: any,
        onSpawn?: (pid: number | undefined) => void,
      ) => {
        onSpawn?.(9999);
        return {
          exitCode: 0,
          stdout: '  Generated execution prompt for bug hunting  ',
          stderr: '',
          timedOut: false,
          durationMs: 2000,
        };
      },
    ),
}));

const { writePrompt } = await import('../../src/core/prompt-writer.js');
const { execute } = await import('../../src/core/executor.js');
const mockExecute = vi.mocked(execute);

function makeConfig(tools?: Config['tools']): Config {
  return {
    version: 1,
    defaults: {
      timeout: 60,
      outputDir: './agents/counselors',
      readOnly: 'bestEffort',
      maxContextKb: 50,
      maxParallel: 4,
    },
    tools: tools ?? {
      claude: {
        binary: '/usr/bin/claude',
        readOnly: { level: 'enforced' },
      },
    },
    groups: {},
  };
}

beforeEach(() => {
  mockExecute.mockClear();
});

describe('writePrompt', () => {
  it('returns trimmed stdout as generatedPrompt', async () => {
    const result = await writePrompt({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
      userInput: 'the billing module',
      presetDescription: 'Find bugs',
      repoContext: 'TypeScript project',
    });

    expect(result.generatedPrompt).toBe(
      'Generated execution prompt for bug hunting',
    );
  });

  it('throws when tool is not configured', async () => {
    await expect(
      writePrompt({
        config: makeConfig(),
        toolId: 'nonexistent',
        cwd: '/tmp/project',
        userInput: 'test',
        presetDescription: 'test',
        repoContext: 'test',
      }),
    ).rejects.toThrow('Tool "nonexistent" not configured for prompt writing.');
  });

  it('throws on timeout', async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 60000,
    });

    await expect(
      writePrompt({
        config: makeConfig(),
        toolId: 'claude',
        cwd: '/tmp/project',
        userInput: 'test',
        presetDescription: 'test',
        repoContext: 'test',
      }),
    ).rejects.toThrow('Prompt writing timed out after 60s');
  });

  it('throws on non-zero exit', async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 2,
      stdout: '',
      stderr: 'rate limited',
      timedOut: false,
      durationMs: 100,
    });

    await expect(
      writePrompt({
        config: makeConfig(),
        toolId: 'claude',
        cwd: '/tmp/project',
        userInput: 'test',
        presetDescription: 'test',
        repoContext: 'test',
      }),
    ).rejects.toThrow('Prompt writing failed (exit 2): rate limited');
  });

  it('calls onProgress with started and completed events', async () => {
    const events: { event: string }[] = [];

    await writePrompt({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
      userInput: 'the billing module',
      presetDescription: 'Find bugs',
      repoContext: 'TypeScript project',
      onProgress: (e) => events.push({ event: e.event }),
    });

    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('started');
    expect(events[1].event).toBe('completed');
  });

  it('reports timeout status in progress event when timed out', async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: '',
      timedOut: true,
      durationMs: 60000,
    });

    const events: { event: string; status?: string }[] = [];

    await writePrompt({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
      userInput: 'test',
      presetDescription: 'test',
      repoContext: 'test',
      onProgress: (e) =>
        events.push({ event: e.event, status: e.report?.status }),
    }).catch(() => {});

    const completed = events.find((e) => e.event === 'completed');
    expect(completed?.status).toBe('timeout');
  });

  it('uses tool-specific timeout when configured', async () => {
    const config = makeConfig({
      claude: {
        binary: '/usr/bin/claude',
        readOnly: { level: 'enforced' },
        timeout: 120,
      },
    });

    await writePrompt({
      config,
      toolId: 'claude',
      cwd: '/tmp/project',
      userInput: 'test',
      presetDescription: 'test',
      repoContext: 'test',
    });

    // execute is called with timeout * 1000
    const [, timeoutMs] = mockExecute.mock.calls.at(-1)!;
    expect(timeoutMs).toBe(120_000);
  });
});
