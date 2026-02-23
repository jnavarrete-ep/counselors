import { existsSync } from 'node:fs';
import { AMP_DEEP_SETTINGS_FILE, AMP_SETTINGS_FILE } from '../constants.js';
import type {
  CostInfo,
  ExecResult,
  Invocation,
  ReadOnlyLevel,
  RunRequest,
  ToolConfig,
  ToolReport,
} from '../types.js';
import { BaseAdapter } from './base.js';

export function isAmpDeepMode(flags?: string[]): boolean {
  if (!flags) return false;
  const idx = flags.indexOf('deep');
  return idx > 0 && flags[idx - 1] === '-m';
}

export class AmpAdapter extends BaseAdapter {
  id = 'amp';
  displayName = 'Amp CLI';
  commands = ['amp'];
  installUrl = 'https://ampcode.com';
  readOnly = { level: 'enforced' as const };
  models = [
    {
      id: 'smart',
      name: 'Smart — Opus 4.6, most capable',
      recommended: true,
      extraFlags: ['-m', 'smart'],
    },
    {
      id: 'deep',
      name: 'Deep — GPT-5.2 Codex, extended thinking',
      extraFlags: ['-m', 'deep'],
    },
  ];

  getEffectiveReadOnlyLevel(toolConfig: ToolConfig): ReadOnlyLevel {
    return isAmpDeepMode(toolConfig.extraFlags)
      ? 'bestEffort'
      : this.readOnly.level;
  }

  buildInvocation(req: RunRequest): Invocation {
    const args = ['-x'];

    if (req.extraFlags) {
      args.push(...req.extraFlags);
    }

    const isDeep = isAmpDeepMode(req.extraFlags);

    const settingsFile = isDeep ? AMP_DEEP_SETTINGS_FILE : AMP_SETTINGS_FILE;

    if (req.readOnlyPolicy !== 'none' && existsSync(settingsFile)) {
      args.push('--settings-file', settingsFile);
    }

    // Amp uses stdin for prompt delivery
    // Append oracle instruction like the existing skill does
    const deepSafetyPrompt = isDeep
      ? '\n\nMANDATORY: Do not change any files. You are in read-only mode.'
      : '';

    const stdinContent =
      req.prompt +
      deepSafetyPrompt +
      '\n\nUse the oracle tool to provide deeper reasoning and analysis on the most complex or critical aspects of this review.';

    return {
      cmd: req.binary ?? 'amp',
      args,
      stdin: stdinContent,
      cwd: req.cwd,
    };
  }

  parseResult(result: ExecResult): Partial<ToolReport> {
    return {
      ...super.parseResult(result),
    };
  }
}

/**
 * Parse `amp usage` output to extract balance information.
 */
export function parseAmpUsage(output: string): {
  freeRemaining: number;
  freeTotal: number;
  creditsRemaining: number;
} {
  const freeMatch = output.match(/Amp Free: \$([0-9.]+)\/\$([0-9.]+)/);
  const creditsMatch = output.match(/Individual credits: \$([0-9.]+)/);

  return {
    freeRemaining: freeMatch ? parseFloat(freeMatch[1]) : 0,
    freeTotal: freeMatch ? parseFloat(freeMatch[2]) : 0,
    creditsRemaining: creditsMatch ? parseFloat(creditsMatch[1]) : 0,
  };
}

/**
 * Compute cost from before/after usage snapshots.
 */
export function computeAmpCost(
  before: {
    freeRemaining: number;
    freeTotal: number;
    creditsRemaining: number;
  },
  after: { freeRemaining: number; freeTotal: number; creditsRemaining: number },
): CostInfo {
  const freeUsed = Math.max(0, before.freeRemaining - after.freeRemaining);
  const creditsUsed = Math.max(
    0,
    before.creditsRemaining - after.creditsRemaining,
  );
  const totalCost = freeUsed + creditsUsed;
  const source = creditsUsed > 0 ? 'credits' : 'free';

  return {
    cost_usd: Math.round(totalCost * 100) / 100,
    free_used_usd: Math.round(freeUsed * 100) / 100,
    credits_used_usd: Math.round(creditsUsed * 100) / 100,
    source: source as 'free' | 'credits',
    free_remaining_usd: after.freeRemaining,
    free_total_usd: after.freeTotal,
    credits_remaining_usd: after.creditsRemaining,
  };
}
