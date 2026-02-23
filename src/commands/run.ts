import { resolve } from 'node:path';
import type { Command } from 'commander';
import { dispatch } from '../core/dispatcher.js';
import { safeWriteFile } from '../core/fs-utils.js';
import { generateSlug } from '../core/prompt-builder.js';
import { synthesize } from '../core/synthesis.js';
import type { RunManifest, ToolReport } from '../types.js';
import { info } from '../ui/logger.js';
import { formatDryRun } from '../ui/output.js';
import { createReporter } from '../ui/reporter.js';
import {
  buildDryRunInvocations,
  createOutputDir,
  getPromptLabel,
  resolvePrompt,
  resolveReadOnlyPolicy,
  resolveTools,
} from './_run-shared.js';

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

        // Resolve tools
        const resolved = await resolveTools(opts, cwd);
        if (!resolved) return;
        const { toolIds, config } = resolved;

        // Resolve read-only policy
        const readOnlyPolicy = resolveReadOnlyPolicy(opts.readOnly, config);
        if (!readOnlyPolicy) return;

        // Resolve prompt
        const prompt = await resolvePrompt(promptArg, opts, cwd, config);
        if (!prompt) return;
        let { promptContent, promptSource, slug } = prompt;
        if (!slug) slug = generateSlug('run');

        // Dry run — no filesystem side effects
        if (opts.dryRun) {
          const baseDir = opts.outputDir || config.defaults.outputDir;
          const dryOutputDir = resolve(cwd, baseDir, slug);
          const invocations = buildDryRunInvocations(
            config,
            toolIds,
            promptContent,
            dryOutputDir,
            readOnlyPolicy,
            cwd,
          );
          info(formatDryRun(invocations));
          return;
        }

        // Create output directory
        const { outputDir, promptFilePath } = createOutputDir(
          opts,
          slug,
          promptContent,
          cwd,
          config,
        );

        const promptLabel = getPromptLabel(promptArg, opts.file);

        // Dispatch (single-shot)
        const reporter = createReporter();
        reporter.executionStarted(outputDir, toolIds);

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
                reporter.toolStarted(event.toolId, event.pid);
              if (event.event === 'completed')
                reporter.toolCompleted(event.toolId, event.report!);
            },
          });
        } finally {
          reporter.executionFinished();
        }

        // Build manifest
        const manifest: RunManifest = {
          timestamp: new Date().toISOString(),
          slug,
          prompt: promptLabel,
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
        reporter.printSummary(manifest, { json: opts.json });
      },
    );
}
