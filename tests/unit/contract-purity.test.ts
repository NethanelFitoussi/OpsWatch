import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as contract from '@opswatch/contract';
import { CONTRACT, allImports, moduleGraph, readSource, typescriptFilesIn } from '../helpers/source-graph';

/**
 * `packages/contract` is read by the server, by the web app and by the Expo application. Anything it imports, all
 * three have to be able to resolve, which is why the only package it may name is zod.
 */
const ALLOWED_PACKAGES = ['zod'];

/** The sixteen areas the owner listed, each one a file of its own. */
const DOMAIN_FILES = [
  'health.ts',
  'brief.ts',
  'problems.ts',
  'errors.ts',
  'services.ts',
  'alerts.ts',
  'incidents.ts',
  'synthetics.ts',
  'slos.ts',
  'deployments.ts',
  'repository.ts',
  'ai.ts',
  'notifications.ts',
  'preferences.ts',
  'authentication.ts',
  'authorization.ts',
];

const files = typescriptFilesIn(CONTRACT);
const relative = (file: string) => path.relative(CONTRACT, file);

describe('the shared contract package', () => {
  it('holds a file for each of the sixteen areas', () => {
    expect(files.map(relative)).toEqual(expect.arrayContaining(DOMAIN_FILES));
  });

  it.each(files.map(relative))('%s imports nothing but zod and its own siblings', (file) => {
    const external = allImports(readSource(path.join(CONTRACT, file))).filter((specifier) => !specifier.startsWith('.'));
    expect(external.filter((specifier) => !ALLOWED_PACKAGES.includes(specifier))).toEqual([]);
  });

  // The per-file check above reads each file on its own; this one follows the imports, so a file that only became
  // impure through a sibling is caught too, and a stray module nothing re-exports is still walked.
  it('reaches nothing outside itself, from any entry', () => {
    const { modules, packages } = moduleGraph(files);
    expect(modules.size).toBe(files.length);
    expect([...modules].every((module) => module.startsWith(`${CONTRACT}${path.sep}`))).toBe(true);
    expect([...new Set(packages.values())].sort()).toEqual(ALLOWED_PACKAGES);
  });

  it('names no credential anywhere in its fields', () => {
    // A string-valued field whose name says credential. `auth: { password: z.boolean() }` in `server.ts` is a flag
    // saying that password sign-in is offered, not a password, so the value's type is part of the check.
    const forbidden = /\b(password|token|secret|apiKey|accessKey|credential)[A-Za-z]*\s*:\s*z\.string/g;
    const offenders = files.flatMap((file) => {
      const source = readSource(file);
      // The login request carries a password and the sign-in answer carries the token it just minted; those two are
      // the only places a secret may legitimately appear, and they are both in the authentication domain.
      if (relative(file) === 'authentication.ts') return [];
      return [...source.matchAll(forbidden)].map((match) => `${relative(file)}: ${match[0]}`);
    });
    expect(offenders).toEqual([]);
  });

  it('exports the schemas themselves, not only the inferred types', () => {
    // A client validates every response at runtime, so these have to survive to runtime.
    expect(typeof contract.healthSchema.parse).toBe('function');
    expect(typeof contract.problemSummarySchema.parse).toBe('function');
    expect(typeof contract.serverInfoSchema.parse).toBe('function');
  });
});
