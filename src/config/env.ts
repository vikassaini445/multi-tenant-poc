import { existsSync } from 'node:fs';

/**
 * Loads `.env` (if present) into process.env. Variables already set in the
 * environment win, so CI/Docker configuration is never overridden by a file.
 */
export function loadEnv(): void {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}
