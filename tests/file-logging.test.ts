import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { createFileLogSink, localDateStamp, pruneOldLogs } from '../src/utils/fileLogSink';
import { createLogger } from '../src/utils/logger';

const dirs: string[] = [];
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-logs-'));
  dirs.push(dir);
  return dir;
}
after(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function silenceConsole<T>(fn: () => T): T {
  const { log, error } = console;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe('sink de logs en archivo', () => {
  it('crea la carpeta y escribe una linea JSON por evento en app-AAAA-MM-DD.log', () => {
    const dir = path.join(tmpDir(), 'nested', 'logs');
    const now = new Date(2026, 10, 17, 22, 30);
    const sink = createFileLogSink({ dir, retentionDays: 14, now: () => now });
    const log = createLogger('info', { service: 'test' }, sink);
    silenceConsole(() => {
      log.info('hola', { a: 1 });
      log.child({ component: 'x' }).warn('aviso');
      log.debug('no se escribe (nivel)');
    });
    const file = path.join(dir, 'app-2026-11-17.log');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.length, 2);
    assert.deepEqual([lines[0]?.message, lines[0]?.a, lines[0]?.service], ['hola', 1, 'test']);
    assert.deepEqual([lines[1]?.level, lines[1]?.component, lines[1]?.service], ['warn', 'x', 'test']);
  });

  it('el archivo conserva el redactado de secretos', () => {
    const dir = tmpDir();
    const log = createLogger('info', {}, createFileLogSink({ dir, retentionDays: 5, now: () => new Date(2026, 0, 5) }));
    silenceConsole(() => log.info('x', { accessToken: 'super-secreto', password: 'p', ok: 'visible' }));
    const text = fs.readFileSync(path.join(dir, 'app-2026-01-05.log'), 'utf8');
    assert.doesNotMatch(text, /super-secreto/);
    assert.match(text, /\[REDACTED\]/);
    assert.match(text, /visible/);
  });

  it('rota al cambiar de dia (zona local) y aplica la retencion', () => {
    const dir = tmpDir();
    let now = new Date(2026, 4, 10, 23, 59);
    const sink = createFileLogSink({ dir, retentionDays: 3, now: () => now });
    sink.write('{"d":10}');
    now = new Date(2026, 4, 11, 0, 1);
    sink.write('{"d":11}');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['app-2026-05-10.log', 'app-2026-05-11.log']);

    now = new Date(2026, 4, 15, 8, 0); // con 3 dias se conservan 15, 14 y 13: caen el 10 y el 11
    sink.write('{"d":15}');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['app-2026-05-15.log']);
  });

  it('pruneOldLogs conserva retentionDays dias contando hoy y solo borra app-AAAA-MM-DD.log', () => {
    const dir = tmpDir();
    for (const name of ['app-2026-01-01.log', 'app-2026-01-08.log', 'app-2026-01-09.log', 'app-2026-01-10.log', 'leads.json', 'app-2026-01-01.log.bak', 'notas.txt', 'app-x.log']) {
      fs.writeFileSync(path.join(dir, name), 'x');
    }
    const removed = pruneOldLogs(dir, 2, new Date(2026, 0, 10));
    assert.equal(removed, 2); // con 2 dias: se conservan hoy (01-10) y ayer (01-09); caen 01-08 y 01-01
    assert.deepEqual(fs.readdirSync(dir).sort(), ['app-2026-01-09.log', 'app-2026-01-10.log', 'app-x.log', 'app-2026-01-01.log.bak', 'leads.json', 'notas.txt'].sort());
  });

  it('un fallo de escritura nunca lanza y se informa una sola vez', () => {
    const dir = tmpDir();
    const errors: unknown[] = [];
    const sink = createFileLogSink({ dir, retentionDays: 5, now: () => new Date(2026, 5, 1), onError: (e) => errors.push(e) });
    fs.rmSync(dir, { recursive: true, force: true }); // el volumen "desaparece"
    assert.doesNotThrow(() => {
      sink.write('uno');
      sink.write('dos');
      sink.write('tres');
    });
    assert.equal(errors.length, 1);
    fs.mkdirSync(dir); // vuelve: se reanuda
    sink.write('cuatro');
    assert.match(fs.readFileSync(path.join(dir, 'app-2026-06-01.log'), 'utf8'), /cuatro/);
  });

  it('si la carpeta no se puede crear, createFileLogSink lanza (el servidor sigue solo con stdout)', () => {
    const base = tmpDir();
    const blocker = path.join(base, 'archivo');
    fs.writeFileSync(blocker, 'no soy una carpeta');
    assert.throws(() => createFileLogSink({ dir: path.join(blocker, 'logs'), retentionDays: 5 }));
  });

  it('sin sink el logger se comporta como antes (solo consola)', () => {
    const seen: string[] = [];
    const original = console.log;
    console.log = (line: string) => { seen.push(line); };
    try {
      createLogger('info').info('solo consola');
    } finally {
      console.log = original;
    }
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? '', /solo consola/);
  });

  it('localDateStamp usa fecha local con ceros a la izquierda', () => {
    assert.equal(localDateStamp(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  });
});
