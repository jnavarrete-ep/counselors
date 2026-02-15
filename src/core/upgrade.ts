import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { VERSION_TIMEOUT } from '../constants.js';
import { findBinary, getBinaryVersion } from './discovery.js';

export type InstallMethod =
  | 'homebrew'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'standalone'
  | 'unknown';

export interface InstallDetection {
  method: InstallMethod;
  binaryPath: string | null;
  resolvedBinaryPath: string | null;
  installedVersion: string | null;
  brewVersion: string | null;
  npmVersion: string | null;
  npmPrefix: string | null;
  brewPath: string | null;
  npmPath: string | null;
  pnpmPath: string | null;
  yarnPath: string | null;
  upgradeCommand: string | null;
}

export interface DetectInstallMethodInput {
  binaryPath: string | null;
  resolvedBinaryPath: string | null;
  brewVersion: string | null;
  npmVersion: string | null;
  npmPrefix: string | null;
  pnpmPath: string | null;
  yarnPath: string | null;
  homeDir: string;
}

interface CaptureResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface RunResult {
  ok: boolean;
  exitCode: number;
  errorMessage?: string;
}

export interface UpgradeDeps {
  captureCommand?: (cmd: string, args: string[]) => CaptureResult;
  runCommand?: (cmd: string, args: string[]) => RunResult;
  findBinaryFn?: (command: string) => string | null;
  realpathFn?: (path: string) => string;
  homeDir?: string;
  fetchFn?: typeof fetch;
}

export interface PerformUpgradeOptions {
  force?: boolean;
}

export interface UpgradeOutcome {
  ok: boolean;
  method: InstallMethod;
  message: string;
}

interface GithubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubLatestRelease {
  tag_name?: string;
  assets?: GithubReleaseAsset[];
}

export interface StandaloneUpgradeResult {
  version: string;
  tag: string;
  assetName: string;
  targetPath: string;
  didUpgrade: boolean;
}

export function parseBrewVersion(output: string): string | null {
  const trimmed = output.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^counselors\s+([^\s]+)/m);
  return match?.[1] ?? null;
}

export function parseNpmLsVersion(output: string): string | null {
  if (!output.trim()) return null;
  try {
    const parsed = JSON.parse(output) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const version = parsed.dependencies?.counselors?.version;
    return typeof version === 'string' ? version : null;
  } catch {
    return null;
  }
}

export function getStandaloneAssetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string | null {
  let os: string;
  if (platform === 'darwin') {
    os = 'darwin';
  } else if (platform === 'linux') {
    os = 'linux';
  } else {
    return null;
  }

  let normalizedArch: string;
  if (arch === 'x64') {
    normalizedArch = 'x64';
  } else if (arch === 'arm64') {
    normalizedArch = 'arm64';
  } else {
    return null;
  }

  return `counselors-${os}-${normalizedArch}`;
}

function getSafeStandaloneRoots(homeDir: string): string[] {
  const roots = [
    normalizePath(join(homeDir, '.local', 'bin')),
    normalizePath(join(homeDir, 'bin')),
  ];
  return roots.filter((r): r is string => Boolean(r));
}

function isSafeStandalonePath(path: string | null, homeDir: string): boolean {
  if (!path) return false;
  const normalized = normalizePath(path);
  if (!normalized) return false;

  return getSafeStandaloneRoots(homeDir).some(
    (root) => normalized === root || normalized.startsWith(`${root}/`),
  );
}

function isLikelyPnpmInstall(
  binaryPath: string | null,
  resolvedBinaryPath: string | null,
  homeDir: string,
): boolean {
  const candidates = [binaryPath, resolvedBinaryPath]
    .map((p) => normalizePath(p))
    .filter((p): p is string => Boolean(p));

  const pnpmRoots = [
    // Defaults from pnpm docs
    normalizePath(join(homeDir, 'Library', 'pnpm')), // macOS
    normalizePath(join(homeDir, '.local', 'share', 'pnpm')), // Linux
  ].filter((p): p is string => Boolean(p));

  return candidates.some((p) => {
    if (p.includes('/.pnpm/')) return true;
    if (p.includes('/pnpm/')) return true;
    return pnpmRoots.some((root) => p === root || p.startsWith(`${root}/`));
  });
}

