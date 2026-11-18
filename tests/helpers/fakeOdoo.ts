import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { DEFAULT_CATEGORY_MAP } from '../../src/config/env';
import type { ParsedCatalog } from '../../src/repositories/MockRepository';
import { formatSpecText } from '../../src/repositories/odoo/specs';
import type { XmlRpcStruct, XmlRpcValue } from '../../src/repositories/odoo/xmlrpc';
import { parseMethodCall, serializeFault, serializeMethodResponse } from '../../src/repositories/odoo/xmlrpc';

export const FAKE_DB = 'tecs';
export const FAKE_USER = 'bot@tecs.local';
export const FAKE_PASSWORD = 'secret';
const FAKE_UID = 7;

export interface RecordedCall {
  model: string;
  method: string;
  args: XmlRpcValue[];
  kwargs: XmlRpcStruct;
}

export interface FakeOdoo {
  url: string;
  calls: RecordedCall[];
  created: { model: string; values: XmlRpcStruct }[];
  close(): Promise<void>;
}

/** Evalua un dominio de Odoo (notacion polaca) sobre un registro. */
function evalDomain(domain: XmlRpcValue[], record: XmlRpcStruct): boolean {
  let pos = 0;

  const leaf = (term: XmlRpcValue[]): boolean => {
    const [field, op, expected] = term as [string, string, XmlRpcValue];
    let actual: XmlRpcValue = record[field] ?? null;
    if (field === 'categ_id' && Array.isArray(actual)) actual = String(actual[1]);
    switch (op) {
      case '=':
        return actual === expected;
      case '>':
        return Number(actual) > Number(expected);
      case '>=':
        return Number(actual) >= Number(expected);
      case '<=':
        return Number(actual) <= Number(expected);
      case 'ilike':
        return typeof actual === 'string' && actual.toLowerCase().includes(String(expected).toLowerCase());
      case 'child_of':
        return typeof actual === 'string' && actual.toLowerCase().includes(String(expected).toLowerCase());
      default:
        throw new Error(`Operador no soportado por el Odoo falso: ${op}`);
    }
  };

  const next = (): boolean => {
    const token = domain[pos++];
    if (token === '|') {
      const a = next();
      const b = next();
      return a || b;
    }
    if (token === '&') {
      const a = next();
      const b = next();
      return a && b;
    }
    if (token === '!') return !next();
    return leaf(token as XmlRpcValue[]);
  };

  const results: boolean[] = [];
  while (pos < domain.length) results.push(next());
  return results.every(Boolean);
}

function buildRecords(catalog: ParsedCatalog): XmlRpcStruct[] {
  const records: XmlRpcStruct[] = [];
  let id = 1;
  for (const p of catalog.products) {
    records.push({
      id: id++,
      name: p.name,
      default_code: p.sku,
      list_price: p.priceUsd,
      qty_available: p.stock,
      sale_ok: true,
      categ_id: [100 + id, `Todos / Componentes / ${DEFAULT_CATEGORY_MAP[p.category]}`],
      description_sale: formatSpecText(p.specs, p.tags, p.summary),
    });
  }
  for (const s of catalog.services) {
    records.push({
      id: id++,
      name: s.name,
      default_code: s.sku,
      list_price: s.priceUsd,
      qty_available: 0,
      sale_ok: true,
      categ_id: [500, `Todos / ${DEFAULT_CATEGORY_MAP.service}`],
      description_sale: s.description === '' ? false : `summary: ${s.description}`,
    });
  }
  return records;
}

/** Servidor Odoo XML-RPC minimo, solo para pruebas (no se entrega). */
export async function startFakeOdoo(catalog: ParsedCatalog): Promise<FakeOdoo> {
  const records = buildRecords(catalog);
  const calls: RecordedCall[] = [];
  const created: { model: string; values: XmlRpcStruct }[] = [];
  let nextCreated = 1000;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const send = (xml: string): void => {
        res.writeHead(200, { 'Content-Type': 'text/xml' });
        res.end(xml);
      };
      try {
        const { method, params } = parseMethodCall(Buffer.concat(chunks).toString('utf8'));

        if (req.url === '/xmlrpc/2/common') {
          if (method === 'version') return send(serializeMethodResponse({ server_version: '17.0-fake' }));
          if (method === 'authenticate') {
            const [db, user, password] = params;
            const ok = db === FAKE_DB && user === FAKE_USER && password === FAKE_PASSWORD;
            return send(serializeMethodResponse(ok ? FAKE_UID : false));
          }
        }

        if (req.url === '/xmlrpc/2/object' && method === 'execute_kw') {
          const [db, uid, password, model, rpcMethod, args, kwargs] = params as [
            string,
            number,
            string,
            string,
            string,
            XmlRpcValue[],
            XmlRpcStruct,
          ];
          if (db !== FAKE_DB || uid !== FAKE_UID || password !== FAKE_PASSWORD) {
            return send(serializeFault(1, 'Access Denied'));
          }
          calls.push({ model, method: rpcMethod, args, kwargs });

          if (model === 'product.template' && rpcMethod === 'search_read') {
            const domain = args[0] as XmlRpcValue[];
            let found = records.filter((r) => evalDomain(domain, r));
            const order = typeof kwargs.order === 'string' ? kwargs.order : 'id asc';
            const [orderField = 'id', dir = 'asc'] = order.split(' ');
            found = [...found].sort((a, b) => {
              const diff = Number(a[orderField]) - Number(b[orderField]);
              return dir === 'desc' ? -diff : diff;
            });
            if (typeof kwargs.limit === 'number') found = found.slice(0, kwargs.limit);
            const fields = Array.isArray(kwargs.fields) ? (kwargs.fields as string[]) : [];
            return send(
              serializeMethodResponse(
                found.map((r) => {
                  const out: XmlRpcStruct = { id: r.id ?? 0 };
                  for (const f of fields) out[f] = r[f] ?? false;
                  return out;
                }),
              ),
            );
          }
          if (model === 'product.template' && rpcMethod === 'read') {
            const ids = args[0] as number[];
            return send(serializeMethodResponse(ids.map((id) => ({ id, product_variant_id: [id * 10, 'variante'] }))));
          }
          if (model === 'res.partner' && rpcMethod === 'search_read') return send(serializeMethodResponse([]));
          if (rpcMethod === 'create') {
            created.push({ model, values: args[0] as XmlRpcStruct });
            return send(serializeMethodResponse(nextCreated++));
          }
          return send(serializeFault(2, `Metodo no soportado: ${model}.${rpcMethod}`));
        }

        res.writeHead(404);
        res.end();
      } catch (error) {
        send(serializeFault(99, error instanceof Error ? error.message : String(error)));
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    created,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
