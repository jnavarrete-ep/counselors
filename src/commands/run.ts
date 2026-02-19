import { copyFileSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { isBuiltInTool, resolveAdapter } from '../adapters/index.js';
import { loadConfig, loadProjectConfig, mergeConfigs } from '../core/config.js';
import { gatherContext } from '../core/context.js';
import { dispatch } from '../core/dispatcher.js';
import { safeWriteFile } from '../core/fs-utils.js';
import {
  buildPrompt,
  generateSlug,
  generateSlugFromFile,
  resolveOutputDir,
} from '../core/prompt-builder.js';
import { synthesize } from '../core/synthesis.js';
import type {
  Config,
  ReadOnlyLevel,
  RunManifest,
  ToolReport,
} from '../types.js';
import { error, info } from '../ui/logger.js';
import { formatDryRun, formatRunSummary } from '../ui/output.js';
import { ProgressDisplay } from '../ui/progress.js';
import { selectRunTools } from '../ui/prompts.js';

function expandDuplicateToolIds(
  toolIds: string[],
  config: Config,
): { toolIds: string[]; config: Config } {
  const used = new Set(Object.keys(config.tools));
  const nextSuffix: Record<string, number> = {};
  let expandedTools: Config['tools'] | null = null;

  const expanded: string[] = [];
  for (const id of toolIds) {
    const next = nextSuffix[id] ?? 1;
    if (next === 1) {
      nextSuffix[id] = 2;
      expanded.push(id);
      continue;
    }

    let suffix = next;
    let candidate = `${id}__${suffix}`;
    while (used.has(candidate)) {
      suffix++;
      candidate = `${id}__${suffix}`;
    }
    nextSuffix[id] = suffix + 1;

    if (!expandedTools) expandedTools = { ...config.tools };

    const baseConfig = config.tools[id];
    // Base tool existence is validated earlier; this is a defensive fallback.
    if (baseConfig) {
      const needsAdapter = !baseConfig.adapter && isBuiltInTool(id);
      expandedTools[candidate] = needsAdapter
        ? { ...baseConfig, adapter: id }
        : baseConfig;
    }

    used.add(candidate);
    expanded.push(candidate);
  }

  if (!expandedTools) return { toolIds, config };
  return { toolIds: expanded, config: { ...config, tools: expandedTools } };
}

export function registerRunCommand(program: Command): void {
  program
    .command('run [prompt]')
    .description('Dispatch prompt to configured AI tools in parallel')
    .option('-f, --file <path>', 'Use a pre-built prompt file (no wrapping)')
    .option('-t, --tools <tools>', 'Comma-separated list of tools to use')
    .option(
      '-g, --group <groups>',
      'Comma-separated group name(s) to run (expands to tool IDs)',
    )
    .option(
      '--context <paths>',
      'Gather context from paths (comma-separated, or "." for git diff)',
    )
    .option('--read-only <level>', 'Read-only policy: strict, best-effort, off')
    .option('--dry-run', 'Show what would be dispatched without running')
    .option('--json', 'Output manifest as JSON')
    .option('-o, --output-dir <dir>', 'Base output directory')
    .action(
      async (
        promptArg: string | undefined,
        opts: {
          file?: string;
          tools?: string;
          group?: string;
          context?: string;
          readOnly?: string;
          dryRun?: boolean;
          json?: boolean;
          outputDir?: string;
        },
      ) => {
        const cwd = process.cwd();
        const globalConfig = loadConfig();
        const projectConfig = loadProjectConfig(cwd);
        let config = mergeConfigs(globalConfig, projectConfig);

        // Determine tools to use
        let toolIds: string[];
        const groupNames = opts.group
          ? opts.group
              .split(',')
              .map((g) => g.trim())
              .filter(Boolean)
          : [];
        const explicitSelection = Boolean(opts.tools || groupNames.length > 0);

        const groupToolIds: string[] = [];
        if (groupNames.length > 0) {
          for (const groupName of groupNames) {
            const ids = config.groups[groupName];
            if (!ids) {
              error(
                `Group "${groupName}" is not configured. Run "counselors groups list".`,
              );
              process.exitCode = 1;
              return;
            }

            for (const id of ids) {
              if (!config.tools[id]) {
                error(
                  `Group "${groupName}" references tool "${id}", but it is not configured.`,
                );
                process.exitCode = 1;
                return;
              }
            }

            groupToolIds.push(...ids);
          }
        }

        const explicitToolIds = opts.tools
          ? opts.tools
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [];

        toolIds = explicitSelection
          ? [...groupToolIds, ...explicitToolIds]
          : Object.keys(config.tools);

        if (toolIds.length === 0) {
          if (Object.keys(config.tools).length === 0) {
            error('No tools configured. Run "counselors init" first.');
          } else {
            error('No tools selected.');
          }
          process.exitCode = 1;
          return;
        }

        // Validate all tools exist in config
        for (const id of toolIds) {
          if (!config.tools[id]) {
            error(
              `Tool "${id}" not configured. Run "counselors tools add ${id}".`,
            );
            process.exitCode = 1;
            return;
          }
        }

        // Interactive tool selection when no --tools flag and TTY
        if (
          !explicitSelection &&
          !opts.dryRun &&
          process.stderr.isTTY &&
          toolIds.length > 1
        ) {
          const selected = await selectRunTools(toolIds);
          if (selected.length === 0) {
            error('No tools selected.');
            process.exitCode = 1;
            return;
          }
          toolIds = selected;
        }

        // Allow running the same configured tool multiple times by repeating it.
        // Example: --tools claude-opus,claude-opus,claude-opus
        {
          const expanded = expandDuplicateToolIds(toolIds, config);
          toolIds = expanded.toolIds;
          config = expanded.config;
        }

        // Map read-only flag (fall back to config default)
        const internalToCliMap: Record<string, string> = {
          enforced: 'strict',
          bestEffort: 'best-effort',
          none: 'off',
        };
        const readOnlyInput =
          opts.readOnly ??
          internalToCliMap[config.defaults.readOnly] ??
          'best-effort';
        const readOnlyMap: Record<string, ReadOnlyLevel> = {
          strict: 'enforced',
          'best-effort': 'bestEffort',
          off: 'none',
        };
        const readOnlyPolicy = readOnlyMap[readOnlyInput];
        if (!readOnlyPolicy) {
          error(
            `Invalid --read-only value "${readOnlyInput}". Must be: strict, best-effort, or off.`,
          );
          process.exitCode = 1;
          return;
        }

        // Resolve prompt
        let promptContent: string;
        let promptSource: 'inline' | 'file' | 'stdin';
        let slug: string;

        if (opts.file) {
          // File mode: use as-is, no wrapping
          const filePath = resolve(cwd, opts.file);
          try {
            promptContent = readFileSync(filePath, 'utf-8');
          } catch {
            error(`Cannot read prompt file: ${filePath}`);
            process.exitCode = 1;
            return;
          }
          promptSource = 'file';
          slug = generateSlugFromFile(filePath);
        } else if (promptArg) {
          // Inline prompt: wrap in template
          promptSource = 'inline';
          slug = generateSlug(promptArg);

          const context = opts.context
            ? gatherContext(
                cwd,
                opts.context === '.' ? [] : opts.context.split(','),
                config.defaults.maxContextKb,
              )
            : undefined;

          promptContent = buildPrompt(promptArg, context);
        } else {
          // Check stdin
          if (process.stdin.isTTY) {
            error(
              'No prompt provided. Pass as argument, use -f <file>, or pipe via stdin.',
            );
            process.exitCode = 1;
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of process.stdin) {
            chunks.push(chunk);
          }
          const stdinContent = Buffer.concat(chunks).toString('utf-8').trim();
          if (!stdinContent) {
            error('Empty prompt from stdin.');
            process.exitCode = 1;
            return;
          }

          promptSource = 'stdin';
          slug = generateSlug(stdinContent);

          const context = opts.context
            ? gatherContext(
                cwd,
                opts.context === '.' ? [] : opts.context.split(','),
                config.defaults.maxContextKb,
              )
            : undefined;

          promptContent = buildPrompt(stdinContent, context);
        }

        if (!slug) slug = `run-${Date.now()}`;

        // Dry run — no filesystem side effects
        if (opts.dryRun) {
          const baseDir = opts.outputDir || config.defaults.outputDir;
          const dryOutputDir = join(baseDir, slug);
          const dryPromptFile = resolve(dryOutputDir, 'prompt.md');
          const invocations = toolIds.map((id) => {
            const toolConfig = config.tools[id];
            const adapter = resolveAdapter(id, toolConfig);
            const inv = adapter.buildInvocation({
              prompt: promptContent,
              promptFilePath: dryPromptFile,
              toolId: id,
              outputDir: dryOutputDir,
              readOnlyPolicy,
              timeout: config.defaults.timeout,
              cwd,
              binary: toolConfig.binary,
              extraFlags: toolConfig.extraFlags,
            });
            return {
              toolId: id,
              cmd: inv.cmd,
              args: inv.args,
            };
          });
          info(formatDryRun(invocations));
          return;
        }

        // Resolve output directory (creates it)
        const baseDir = opts.outputDir || config.defaults.outputDir;
        const outputDir = resolveOutputDir(baseDir, slug);

        // Write prompt file
        const promptFilePath = resolve(outputDir, 'prompt.md');
        if (opts.file) {
          copyFileSync(resolve(cwd, opts.file), promptFilePath);
        } else {
          safeWriteFile(promptFilePath, promptContent);
        }

        // Dispatch
        const display = new ProgressDisplay(toolIds, outputDir);

        let reports: ToolReport[];
        try {
          reports = await dispatch({
            config,
            toolIds,
            promptFilePath,
            promptContent,
            outputDir,
            readOnlyPolicy,
            cwd,
            onProgress: (event) => {
              if (event.event === 'started')
                display.start(event.toolId, event.pid);
              if (event.event === 'completed')
                display.complete(event.toolId, event.report!);
            },
          });
        } finally {
          display.stop();
        }

        // Build manifest
        const manifest: RunManifest = {
          timestamp: new Date().toISOString(),
          slug,
          prompt:
            promptArg || (opts.file ? `file:${basename(opts.file)}` : 'stdin'),
          promptSource,
          readOnlyPolicy,
          tools: reports,
        };

        // Write manifest + synthesis
        safeWriteFile(
          resolve(outputDir, 'run.json'),
          JSON.stringify(manifest, null, 2),
        );
        const summary = synthesize(manifest, outputDir);
        safeWriteFile(resolve(outputDir, 'summary.md'), summary);

        // Output
        if (opts.json) {
          info(JSON.stringify(manifest, null, 2));
        } else {
          info(formatRunSummary(manifest));
        }
      },
    );
}
