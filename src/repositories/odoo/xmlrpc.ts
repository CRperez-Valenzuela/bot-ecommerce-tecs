/**
 * Codec XML-RPC minimo y sin dependencias (suficiente para Odoo external API).
 * Cubre: int/i4/i8, double, boolean, string, nil, array, struct, base64, dateTime.iso8601.
 */
export type XmlRpcValue = null | boolean | number | string | XmlRpcValue[] | XmlRpcStruct;
export interface XmlRpcStruct {
  [key: string]: XmlRpcValue;
}

export class XmlRpcFault extends Error {
  readonly faultCode: number;
  readonly faultString: string;

  constructor(faultCode: number, faultString: string) {
    super(`XML-RPC fault ${faultCode}: ${faultString}`);
    this.name = 'XmlRpcFault';
    this.faultCode = faultCode;
    this.faultString = faultString;
  }
}

const INT32_MAX = 2147483647;

function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function serializeValue(value: XmlRpcValue): string {
  if (value === null) return '<value><nil/></value>';
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('XML-RPC no admite NaN ni Infinity');
    return Number.isInteger(value) && Math.abs(value) <= INT32_MAX
      ? `<value><int>${value}</int></value>`
      : `<value><double>${value}</double></value>`;
  }
  if (typeof value === 'string') return `<value><string>${escapeXml(value)}</string></value>`;
  if (Array.isArray(value)) {
    return `<value><array><data>${value.map(serializeValue).join('')}</data></array></value>`;
  }
  const members = Object.entries(value)
    .map(([name, inner]) => `<member><name>${escapeXml(name)}</name>${serializeValue(inner)}</member>`)
    .join('');
  return `<value><struct>${members}</struct></value>`;
}

export function serializeMethodCall(method: string, params: XmlRpcValue[]): string {
  const body = params.map((p) => `<param>${serializeValue(p)}</param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${escapeXml(method)}</methodName><params>${body}</params></methodCall>`;
}

export function serializeMethodResponse(value: XmlRpcValue): string {
  return `<?xml version="1.0"?><methodResponse><params><param>${serializeValue(value)}</param></params></methodResponse>`;
}

export function serializeFault(code: number, message: string): string {
  const fault = serializeValue({ faultCode: code, faultString: message });
  return `<?xml version="1.0"?><methodResponse><fault>${fault}</fault></methodResponse>`;
}

// ---------------------------------------------------------------- parseo ---

interface XmlElement {
  name: string;
  children: XmlElement[];
  text: string;
}

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>]+)[^>]*?(\/?)>|([^<]+)/g;

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_match, entity: string) => {
    switch (entity) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default: {
        const code = entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : '';
      }
    }
  });
}

function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: '#root', children: [], text: '' };
  const stack: XmlElement[] = [root];

  for (const match of xml.matchAll(TOKEN)) {
    const [, cdata, closeName, openName, selfClose, text] = match;
    const top = stack[stack.length - 1] as XmlElement;
    if (cdata !== undefined) {
      top.text += cdata;
    } else if (closeName !== undefined) {
      if (stack.length === 1 || top.name !== closeName) {
        throw new Error(`XML mal formado: cierre inesperado </${closeName}>`);
      }
      stack.pop();
    } else if (openName !== undefined) {
      const element: XmlElement = { name: openName, children: [], text: '' };
      top.children.push(element);
      if (selfClose !== '/') stack.push(element);
    } else if (text !== undefined) {
      top.text += decodeEntities(text);
    }
  }

  if (stack.length !== 1) throw new Error('XML mal formado: elementos sin cerrar');
  const first = root.children[0];
  if (first === undefined) throw new Error('XML vacio');
  return first;
}

function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((c) => c.name === name);
}

function decodeValue(valueElement: XmlElement): XmlRpcValue {
  const typed = valueElement.children[0];
  if (typed === undefined) return valueElement.text; // <value>texto</value> es string

  switch (typed.name) {
    case 'int':
    case 'i4':
    case 'i8':
      return parseInt(typed.text.trim(), 10);
    case 'double':
      return parseFloat(typed.text.trim());
    case 'boolean':
      return typed.text.trim() === '1';
    case 'string':
      return typed.text;
    case 'nil':
      return null;
    case 'base64':
    case 'dateTime.iso8601':
      return typed.text.trim();
    case 'array': {
      const data = child(typed, 'data');
      return (data?.children ?? []).filter((c) => c.name === 'value').map(decodeValue);
    }
    case 'struct': {
      const result: XmlRpcStruct = {};
      for (const member of typed.children.filter((c) => c.name === 'member')) {
        const key = child(member, 'name')?.text ?? '';
        const inner = child(member, 'value');
        result[key] = inner === undefined ? null : decodeValue(inner);
      }
      return result;
    }
    default:
      throw new Error(`Tipo XML-RPC no soportado: <${typed.name}>`);
  }
}

/** Parsea <methodResponse>. Lanza XmlRpcFault si la respuesta es un <fault>. */
export function parseMethodResponse(xml: string): XmlRpcValue {
  const root = parseXml(xml);
  if (root.name !== 'methodResponse') throw new Error(`Respuesta XML-RPC inesperada: <${root.name}>`);

  const fault = child(root, 'fault');
  if (fault !== undefined) {
    const valueEl = child(fault, 'value');
    const decoded = valueEl === undefined ? null : decodeValue(valueEl);
    const struct = typeof decoded === 'object' && decoded !== null && !Array.isArray(decoded) ? decoded : {};
    const code = typeof struct.faultCode === 'number' ? struct.faultCode : 0;
    const message = typeof struct.faultString === 'string' ? struct.faultString : 'Fault sin mensaje';
    throw new XmlRpcFault(code, message);
  }

  const param = child(child(root, 'params') ?? { name: '', children: [], text: '' }, 'param');
  const value = param === undefined ? undefined : child(param, 'value');
  if (value === undefined) throw new Error('Respuesta XML-RPC sin valor');
  return decodeValue(value);
}

/** Parsea <methodCall> (se usa en pruebas con un servidor Odoo simulado). */
export function parseMethodCall(xml: string): { method: string; params: XmlRpcValue[] } {
  const root = parseXml(xml);
  if (root.name !== 'methodCall') throw new Error(`Peticion XML-RPC inesperada: <${root.name}>`);
  const method = child(root, 'methodName')?.text.trim() ?? '';
  const params = (child(root, 'params')?.children ?? [])
    .filter((p) => p.name === 'param')
    .map((p) => {
      const value = child(p, 'value');
      return value === undefined ? null : decodeValue(value);
    });
  return { method, params };
}
