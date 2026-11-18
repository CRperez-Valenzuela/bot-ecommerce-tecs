import { AppError } from '../../utils/errors';
import { truncate } from '../../utils/text';
import type { XmlRpcStruct, XmlRpcValue } from './xmlrpc';
import { parseMethodResponse, serializeMethodCall, XmlRpcFault } from './xmlrpc';

export interface OdooConnection {
  url: string;
  db: string;
  username: string;
  /** Contrasena o API key del usuario de integracion. */
  password: string;
  timeoutMs: number;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Cliente XML-RPC de Odoo (endpoints /xmlrpc/2/common y /xmlrpc/2/object). */
export class OdooClient {
  private uid: number | null = null;

  constructor(
    private readonly connection: OdooConnection,
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
  ) {}

  async version(): Promise<XmlRpcStruct> {
    const result = await this.call('common', 'version', []);
    return typeof result === 'object' && result !== null && !Array.isArray(result) ? result : {};
  }

  /** Autentica (y cachea el uid). Lanza ODOO_AUTH_FAILED si las credenciales son invalidas. */
  async authenticate(force = false): Promise<number> {
    if (this.uid !== null && !force) return this.uid;
    const { db, username, password } = this.connection;
    const result = await this.call('common', 'authenticate', [db, username, password, {}]);
    if (typeof result !== 'number' || result <= 0) {
      throw new AppError('ODOO_AUTH_FAILED', 'Odoo rechazo las credenciales de integracion', 502, {
        db,
        username,
      });
    }
    this.uid = result;
    return result;
  }

  async executeKw(
    model: string,
    method: string,
    args: XmlRpcValue[],
    kwargs: XmlRpcStruct = {},
  ): Promise<XmlRpcValue> {
    const uid = await this.authenticate();
    return this.call('object', 'execute_kw', [
      this.connection.db,
      uid,
      this.connection.password,
      model,
      method,
      args,
      kwargs,
    ]);
  }

  private async call(endpoint: 'common' | 'object', method: string, params: XmlRpcValue[]): Promise<XmlRpcValue> {
    const url = `${this.connection.url}/xmlrpc/2/${endpoint}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.connection.timeoutMs);

    let status: number;
    let text: string;
    try {
      const response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: serializeMethodCall(method, params),
        signal: controller.signal,
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      throw new AppError('ODOO_UNREACHABLE', 'No se pudo conectar con Odoo', 502, {
        url,
        cause: error instanceof Error ? error.message : String(error),
      });
    } finally {
      clearTimeout(timer);
    }

    if (status < 200 || status >= 300) {
      throw new AppError('ODOO_RPC_ERROR', `Odoo respondio HTTP ${status}`, 502, { url, status });
    }

    try {
      return parseMethodResponse(text);
    } catch (error) {
      if (error instanceof XmlRpcFault) {
        throw new AppError('ODOO_RPC_ERROR', 'Odoo devolvio un error al ejecutar la operacion', 502, {
          model: method === 'execute_kw' ? String(params[3] ?? '') : undefined,
          method: method === 'execute_kw' ? String(params[4] ?? '') : method,
          faultCode: error.faultCode,
          faultString: truncate(error.faultString, 500),
        });
      }
      throw new AppError('ODOO_RPC_ERROR', 'Respuesta de Odoo no valida', 502, {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
