import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  deleteCleanupCandidates,
  parseDurationMs,
  scanCleanupCandidates,
} from '../core/cleanup.js';
import { loadConfig, loadProjectConfig, mergeConfigs } from '../core/config.js';
import { error, info, success, warn } from '../ui/logger.js';
import { confirmAction } from '../ui/prompts.js';

function formatDurationForHumans(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

export function registerCleanupCommand(program: Command): void {
  program
    .command('cleanup')
    .description('Delete run output directories older than a given age')
    .option(
      '--older-than <duration>',
      'Delete runs older than this age (e.g. 1d, 12h, 30m, 2w, 500ms). Defaults to 1d. A bare number is days.',
      '1d',
    )
    .option(
      '-o, --output-dir <dir>',
      'Base output directory (overrides config)',
    )
    .option('--dry-run', 'Show what would be deleted without removing files')
    .option('-y, --yes', 'Do not prompt for confirmation')
    .option('--json', 'Output results as JSON')
    .action(
      async (opts: {
        olderThan: string;
        outputDir?: string;
        dryRun?: boolean;
        yes?: boolean;
        json?: boolean;
      }) => {
        const cwd = process.cwd();
        const globalConfig = loadConfig();
        const projectConfig = loadProjectConfig(cwd);
        const config = mergeConfigs(globalConfig, projectConfig);

        let olderThanMs: number;
        try {
          olderThanMs = parseDurationMs(opts.olderThan);
        } catch (e) {
          error(e instanceof Error ? e.message : String(e));
          process.exitCode = 1;
          return;
        }

        if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
          error(`Invalid --older-than value "${opts.olderThan}".`);
          process.exitCode = 1;
          return;
        }

        const baseDir = opts.outputDir || config.defaults.outputDir;
        const absBaseDir = resolve(cwd, baseDir);
        const cutoffMs = Date.now() - olderThanMs;

        const { baseExists, candidates, skippedSymlinks } =
          scanCleanupCandidates(absBaseDir, cutoffMs);

        if (!baseExists) {
          info(`No output directory found at: ${absBaseDir}`);
          return;
        }

        if (skippedSymlinks.length > 0) {
          warn(
            `Skipping ${skippedSymlinks.length} symlink(s) in output dir for safety.`,
          );
        }

        if (candidates.length === 0) {
          info(
            `No run output directories older than ${formatDurationForHumans(
              olderThanMs,
            )} to clean up.`,
          );
          return;
        }

        if (opts.dryRun) {
          if (opts.json) {
            info(
              JSON.stringify(
                {
                  baseDir: absBaseDir,
                  olderThan: opts.olderThan,
                  candidates: candidates.map((c) => ({
                    name: c.name,
                    path: c.path,
                    mtimeMs: c.mtimeMs,
                  })),
                },
                null,
                2,
              ),
            );
          } else {
            info(
              `Dry run: would delete ${candidates.length} director${
                candidates.length === 1 ? 'y' : 'ies'
              } under ${absBaseDir}`,
            );
            for (const c of candidates) {
              info(`- ${c.name}`);
            }
          }
          return;
        }

        if (!opts.yes) {
          if (!process.stderr.isTTY) {
            error(
              'Refusing to delete in non-interactive mode without --yes. Re-run with --dry-run to preview.',
            );
            process.exitCode = 1;
            return;
          }

          const ok = await confirmAction(
            `Delete ${candidates.length} director${
              candidates.length === 1 ? 'y' : 'ies'
            } under ${absBaseDir} older than ${formatDurationForHumans(
              olderThanMs,
            )}?`,
          );
          if (!ok) {
            info('Aborted.');
            return;
          }
        }

        const result = deleteCleanupCandidates(candidates);

        if (opts.json) {
          info(
            JSON.stringify(
              {
                baseDir: absBaseDir,
                olderThan: opts.olderThan,
                deleted: result.deleted,
                failed: result.failed,
              },
              null,
              2,
            ),
          );
        } else {
          if (result.deleted.length > 0) {
            success(
              `Deleted ${result.deleted.length} director${
                result.deleted.length === 1 ? 'y' : 'ies'
              }.`,
            );
          }
          if (result.failed.length > 0) {
            error(
              `Failed to delete ${result.failed.length} director${
                result.failed.length === 1 ? 'y' : 'ies'
              }.`,
            );
            for (const f of result.failed) {
              warn(`${f.path}: ${f.error}`);
            }
            process.exitCode = 1;
          }
        }
      },
    );
}
