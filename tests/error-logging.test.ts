import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../src/utils/errors';
import { createLogger } from '../src/utils/logger';

describe('logger: errores de dominio', () => {
  it('incluye code y details (estado HTTP y causa) y sigue ocultando claves sensibles', () => {
    const lines: string[] = [];
    const log = createLogger('info', {}, { write: (line) => lines.push(line) });
    const error = new AppError('LLM_ERROR', 'Fallo la consulta al modelo de IA', 502, {
      status: 400,
      cause: '{"error":{"code":400,"message":"modelo no encontrado"}}',
      apiKey: 'AQ.secreto',
    });
    log.error('Error al procesar la peticion', { error });
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0] ?? '{}') as { error: { code: string; details: Record<string, unknown> } };
    assert.equal(entry.error.code, 'LLM_ERROR');
    assert.equal(entry.error.details.status, 400);
    assert.match(String(entry.error.details.cause), /modelo no encontrado/);
    assert.equal(entry.error.details.apiKey, '[REDACTED]');
    assert.equal(lines[0]?.includes('AQ.secreto'), false);
  });

  it('un Error simple conserva name, message y stack', () => {
    const lines: string[] = [];
    const log = createLogger('info', {}, { write: (line) => lines.push(line) });
    log.error('x', { error: new Error('boom') });
    const entry = JSON.parse(lines[0] ?? '{}') as { error: { name: string; message: string; stack: string; details?: unknown } };
    assert.equal(entry.error.message, 'boom');
    assert.ok(entry.error.stack.includes('boom'));
    assert.equal(entry.error.details, undefined);
  });
});