function isLikelyYarnGlobalInstall(
  binaryPath: string | null,
  resolvedBinaryPath: string | null,
  homeDir: string,
): boolean {
  const candidates = [binaryPath, resolvedBinaryPath]
    .map((p) => normalizePath(p))
    .filter((p): p is string => Boolean(p));

  const yarnRoots = [
    normalizePath(join(homeDir, '.yarn', 'bin')), // yarn classic global bin
    normalizePath(join(homeDir, '.config', 'yarn', 'global')), // yarn classic global dir
  ].filter((p): p is string => Boolean(p));

  return candidates.some((p) => {
    if (p.includes('/.yarn/')) return true;
    return yarnRoots.some((root) => p === root || p.startsWith(`${root}/`));
  });
}

export function detectInstallMethod(
  input: DetectInstallMethodInput,
): InstallMethod {
  const binaryPath = normalizePath(input.binaryPath);
  const resolvedBinaryPath = normalizePath(input.resolvedBinaryPath);
  const npmPrefix = normalizePath(input.npmPrefix);
  const homeDir = normalizePath(input.homeDir) ?? input.homeDir;

  if (
    resolvedBinaryPath?.includes('/Cellar/counselors/') ||
    resolvedBinaryPath?.includes('/Homebrew/Cellar/counselors/')
  ) {
    return 'homebrew';
  }

  if (
    input.pnpmPath &&
    isLikelyPnpmInstall(binaryPath, resolvedBinaryPath, homeDir)
  ) {
    return 'pnpm';
  }

  if (
    input.yarnPath &&
    isLikelyYarnGlobalInstall(binaryPath, resolvedBinaryPath, homeDir)
  ) {
    return 'yarn';
  }

  const npmCandidates = npmPrefix
    ? process.platform === 'win32'
      ? [
          normalizePath(join(npmPrefix, 'counselors.cmd')),
          normalizePath(join(npmPrefix, 'counselors')),
        ]
      : [normalizePath(join(npmPrefix, 'bin', 'counselors'))]
    : [];
  if (
    binaryPath &&
    npmCandidates.some((candidate) => candidate === binaryPath)
  ) {
    return 'npm';
  }

  if (resolvedBinaryPath?.includes('/node_modules/counselors/')) {
    return 'npm';
  }

  if (
    isSafeStandalonePath(binaryPath, homeDir) ||
    isSafeStandalonePath(resolvedBinaryPath, homeDir)
  ) {
    return 'standalone';
  }

  if (input.brewVersion && !input.npmVersion) return 'homebrew';
  if (input.npmVersion && !input.brewVersion) return 'npm';

  return 'unknown';
}

export function detectInstallation(deps: UpgradeDeps = {}): InstallDetection {
  const findBinaryFn = deps.findBinaryFn ?? findBinary;
  const captureCommand = deps.captureCommand ?? defaultCaptureCommand;
  const homeDir = deps.homeDir ?? homedir();
  const realpathFn = deps.realpathFn ?? realpathSync;

  const binaryPath = findBinaryFn('counselors');
  const resolvedBinaryPath = binaryPath
    ? safeRealPath(binaryPath, realpathFn)
    : null;

  const brewPath = findBinaryFn('brew');
  const npmPath = findBinaryFn('npm');
  const pnpmPath = findBinaryFn('pnpm');
  const yarnPath = findBinaryFn('yarn');

  const hasBrew = Boolean(brewPath);
  const hasNpm = Boolean(npmPath);

  const brewVersion = hasBrew
    ? parseBrewVersion(
        captureCommand(brewPath!, ['list', '--versions', 'counselors']).stdout,
      )
    : null;

  const npmPrefix = hasNpm
    ? captureCommand(npmPath!, ['prefix', '-g']).stdout.trim() || null
    : null;
  const npmVersion =
    hasNpm && npmPrefix ? readNpmGlobalVersion(npmPrefix) : null;
  const npmVersionFallback =
    hasNpm && npmPath
      ? readNpmGlobalVersionFromNpmLs(captureCommand, npmPath)
      : null;
  const effectiveNpmVersion = npmVersion ?? npmVersionFallback;

  const method = detectInstallMethod({
    binaryPath,
    resolvedBinaryPath,
    brewVersion,
    npmVersion: effectiveNpmVersion,
    npmPrefix,
    pnpmPath,
    yarnPath,
    homeDir,
  });

  let installedVersion: string | null = null;
  if (method === 'homebrew') {
    installedVersion = brewVersion;
  } else if (method === 'npm') {
    installedVersion = effectiveNpmVersion;
  } else if (method === 'standalone' && binaryPath) {
    installedVersion = extractVersion(getBinaryVersion(binaryPath));
  }

  const upgradeCommand =
    method === 'homebrew'
      ? 'brew upgrade counselors'
      : method === 'npm'
        ? 'npm install -g counselors@latest'
        : method === 'pnpm'
          ? 'pnpm add -g counselors@latest'
          : method === 'yarn'
            ? 'yarn global add counselors@latest'
            : method === 'standalone'
              ? 'counselors upgrade'
              : null;

  return {
    method,
    binaryPath,
    resolvedBinaryPath,
    installedVersion,
    brewVersion,
    npmVersion: effectiveNpmVersion,
    npmPrefix,
    brewPath,
    npmPath,
    pnpmPath,
    yarnPath,
    upgradeCommand,
  };
}

