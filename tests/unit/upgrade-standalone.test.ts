import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  getStandaloneAssetName,
  upgradeStandaloneBinary,
} from '../../src/core/upgrade.js';

const assetName = getStandaloneAssetName();
const describeStandalone = assetName ? describe : describe.skip;

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function makeRelease(tag: string, name: string) {
  return {
    tag_name: tag,
    assets: [
      {
        name,
        browser_download_url: `https://example.test/${name}`,
      },
      {
        name: `${name}.sha256`,
        browser_download_url: `https://example.test/${name}.sha256`,
      },
    ],
  };
}

function makeFetch(opts: {
  tag: string;
  name: string;
  checksumText: string;
  binaryBytes: Buffer;
}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/releases/latest')) {
      return new Response(JSON.stringify(makeRelease(opts.tag, opts.name)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.endsWith(`${opts.name}.sha256`)) {
      return new Response(opts.checksumText, { status: 200 });
    }
    if (url.endsWith(opts.name)) {
      return new Response(opts.binaryBytes, { status: 200 });
    }
    return new Response('not found', { status: 404 });
  });
}

describeStandalone('upgradeStandaloneBinary', () => {
  it('downloads, verifies checksum, replaces binary, and removes backup on success', async () => {
    const name = assetName!;
    const dir = mkdtempSync(join(tmpdir(), 'counselors-upgrade-'));
    const targetPath = join(dir, 'counselors');

    const oldScript = '#!/bin/sh\necho "0.0.1"\n';
    writeFileSync(targetPath, oldScript, { mode: 0o755 });
    chmodSync(targetPath, 0o755);

    const newScript =
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "9.9.9"\n  exit 0\nfi\necho "ok"\n';
    const newBytes = Buffer.from(newScript, 'utf-8');
    const checksumText = `${sha256Hex(newBytes)}  ${name}\n`;

    const fetchFn = makeFetch({
      tag: 'v9.9.9',
      name,
      checksumText,
      binaryBytes: newBytes,
    });

    try {
      const result = await upgradeStandaloneBinary(targetPath, '0.0.1', {
        fetchFn,
      });
      expect(result.didUpgrade).toBe(true);
      expect(result.version).toBe('9.9.9');
      expect(result.assetName).toBe(name);

      const updated = readFileSync(targetPath, 'utf-8');
      expect(updated).toContain('9.9.9');
      expect(existsSync(`${targetPath}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('short-circuits when already on latest version (does not download assets)', async () => {
    const name = assetName!;
    const dir = mkdtempSync(join(tmpdir(), 'counselors-upgrade-'));
    const targetPath = join(dir, 'counselors');

    const oldScript = '#!/bin/sh\necho "9.9.9"\n';
    writeFileSync(targetPath, oldScript, { mode: 0o755 });
    chmodSync(targetPath, 0o755);

    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('/releases/latest')) {
        return new Response(JSON.stringify(makeRelease('v9.9.9', name)), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    try {
      const result = await upgradeStandaloneBinary(targetPath, '9.9.9', {
        fetchFn,
      });
      expect(result.didUpgrade).toBe(false);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(readFileSync(targetPath, 'utf-8')).toBe(oldScript);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails on checksum mismatch without modifying the existing binary', async () => {
    const name = assetName!;
    const dir = mkdtempSync(join(tmpdir(), 'counselors-upgrade-'));
    const targetPath = join(dir, 'counselors');

    const oldScript = '#!/bin/sh\necho "0.0.1"\n';
    writeFileSync(targetPath, oldScript, { mode: 0o755 });
    chmodSync(targetPath, 0o755);

    const newBytes = Buffer.from('#!/bin/sh\necho "bad"\n', 'utf-8');
    const checksumText = `${'0'.repeat(64)}  ${name}\n`;

    const fetchFn = makeFetch({
      tag: 'v9.9.9',
      name,
      checksumText,
      binaryBytes: newBytes,
    });

    try {
      await expect(
        upgradeStandaloneBinary(targetPath, '0.0.1', { fetchFn }),
      ).rejects.toThrow(/Checksum mismatch/);
      expect(readFileSync(targetPath, 'utf-8')).toBe(oldScript);
      expect(existsSync(`${targetPath}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back if the new binary fails post-upgrade validation', async () => {
    const name = assetName!;
    const dir = mkdtempSync(join(tmpdir(), 'counselors-upgrade-'));
    const targetPath = join(dir, 'counselors');

    const oldScript =
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  echo "0.0.1"\n  exit 0\nfi\necho "ok"\n';
    writeFileSync(targetPath, oldScript, { mode: 0o755 });
    chmodSync(targetPath, 0o755);

    const badScript =
      '#!/bin/sh\nif [ "$1" = "--version" ]; then\n  exit 1\nfi\necho "ok"\n';
    const badBytes = Buffer.from(badScript, 'utf-8');
    const checksumText = `${sha256Hex(badBytes)}  ${name}\n`;

    const fetchFn = makeFetch({
      tag: 'v9.9.9',
      name,
      checksumText,
      binaryBytes: badBytes,
    });

    try {
      await expect(
        upgradeStandaloneBinary(targetPath, '0.0.1', { fetchFn }),
      ).rejects.toThrow(/Post-upgrade validation failed/);

      // Original binary should be restored.
      expect(readFileSync(targetPath, 'utf-8')).toBe(oldScript);
      expect(existsSync(`${targetPath}.bak`)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
