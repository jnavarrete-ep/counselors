import { z } from 'zod';

// ── Read-only levels ──

export type ReadOnlyLevel = 'enforced' | 'bestEffort' | 'none';

// ── Config schemas (zod) ──

export const ToolConfigSchema = z.object({
  binary: z.string(),
  adapter: z.string().optional(),
  readOnly: z.object({
    level: z.enum(['enforced', 'bestEffort', 'none']),
    flags: z.array(z.string()).optional(),
  }),
  extraFlags: z.array(z.string()).optional(),
  timeout: z.number().optional(),
  stdin: z.boolean().optional(),
  custom: z.boolean().optional(),
});

export type ToolConfig = z.infer<typeof ToolConfigSchema>;

export const ConfigSchema = z.object({
  version: z.literal(1),
  defaults: z
    .object({
      timeout: z.number().default(900),
      outputDir: z.string().default('./agents/counselors'),
      readOnly: z
        .enum(['enforced', 'bestEffort', 'none'])
        .default('bestEffort'),
      maxContextKb: z.number().default(50),
      maxParallel: z.number().default(4),
    })
    .default({}),
  tools: z.record(z.string(), ToolConfigSchema).default({}),
  groups: z.record(z.string(), z.array(z.string())).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── Runtime types ──

export interface RunRequest {
  prompt: string;
  promptFilePath: string;
  toolId: string;
  outputDir: string;
  readOnlyPolicy: ReadOnlyLevel;
  timeout: number;
  cwd: string;
  binary?: string;
  extraFlags?: string[];
}

export interface Invocation {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
  cwd: string;
}

export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export interface CostInfo {
  cost_usd: number;
  free_used_usd: number;
  credits_used_usd: number;
  source: 'free' | 'credits';
  free_remaining_usd: number;
  free_total_usd: number;
  credits_remaining_usd: number;
}

export interface ToolReport {
  toolId: string;
  status: 'success' | 'error' | 'timeout' | 'skipped';
  exitCode: number;
  durationMs: number;
  wordCount: number;
  outputFile: string;
  stderrFile: string;
  cost?: CostInfo;
  error?: string;
}

// ── Adapter interface ──

export interface ToolAdapter {
  id: string;
  displayName: string;
  commands: string[];
  installUrl: string;
  readOnly: { level: ReadOnlyLevel };
  modelFlag?: string;
  models: {
    id: string;
    name: string;
    recommended?: boolean;
    compoundId?: string;
    extraFlags?: string[];
  }[];
  buildInvocation(req: RunRequest): Invocation;
  parseResult?(result: ExecResult): Partial<ToolReport>;
  /** Return the effective read-only level for a specific tool configuration.
   *  Adapters override this when certain models have weaker enforcement. */
  getEffectiveReadOnlyLevel?(toolConfig: ToolConfig): ReadOnlyLevel;
}

// ── Discovery ──

export interface DiscoveryResult {
  toolId: string;
  found: boolean;
  path: string | null;
  version: string | null;
}

// ── Doctor ──

export interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

// ── Test ──

export interface TestResult {
  toolId: string;
  passed: boolean;
  output: string;
  error?: string;
  durationMs: number;
  command?: string;
}

// ── Round manifest (multi-round mode) ──

export interface RoundManifest {
  round: number;
  timestamp: string;
  tools: ToolReport[];
}

// ── Run manifest ──

export interface RunManifest {
  timestamp: string;
  slug: string;
  prompt: string;
  promptSource: 'inline' | 'file' | 'stdin';
  readOnlyPolicy: ReadOnlyLevel;
  tools: ToolReport[];
  rounds?: RoundManifest[];
  totalRounds?: number;
  durationMs?: number;
  preset?: string;
}