export async function performUpgrade(
  detection: InstallDetection,
  opts: PerformUpgradeOptions = {},
  deps: UpgradeDeps = {},
): Promise<UpgradeOutcome> {
  const runCommand = deps.runCommand ?? defaultRunCommand;

  if (detection.method === 'homebrew') {
    return runManagerUpgrade(
      runCommand,
      'homebrew',
      detection.brewPath ?? 'brew',
      ['upgrade', 'counselors'],
    );
  }

  if (detection.method === 'npm') {
    return runManagerUpgrade(runCommand, 'npm', detection.npmPath ?? 'npm', [
      'install',
      '-g',
      'counselors@latest',
    ]);
  }

  if (detection.method === 'pnpm') {
    return runManagerUpgrade(runCommand, 'pnpm', detection.pnpmPath ?? 'pnpm', [
      'add',
      '-g',
      'counselors@latest',
    ]);
  }

  if (detection.method === 'yarn') {
    return runManagerUpgrade(runCommand, 'yarn', detection.yarnPath ?? 'yarn', [
      'global',
      'add',
      'counselors@latest',
    ]);
  }

  if (detection.method === 'standalone') {
    if (!detection.binaryPath) {
      return {
        ok: false,
        method: detection.method,
        message:
          'Standalone install detected, but counselors binary path was not found.',
      };
    }

    const targetPath = resolveStandaloneTargetPath(detection.binaryPath);
    const homeDir = deps.homeDir ?? homedir();
    const safe = isSafeStandalonePath(targetPath, homeDir);
    if (!safe && !opts.force) {
      return {
        ok: false,
        method: detection.method,
        message:
          `Refusing to self-replace counselors outside user-owned install locations.\n` +
          `Detected path: ${targetPath}\n` +
          `Re-run with --force if you are sure this is a standalone install.`,
      };
    }

    try {
      const result = await upgradeStandaloneBinary(
        detection.binaryPath,
        detection.installedVersion,
        deps,
      );
      return {
        ok: true,
        method: detection.method,
        message: result.didUpgrade
          ? `Upgraded standalone binary to ${result.version} (${result.assetName}).`
          : `Already up to date (${result.version}).`,
      };
    } catch (e) {
      return {
        ok: false,
        method: detection.method,
        message:
          e instanceof Error
            ? e.message
            : 'Standalone upgrade failed for an unknown reason.',
      };
    }
  }

  return {
    ok: false,
    method: detection.method,
    message:
      'Could not detect a supported install method. Supported methods: Homebrew, npm, pnpm, yarn, standalone binary.',
  };
}

