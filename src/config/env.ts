import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Loads `.env` (if present) into process.env. Variables already set in the
 * environment win, so CI/Docker configuration is never overridden by a file.
 *
 * Assigns through `process.env` rather than using process.loadEnvFile(): the
 * latter writes to the native env, which Jest's per-test-file sandboxed
 * process.env does not see.
 */
export function loadEnv(): void {
  if (!existsSync('.env')) return;
  const parsed = parseEnv(readFileSync('.env', 'utf8'));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
