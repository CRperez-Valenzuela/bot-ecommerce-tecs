import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { XmlRpcValue } from '../src/repositories/odoo/xmlrpc';
import {
  parseMethodCall,
  parseMethodResponse,
  serializeFault,
  serializeMethodCall,
  serializeMethodResponse,
  XmlRpcFault,
} from '../src/repositories/odoo/xmlrpc';
import { buildOr, formatSpecText, parseSpecText } from '../src/repositories/odoo/specs';

describe('codec XML-RPC', () => {
  it('hace round-trip de todos los tipos (incluye caracteres especiales y acentos)', () => {
    const value: XmlRpcValue = {
      texto: 'a < b & c > "d" \'e\' — ñandú áéíóú',
      entero: 42,
      negativo: -7,
      decimal: 12.5,
      grande: 5_000_000_000,
      si: true,
      no: false,
      nulo: null,
      lista: [1, 'dos', [3, { cuatro: 4 }]],
      vacia: [],
      struct_vacio: {},
    };
    const xml = serializeMethodCall('execute_kw', [value, 'x']);
    const { method, params } = parseMethodCall(xml);
    assert.equal(method, 'execute_kw');
    assert.deepEqual(params[0], value);
    assert.equal(params[1], 'x');
  });

  it('serializa enteros como <int> y decimales/enteros enormes como <double>', () => {
    assert.match(serializeMethodCall('m', [5]), /<int>5<\/int>/);
    assert.match(serializeMethodCall('m', [5.5]), /<double>5.5<\/double>/);
    assert.match(serializeMethodCall('m', [5_000_000_000]), /<double>/);
  });

  it('interpreta <value> sin tipo como string y acepta CDATA, comentarios y prologo', () => {
    const xml = `<?xml version='1.0'?><!-- hola --><methodResponse><params><param><value>texto <![CDATA[<crudo>]]></value></param></params></methodResponse>`;
    assert.equal(parseMethodResponse(xml), 'texto <crudo>');
  });

  it('decodifica entidades numericas', () => {
    const xml = `<methodResponse><params><param><value><string>&#65;&#x42;&amp;</string></value></param></params></methodResponse>`;
    assert.equal(parseMethodResponse(xml), 'AB&');
  });

  it('lanza XmlRpcFault ante <fault>', () => {
    assert.throws(
      () => parseMethodResponse(serializeFault(3, 'Access Denied')),
      (error: unknown) => error instanceof XmlRpcFault && error.faultCode === 3 && error.faultString === 'Access Denied',
    );
  });

  it('rechaza XML mal formado y tipos desconocidos', () => {
    assert.throws(() => parseMethodResponse('<methodResponse><params>'), /sin cerrar/);
    assert.throws(() => parseMethodResponse('<a></b>'), /cierre inesperado/);
    assert.throws(
      () => parseMethodResponse('<methodResponse><params><param><value><raro>1</raro></value></param></params></methodResponse>'),
      /no soportado/,
    );
  });

  it('serializeMethodResponse -> parseMethodResponse', () => {
    assert.deepEqual(parseMethodResponse(serializeMethodResponse([{ id: 1, name: false }])), [{ id: 1, name: false }]);
  });
});

describe('convencion de especificaciones y dominios Odoo', () => {
  it('parseSpecText y formatSpecText son inversas', () => {
    const specs = { socket: 'AM4', memory_type: 'DDR4', tdp_w: 65, igpu: true, form_factors: ['ATX', 'mATX'] };
    const text = formatSpecText(specs, ['gaming', 'economico'], 'Resumen corto');
    const parsed = parseSpecText(text);
    assert.deepEqual(parsed.specs, specs);
    assert.deepEqual(parsed.tags, ['gaming', 'economico']);
    assert.equal(parsed.summary, 'Resumen corto');
  });

  it('parseSpecText tolera HTML, lineas libres y valores invalidos', () => {
    const parsed = parseSpecText('<p>Texto libre</p><p>socket: AM5</p><br/>tdp_w: abc<br>igpu: No');
    assert.equal(parsed.specs.socket, 'AM5');
    assert.equal(parsed.specs.tdp_w, undefined);
    assert.equal(parsed.specs.igpu, false);
  });

  it('buildOr usa n-1 operadores en notacion polaca', () => {
    assert.deepEqual(buildOr([]), []);
    assert.deepEqual(buildOr([['a', '=', 1]]), [['a', '=', 1]]);
    assert.deepEqual(buildOr([['a', '=', 1], ['b', '=', 2], ['c', '=', 3]]), [
      '|',
      '|',
      ['a', '=', 1],
      ['b', '=', 2],
      ['c', '=', 3],
    ]);
  });
});