export async function upgradeStandaloneBinary(
  binaryPath: string,
  installedVersion: string | null,
  deps: UpgradeDeps = {},
): Promise<StandaloneUpgradeResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const assetName = getStandaloneAssetName();
  if (!assetName) {
    throw new Error(
      `Standalone upgrades are only supported on macOS and Linux x64/arm64. Current platform: ${process.platform}/${process.arch}.`,
    );
  }

  const checksumAssetName = `${assetName}.sha256`;

  const latestUrl =
    'https://api.github.com/repos/aarondfrancis/counselors/releases/latest';
  const latestRes = await fetchFn(latestUrl, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'counselors-cli',
    },
  });
  if (!latestRes.ok) {
    throw new Error(
      `Failed to fetch latest release metadata (${latestRes.status} ${latestRes.statusText}).`,
    );
  }

  const release = (await latestRes.json()) as GithubLatestRelease;
  const tag = release.tag_name;
  if (!tag || typeof tag !== 'string') {
    throw new Error('Latest release metadata did not include a valid tag.');
  }

  const latestVersion = stripLeadingV(tag);
  const targetPath = resolveStandaloneTargetPath(binaryPath);

  if (
    installedVersion &&
    stripLeadingV(installedVersion.trim()) === latestVersion
  ) {
    return {
      version: latestVersion,
      tag,
      assetName,
      targetPath,
      didUpgrade: false,
    };
  }

  const checksumAsset =
    release.assets?.find(
      (a) =>
        a.name === checksumAssetName &&
        typeof a.browser_download_url === 'string' &&
        a.browser_download_url.length > 0,
    ) ?? null;
  const checksumUrl =
    checksumAsset?.browser_download_url ??
    `https://github.com/aarondfrancis/counselors/releases/download/${tag}/${checksumAssetName}`;

  const asset =
    release.assets?.find(
      (a) =>
        a.name === assetName &&
        typeof a.browser_download_url === 'string' &&
        a.browser_download_url.length > 0,
    ) ?? null;
  const downloadUrl =
    asset?.browser_download_url ??
    `https://github.com/aarondfrancis/counselors/releases/download/${tag}/${assetName}`;

  const checksumRes = await fetchFn(checksumUrl, {
    headers: { 'User-Agent': 'counselors-cli' },
  });
  if (!checksumRes.ok) {
    throw new Error(
      `Failed to download checksum ${checksumAssetName} (${checksumRes.status} ${checksumRes.statusText}).`,
    );
  }
  const checksumText = await checksumRes.text();
  const expectedHash = parseSha256File(checksumText, assetName);
  if (!expectedHash) {
    throw new Error(`Could not parse SHA256 from ${checksumAssetName}.`);
  }

  const binaryRes = await fetchFn(downloadUrl, {
    headers: { 'User-Agent': 'counselors-cli' },
  });
  if (!binaryRes.ok) {
    throw new Error(
      `Failed to download ${assetName} (${binaryRes.status} ${binaryRes.statusText}).`,
    );
  }

  const bytes = Buffer.from(await binaryRes.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('Downloaded binary was empty.');
  }

  const tempPath = `${targetPath}.tmp-${Date.now()}`;
  const backupPath = uniqueBackupPath(targetPath);

  const actualHash = sha256(bytes);
  if (!hashesEqual(actualHash, expectedHash)) {
    throw new Error(
      `Checksum mismatch for ${assetName}.\nExpected: ${expectedHash}\nActual:   ${actualHash}`,
    );
  }

  try {
    ensureWritable(dirname(targetPath));

    writeFileSync(tempPath, bytes, { mode: 0o755 });
    chmodSync(tempPath, 0o755);

    // Move current binary out of the way first so we can roll back cleanly.
    renameSync(targetPath, backupPath);

    try {
      renameSync(tempPath, targetPath);
      chmodSync(targetPath, 0o755);
      validateExecutable(targetPath);

      // Upgrade successful; remove backup.
      rmSync(backupPath, { force: true });
    } catch (e) {
      // Roll back best-effort.
      try {
        if (existsSync(targetPath)) rmSync(targetPath, { force: true });
      } catch {
        // ignore
      }
      try {
        if (existsSync(backupPath)) renameSync(backupPath, targetPath);
      } catch {
        // ignore
      }
      throw e;
    }
  } finally {
    if (existsSync(tempPath)) {
      unlinkSync(tempPath);
    }
  }

  return {
    version: latestVersion,
    tag,
    assetName,
    targetPath,
    didUpgrade: true,
  };
}

function runManagerUpgrade(
  runCommand: (cmd: string, args: string[]) => RunResult,
  method: InstallMethod,
  cmd: string,
  args: string[],
): UpgradeOutcome {
  const result = runCommand(cmd, args);
  if (result.ok) {
    return {
      ok: true,
      method,
      message: `Upgrade command completed: ${cmd} ${args.join(' ')}`,
    };
  }

  return {
    ok: false,
    method,
    message: `Upgrade command failed: ${cmd} ${args.join(' ')}${result.errorMessage ? ` (${result.errorMessage})` : ''}`,
  };
}

function resolveStandaloneTargetPath(binaryPath: string): string {
  try {
    const stat = lstatSync(binaryPath);
    if (stat.isSymbolicLink()) {
      return realpathSync(binaryPath);
    }
  } catch {
    // Fall through to original path
  }
  return binaryPath;
}

