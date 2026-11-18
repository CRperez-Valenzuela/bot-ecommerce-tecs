import type { AppConfig } from '../config/env';
import type { IInventoryRepository } from './IInventoryRepository';
import { MockRepository } from './MockRepository';
import { OdooClient } from './odoo/OdooClient';
import { OdooRepository } from './odoo/OdooRepository';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';

/** Fabrica del patron adaptador: elige la implementacion segun ODOO_MODE. */
export function createRepository(config: AppConfig, log: Logger): IInventoryRepository {
  if (config.odooMode === 'live') {
    if (config.odoo === null) {
      throw new AppError('CONFIG_ERROR', 'ODOO_MODE=live requiere la configuracion ODOO_*', 500);
    }
    const { url, db, username, password, timeoutMs, categoryMap, specsField, createQuotation } = config.odoo;
    return new OdooRepository(
      new OdooClient({ url, db, username, password, timeoutMs }),
      { categoryMap, specsField, createQuotation },
      log.child({ component: 'odoo-repository' }),
    );
  }
  return new MockRepository(config.mock, log.child({ component: 'mock-repository' }));
}

export type { IInventoryRepository } from './IInventoryRepository';
export { MAX_REPO_RESULTS } from './IInventoryRepository';
