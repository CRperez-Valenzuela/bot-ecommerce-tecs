import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MockRepository, parseCatalog } from '../../src/repositories/MockRepository';
import type { ParsedCatalog } from '../../src/repositories/MockRepository';
import { silentLogger } from '../../src/utils/logger';

export const CATALOG_PATH = path.resolve(__dirname, '../../data/catalog.mock.json');

export function loadCatalog(): ParsedCatalog {
  return parseCatalog(JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8')) as unknown);
}

export interface TempMock {
  repo: MockRepository;
  leadsPath: string;
  cleanup(): void;
}

export function makeMockRepo(): TempMock {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-test-'));
  const leadsPath = path.join(dir, 'leads.json');
  return {
    repo: new MockRepository({ catalogPath: CATALOG_PATH, leadsPath }, silentLogger),
    leadsPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
