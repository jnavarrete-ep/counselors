import type { Command } from 'commander';
import { VERSION } from '../constants.js';
import {
  detectInstallation,
  getStandaloneAssetName,
  performUpgrade,
} from '../core/upgrade.js';
import { error, info, success, warn } from '../ui/logger.js';

const METHOD_LABEL: Record<string, string> = {
  homebrew: 'Homebrew',
  npm: 'npm (global)',
  pnpm: 'pnpm (global)',
  yarn: 'yarn (global)',
  standalone: 'Standalone binary',
  unknown: 'Unknown',
};

export function registerUpgradeCommand(program: Command): void {
  program
    .command('upgrade')
    .description('Detect install method and upgrade counselors when possible')
    .option('--check', 'Only show install method/version details')
    .option('--dry-run', 'Show what would be done without upgrading')
    .option('--force', 'Force standalone self-upgrade outside safe locations')
    .action(
      async (opts: { check?: boolean; dryRun?: boolean; force?: boolean }) => {
        const detection = detectInstallation();

        info('');
        info(
          `Install method: ${METHOD_LABEL[detection.method] ?? detection.method}`,
        );
        info(`Running version: ${VERSION}`);
        if (detection.installedVersion) {
          info(`Installed version: ${detection.installedVersion}`);
        }
        if (detection.binaryPath) {
          info(`Binary path: ${detection.binaryPath}`);
        }
        info('');

        if (opts.check) return;

        const effective =
          detection.method === 'unknown' && opts.force && detection.binaryPath
            ? { ...detection, method: 'standalone' as const }
            : detection;

        if (opts.dryRun) {
          info('Dry run — no changes will be made.');
          if (detection.method === 'unknown' && !opts.force) {
            info(
              'Install method is unknown; would not run an automatic upgrade.',
            );
            warn('Try one of:');
            warn('  brew upgrade counselors');
            warn('  npm install -g counselors@latest');
            warn('  pnpm add -g counselors@latest');
            warn('  yarn global add counselors@latest');
            warn(
              '  curl -fsSL https://github.com/aarondfrancis/counselors/raw/main/install.sh | bash',
            );
            warn(
              'If this is a standalone install in a non-standard location, re-run with --force.',
            );
            return;
          }

          if (effective.method === 'standalone') {
            const assetName = getStandaloneAssetName();
            const targetPath =
              effective.resolvedBinaryPath ??
              effective.binaryPath ??
              '(unknown)';
            info(`Would self-upgrade standalone binary at: ${targetPath}`);
            if (assetName) {
              info(`Would download: ${assetName} and ${assetName}.sha256`);
            }
          } else {
            info(`Would run: ${effective.upgradeCommand ?? '(unknown)'}`);
          }
          return;
        }

        if (detection.method === 'unknown' && !opts.force) {
          error(
            'Could not detect a supported install method for auto-upgrades.',
          );
          if (detection.binaryPath) {
            warn(`Detected counselors binary at: ${detection.binaryPath}`);
          }
          warn('Try one of:');
          warn('  brew upgrade counselors');
          warn('  npm install -g counselors@latest');
          warn('  pnpm add -g counselors@latest');
          warn('  yarn global add counselors@latest');
          warn(
            '  curl -fsSL https://github.com/aarondfrancis/counselors/raw/main/install.sh | bash',
          );
          warn('');
          warn(
            'If this is a standalone install in a non-standard location, re-run with --force.',
          );
          process.exitCode = 1;
          return;
        }

        info(
          `Upgrading via ${METHOD_LABEL[effective.method] ?? effective.method}...`,
        );
        const result = await performUpgrade(effective, { force: opts.force });
        if (!result.ok) {
          error(result.message);
          process.exitCode = 1;
          return;
        }

        success(result.message);

        const refreshed = detectInstallation();
        if (refreshed.installedVersion) {
          info(`Detected version after upgrade: ${refreshed.installedVersion}`);
        } else {
          warn('Upgrade completed. Re-run "counselors --version" to verify.');
        }
      },
    );
}
