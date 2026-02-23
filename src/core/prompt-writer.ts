import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAdapter } from '../adapters/index.js';
import type { Config } from '../types.js';
import type { ProgressEvent } from './dispatcher.js';
import { execute } from './executor.js';
import { buildToolReport } from './text-utils.js';

export interface PromptWriterOptions {
  config: Config;
  toolId: string;
  cwd: string;
  userInput: string;
  presetDescription: string;
  repoContext: string;
  onProgress?: (event: ProgressEvent) => void;
}

export interface PromptWriterResult {
  generatedPrompt: string;
}

/**
 * Phase 2: Takes user input + preset description + repo context and produces
 * the full execution prompt via an agent. The agent's entire stdout becomes
 * the prompt.
 */
export async function writePrompt(
  options: PromptWriterOptions,
): Promise<PromptWriterResult> {
  const {
    config,
    toolId,
    cwd,
    userInput,
    presetDescription,
    repoContext,
    onProgress,
  } = options;

  const toolConfig = config.tools[toolId];
  if (!toolConfig) {
    throw new Error(`Tool "${toolId}" not configured for prompt writing.`);
  }

  const adapter = resolveAdapter(toolId, toolConfig);

  const prompt = `You are a prompt-writing agent. Your job is to write a detailed prompt that other AI coding agents will follow to analyze a software project.

## User's Focus
${userInput}

## Preset Description
${presetDescription}

## Repository Context
${repoContext}

## Your Task
Write a comprehensive, self-contained prompt that instructs AI coding agents to perform the analysis described above. The prompt should:

1. Clearly state the objective based on the preset description and user's focus area
2. Reference specific directories and technologies from the repository context
3. Be detailed enough that agents can work independently without further clarification
4. Include what to look for and how to structure findings

Output ONLY the prompt text. Do not include any meta-commentary, markdown fences, or explanation — your entire output will be used directly as the prompt.`;

  const tmpDir = mkdtempSync(join(tmpdir(), 'counselors-prompt-writer-'));
  const promptFile = join(tmpDir, 'meta-prompt.md');
  writeFileSync(promptFile, prompt, 'utf-8');

  const timeout = toolConfig.timeout ?? config.defaults.timeout;
  const invocation = adapter.buildInvocation({
    prompt,
    promptFilePath: promptFile,
    toolId,
    outputDir: tmpDir,
    readOnlyPolicy: 'enforced',
    timeout,
    cwd,
    binary: toolConfig.binary,
    extraFlags: toolConfig.extraFlags,
  });

  let result;
  try {
    result = await execute(invocation, timeout * 1000, (pid) => {
      onProgress?.({ toolId, event: 'started', pid });
    });
  } finally {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  onProgress?.({
    toolId,
    event: 'completed',
    report: buildToolReport(toolId, result),
  });

  if (result.timedOut) {
    throw new Error(`Prompt writing timed out after ${timeout}s.`);
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `Prompt writing failed (exit ${result.exitCode}): ${result.stderr.slice(0, 500)}`,
    );
  }

  return { generatedPrompt: result.stdout.trim() };
}