function extractVersion(value: string | null): string | null {
  if (!value) return null;
  const semverMatch = value.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (semverMatch) return semverMatch[0];
  const firstToken = value.trim().split(/\s+/)[0];
  return firstToken || null;
}

function stripLeadingV(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

function safeRealPath(
  path: string,
  realpathFn: (path: string) => string,
): string | null {
  try {
    return realpathFn(path);
  } catch {
    return path;
  }
}

function normalizePath(path: string | null): string | null {
  if (!path) return null;
  return resolve(path).replace(/\\/g, '/');
}

function defaultCaptureCommand(cmd: string, args: string[]): CaptureResult {
  try {
    const stdout = execFileSync(cmd, args, {
      timeout: VERSION_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    }).trim();
    return {
      ok: true,
      stdout,
      stderr: '',
      exitCode: 0,
    };
  } catch (error) {
    const stdout = toText((error as { stdout?: unknown }).stdout).trim();
    const stderr = toText((error as { stderr?: unknown }).stderr).trim();
    const exitCode =
      typeof (error as { status?: unknown }).status === 'number'
        ? ((error as { status?: number }).status ?? 1)
        : 1;
    return {
      ok: false,
      stdout,
      stderr,
      exitCode,
    };
  }
}

function defaultRunCommand(cmd: string, args: string[]): RunResult {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
  });
  if (result.error) {
    return {
      ok: false,
      exitCode: 1,
      errorMessage: result.error.message,
    };
  }
  const exitCode = result.status ?? 1;
  return {
    ok: exitCode === 0,
    exitCode,
  };
}

function readNpmGlobalVersion(npmPrefix: string): string | null {
  const packageJsonPaths =
    process.platform === 'win32'
      ? [join(npmPrefix, 'node_modules', 'counselors', 'package.json')]
      : [
          join(npmPrefix, 'lib', 'node_modules', 'counselors', 'package.json'),
          join(npmPrefix, 'node_modules', 'counselors', 'package.json'),
        ];

  for (const packageJsonPath of packageJsonPaths) {
    if (!existsSync(packageJsonPath)) continue;
    try {
      const raw = readFileSync(packageJsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { version?: string };
      if (typeof parsed.version === 'string') {
        return parsed.version;
      }
    } catch {
      // Keep checking other candidate paths.
    }
  }

  return null;
}

function readNpmGlobalVersionFromNpmLs(
  captureCommand: (cmd: string, args: string[]) => CaptureResult,
  npmPath: string,
): string | null {
  const result = captureCommand(npmPath, [
    'ls',
    '-g',
    'counselors',
    '--depth=0',
    '--json',
  ]);
  if (!result.ok) return null;
  return parseNpmLsVersion(result.stdout);
}

function parseSha256File(text: string, filename: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // sha256sum: "<hash>  <filename>"
    let match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (match) {
      const hash = match[1]!.toLowerCase();
      const file = match[2]!.trim();
      if (file === filename || file.endsWith(`/${filename}`)) return hash;
      continue;
    }

    // openssl: "SHA256(filename)= <hash>"
    match = line.match(/^SHA256\((.+)\)=\s*([a-fA-F0-9]{64})$/);
    if (match) {
      const file = match[1]!.trim();
      const hash = match[2]!.toLowerCase();
      if (file === filename || file.endsWith(`/${filename}`)) return hash;
      continue;
    }

    // bare hash
    if (/^[a-fA-F0-9]{64}$/.test(line)) return line.toLowerCase();
  }

  return null;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashesEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function uniqueBackupPath(targetPath: string): string {
  const base = `${targetPath}.bak`;
  if (!existsSync(base)) return base;
  return `${base}.${Date.now()}`;
}

function ensureWritable(dir: string): void {
  try {
    accessSync(dir, constants.W_OK);
  } catch {
    throw new Error(
      `No write permission to upgrade counselors in: ${dir}\n` +
        `Try reinstalling in ~/.local/bin or use your package manager to upgrade.`,
    );
  }
}

function validateExecutable(path: string): void {
  try {
    execFileSync(path, ['--version'], {
      timeout: VERSION_TIMEOUT,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
  } catch (e) {
    throw new Error(
      `Post-upgrade validation failed for ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return '';
}
