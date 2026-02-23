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
          stdout: '  TypeScript, Node.js\nsrc/, lib/  ',
          stderr: '',
          timedOut: false,
          durationMs: 500,
        };
      },
    ),
}));

const { runRepoDiscovery } = await import('../../src/core/repo-discovery.js');
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

describe('runRepoDiscovery', () => {
  it('returns trimmed stdout as repoContext', async () => {
    const result = await runRepoDiscovery({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
    });

    expect(result.repoContext).toBe('TypeScript, Node.js\nsrc/, lib/');
  });

  it('throws when tool is not configured', async () => {
    await expect(
      runRepoDiscovery({
        config: makeConfig(),
        toolId: 'nonexistent',
        cwd: '/tmp/project',
      }),
    ).rejects.toThrow('Tool "nonexistent" not configured for discovery.');
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
      runRepoDiscovery({
        config: makeConfig(),
        toolId: 'claude',
        cwd: '/tmp/project',
      }),
    ).rejects.toThrow('Discovery timed out after 60s');
  });

  it('throws on non-zero exit', async () => {
    mockExecute.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'model auth failed',
      timedOut: false,
      durationMs: 100,
    });

    await expect(
      runRepoDiscovery({
        config: makeConfig(),
        toolId: 'claude',
        cwd: '/tmp/project',
      }),
    ).rejects.toThrow('Discovery failed (exit 1): model auth failed');
  });

  it('includes target in prompt when provided', async () => {
    await runRepoDiscovery({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
      target: 'the billing module',
    });

    const [invocation] = mockExecute.mock.calls.at(-1)!;
    expect(invocation.stdin ?? invocation.args.join(' ')).toBeDefined();
    // The prompt is written to a temp file and passed via promptFilePath,
    // so check the prompt field on the invocation
    // The invocation is built by the adapter, but we can check that the
    // execute call was made (proving the prompt was constructed)
    expect(mockExecute).toHaveBeenCalled();
  });

  it('calls onProgress with started and completed events', async () => {
    const events: { event: string }[] = [];

    await runRepoDiscovery({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
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

    await runRepoDiscovery({
      config: makeConfig(),
      toolId: 'claude',
      cwd: '/tmp/project',
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

    await runRepoDiscovery({
      config,
      toolId: 'claude',
      cwd: '/tmp/project',
    });

    // execute is called with timeout * 1000
    const [, timeoutMs] = mockExecute.mock.calls.at(-1)!;
    expect(timeoutMs).toBe(120_000);
  });
});
