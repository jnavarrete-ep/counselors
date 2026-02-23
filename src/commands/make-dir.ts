import type { Command } from 'commander';
import { loadConfig, loadProjectConfig, mergeConfigs } from '../core/config.js';
import { generateSlug } from '../core/prompt-builder.js';
import { info } from '../ui/logger.js';
import { createOutputDir, resolvePrompt } from './_run-shared.js';

export function registerMakeDirCommand(program: Command): void {
  program
    .command('mkdir [prompt]')
    .description(
      'Create an output directory and write prompt.md without dispatching (supports prompt arg, -f, or stdin)',
    )
    .option('-f, --file <path>', 'Use a pre-built prompt file (no wrapping)')
    .option(
      '--context <paths>',
      'Gather context from paths (comma-separated, or "." for git diff)',
    )
    .option('-o, --output-dir <dir>', 'Base output directory')
    .option(
      '--json',
      'Output metadata as JSON (outputDir, promptFilePath, slug, promptSource)',
    )
    .action(
      async (
        promptArg: string | undefined,
        opts: {
          file?: string;
          context?: string;
          outputDir?: string;
          json?: boolean;
        },
      ) => {
        const cwd = process.cwd();
        const globalConfig = loadConfig();
        const projectConfig = loadProjectConfig(cwd);
        const config = mergeConfigs(globalConfig, projectConfig);

        const prompt = await resolvePrompt(promptArg, opts, cwd, config);
        if (!prompt) return;

        const slug = prompt.slug || generateSlug('prompt');
        const { outputDir, promptFilePath } = createOutputDir(
          opts,
          slug,
          prompt.promptContent,
          cwd,
          config,
        );

        if (opts.json) {
          info(
            JSON.stringify(
              {
                outputDir,
                promptFilePath,
                slug,
                promptSource: prompt.promptSource,
              },
              null,
              2,
            ),
          );
          return;
        }

        info(`Output directory: ${outputDir}`);
        info(`Prompt file: ${promptFilePath}`);
        info(`Slug: ${slug}`);
      },
    );
}
