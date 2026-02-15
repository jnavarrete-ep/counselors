import { describe, expect, it } from 'vitest';
import { executeTest } from '../../src/core/executor.js';
import type { ToolAdapter, ToolConfig } from '../../src/types.js';

const fakeAdapter: ToolAdapter = {
  id: 'test-adapter',
  displayName: 'Test Adapter',
  commands: ['test'],
  installUrl: 'https://example.com',
  readOnly: { level: 'none' },
  models: [{ id: 'model-1', name: 'Model 1' }],
  buildInvocation: (req) => ({
    cmd: 'node',
    args: ['-e', 'process.stdout.write(process.argv[1] || "")', 'OK'],
    cwd: req.cwd,
  }),
};

const fakeToolConfig: ToolConfig = {
  binary: 'node',
  readOnly: { level: 'none' },
};

describe('executeTest', () => {
  it('uses toolName when provided', async () => {
    const result = await executeTest(
      fakeAdapter,
      fakeToolConfig,
      'my-custom-name',
    );
    expect(result.toolId).toBe('my-custom-name');
  });

  it('falls back to adapter.id when toolName is omitted', async () => {
    const result = await executeTest(fakeAdapter, fakeToolConfig);
    expect(result.toolId).toBe('test-adapter');
  });

  it('reports passed when output contains OK', async () => {
    const result = await executeTest(fakeAdapter, fakeToolConfig);
    expect(result.passed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('overrides stdin for stdin-based adapters', async () => {
    // This script echoes stdin; executeTest should override stdin with the
    // test prompt ("Reply with exactly: OK"), so output contains "OK".
    const catAdapter: ToolAdapter = {
      ...fakeAdapter,
      id: 'stdin-test',
      buildInvocation: (req) => ({
        cmd: 'node',
        args: [
          '-e',
          'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>process.stdout.write(d))',
        ],
        stdin: 'this-should-be-overridden',
        cwd: req.cwd,
      }),
    };

    const result = await executeTest(catAdapter, fakeToolConfig);
    expect(result.passed).toBe(true);
    expect(result.output).toContain('OK');
  });

  it('replaces last arg for argument-based adapters', async () => {
    // This script outputs argv[1] — executeTest should replace the last arg
    // with the test prompt, so output contains "OK".
    const echoAdapter: ToolAdapter = {
      ...fakeAdapter,
      buildInvocation: (req) => ({
        cmd: 'node',
        args: [
          '-e',
          'process.stdout.write(process.argv[1] || "")',
          'placeholder-to-be-replaced',
        ],
        cwd: req.cwd,
      }),
    };

    const result = await executeTest(echoAdapter, fakeToolConfig);
    expect(result.passed).toBe(true);
    expect(result.output).toContain('Reply with exactly: OK');
  });

  it('passes extraFlags from toolConfig to adapter', async () => {
    const configWithFlags: ToolConfig = {
      ...fakeToolConfig,
      extraFlags: ['--model', 'opus'],
    };

    let capturedReq: any;
    const spyAdapter: ToolAdapter = {
      ...fakeAdapter,
      buildInvocation: (req) => {
        capturedReq = req;
        return {
          cmd: 'node',
          args: ['-e', 'process.stdout.write(process.argv[1] || "")', 'OK'],
          cwd: req.cwd,
        };
      },
    };

    await executeTest(spyAdapter, configWithFlags);
    expect(capturedReq.extraFlags).toEqual(['--model', 'opus']);
  });

  it('passes binary from toolConfig to adapter', async () => {
    const configWithBinary: ToolConfig = {
      ...fakeToolConfig,
      binary: '/custom/path/to/tool',
    };

    let capturedReq: any;
    const spyAdapter: ToolAdapter = {
      ...fakeAdapter,
      buildInvocation: (req) => {
        capturedReq = req;
        return {
          cmd: 'node',
          args: ['-e', 'process.stdout.write(process.argv[1] || "")', 'OK'],
          cwd: req.cwd,
        };
      },
    };

    await executeTest(spyAdapter, configWithBinary);
    expect(capturedReq.binary).toBe('/custom/path/to/tool');
  });
});
