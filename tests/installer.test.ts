import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';

const ROOT = path.resolve(__dirname, '..');
const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0;
const hasCurl = spawnSync('curl', ['--version']).status === 0;
const skip = !hasBash || !hasCurl ? 'requiere bash y curl (Linux/macOS/WSL)' : false;

// Docker simulado: registra las llamadas y, en "compose up", levanta un /health falso en HOST_PORT.
const DOCKER_STUB = `#!/usr/bin/env bash
echo "docker $*" >> "$STUB_DIR/calls.log"
case "$1" in
  info) exit 0 ;;
  ps) [ -f "$STUB_DIR/pids" ] && echo tecs-bot; exit 0 ;;
  inspect) echo "\${STUB_STATE:-running}"; exit 0 ;;
  compose)
    case "$2" in
      version) echo "Docker Compose version v2.99.0"; exit 0 ;;
      config) exit 0 ;;
      logs) echo "stub: ultimas lineas del contenedor"; exit 0 ;;
      up)
        [ "\${STUB_NO_SERVER:-0}" = "1" ] && exit 0
        port=$(grep -E '^HOST_PORT=' .env | tail -n 1 | cut -d= -f2- | tr -d "'")
        nohup node "$STUB_DIR/health.js" "$port" >/dev/null 2>&1 &
        echo $! >> "$STUB_DIR/pids"
        exit 0 ;;
    esac ;;
esac
exit 0
`;

const HEALTH_SERVER = `
const http = require('node:http');
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/health') res.end(JSON.stringify({ success: true, data: { status: 'ok', mode: 'mock', geminiConfigured: true } }));
  else { res.statusCode = 404; res.end('{}'); }
}).listen(Number(process.argv[2]), '127.0.0.1');
`;

interface Sandbox {
  dir: string;
  stubDir: string;
  run(args: string[], input: string, extraEnv?: Record<string, string>): Promise<{ code: number | null; out: string }>;
  env(): Record<string, string>;
  calls(): string;
}

const sandboxes: Sandbox[] = [];

function makeSandbox(): Sandbox {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-install-'));
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-stub-'));
  for (const file of ['install.sh', '.env.example', 'docker-compose.yml', 'Dockerfile', 'package.json']) {
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.chmodSync(path.join(dir, 'install.sh'), 0o755);
  fs.writeFileSync(path.join(stubDir, 'docker'), DOCKER_STUB, { mode: 0o755 });
  fs.writeFileSync(path.join(stubDir, 'health.js'), HEALTH_SERVER);

  const sandbox: Sandbox = {
    dir,
    stubDir,
    env: () => ({ ...(process.env as Record<string, string>), PATH: `${stubDir}:${process.env.PATH ?? ''}`, STUB_DIR: stubDir }),
    calls: () => (fs.existsSync(path.join(stubDir, 'calls.log')) ? fs.readFileSync(path.join(stubDir, 'calls.log'), 'utf8') : ''),
    run: (args, input, extraEnv = {}) =>
      new Promise((resolve, reject) => {
        const child = spawn('bash', ['install.sh', ...args], { cwd: dir, env: { ...sandbox.env(), ...extraEnv } });
        let out = '';
        child.stdout.on('data', (d: Buffer) => (out += d.toString()));
        child.stderr.on('data', (d: Buffer) => (out += d.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, out }));
        child.stdin.end(input);
      }),
  };
  sandboxes.push(sandbox);
  return sandbox;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function envValue(dir: string, key: string): string | undefined {
  const line = fs.readFileSync(path.join(dir, '.env'), 'utf8').split('\n').find((l) => l.startsWith(`${key}=`));
  return line === undefined ? undefined : line.slice(key.length + 1);
}

after(() => {
  for (const s of sandboxes) {
    const pidFile = path.join(s.stubDir, 'pids');
    if (fs.existsSync(pidFile)) {
      for (const pid of fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean)) {
        try {
          process.kill(Number(pid));
        } catch {
          // ya termino
        }
      }
    }
    fs.rmSync(s.dir, { recursive: true, force: true });
    fs.rmSync(s.stubDir, { recursive: true, force: true });
  }
});

describe('install.sh (con Docker simulado)', { skip }, () => {
  it('asistente interactivo: escribe .env seguro, crea storage, arranca y verifica /health', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const answers = [
      'AIzaSyClaveDePrueba1234', // GEMINI_API_KEY (oculta)
      '', // fuente de datos -> mock
      'TECS Acarigua', // nombre
      "Av. Libertador #5 $HOME & Cia", // direccion con caracteres especiales
      'Lun-Sab 9am-6pm', // horario
      '', // generar CHAT_API_KEY -> si
      '', // demo -> si
      '', // bind -> 127.0.0.1
      String(port), // puerto
      '', // proxy -> no
      '30', // mensajes por minuto
      '', // canales -> no
      '', // construir ahora -> si
    ].join('\n') + '\n';

    const { code, out } = await sb.run([], answers);
    assert.equal(code, 0, out);

    assert.equal(envValue(sb.dir, 'GEMINI_API_KEY'), "'AIzaSyClaveDePrueba1234'");
    assert.equal(envValue(sb.dir, 'STORE_ADDRESS'), "'Av. Libertador #5 $HOME & Cia'");
    assert.equal(envValue(sb.dir, 'RATE_LIMIT_MAX'), "'30'");
    assert.equal(envValue(sb.dir, 'HOST_PORT'), `'${port}'`);
    assert.equal(envValue(sb.dir, 'BIND_ADDRESS'), "'127.0.0.1'");
    assert.equal(envValue(sb.dir, 'ODOO_MODE'), "'mock'");
    assert.match(envValue(sb.dir, 'CHAT_API_KEY') ?? '', /^'[0-9a-f]{48}'$/);
    assert.match(envValue(sb.dir, 'APP_UID') ?? '', /^'\d+'$/);
    assert.notEqual(envValue(sb.dir, 'APP_UID'), "'0'", 'nunca debe correr como root');

    assert.equal((fs.statSync(path.join(sb.dir, '.env')).mode & 0o777).toString(8), '600');
    assert.ok(fs.statSync(path.join(sb.dir, 'storage/leads')).isDirectory());
    assert.ok(fs.statSync(path.join(sb.dir, 'storage/logs')).isDirectory());
    assert.match(sb.calls(), /docker compose up -d --build/);
    assert.match(out, /\/health responde OK/);
    assert.match(out, new RegExp(`http://localhost:${port}/demo/`));
    // la clave generada se muestra una vez
    assert.ok(out.includes((envValue(sb.dir, 'CHAT_API_KEY') ?? '').replace(/'/g, '')));
  });

  it('el .env resultante lo puede leer Node (comillas simples + caracteres especiales)', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const { code, out } = await sb.run(['--yes', '--no-start'], '', {
      GEMINI_API_KEY: 'k#1$abc&d', STORE_ADDRESS: 'Calle 5 #12 $x', HOST_PORT: String(port),
    });
    assert.equal(code, 0, out);
    const parsed = (process as unknown as { loadEnvFile?: unknown }).loadEnvFile;
    assert.equal(typeof parsed, 'function');
    const probe = spawnSync(
      process.execPath,
      ['-e', "process.loadEnvFile('.env'); console.log(JSON.stringify([process.env.GEMINI_API_KEY, process.env.STORE_ADDRESS]))"],
      { cwd: sb.dir, env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8' },
    );
    assert.equal(probe.status, 0, probe.stderr);
    assert.deepEqual(JSON.parse(probe.stdout), ['k#1$abc&d', 'Calle 5 #12 $x']);
    assert.equal(fs.existsSync(path.join(sb.dir, 'storage/leads')), true);
    assert.equal(sb.calls().includes('compose up'), false, '--no-start no debe arrancar nada');
  });

  it('--yes es repetible: conserva la CHAT_API_KEY y los datos existentes y deja copia .env.bak', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const env = { GEMINI_API_KEY: 'clave-uno-1234', HOST_PORT: String(port), STORE_NAME: 'Mi Tienda' };
    const first = await sb.run(['--yes'], '', env);
    assert.equal(first.code, 0, first.out);
    const key = envValue(sb.dir, 'CHAT_API_KEY');
    assert.match(key ?? '', /^'[0-9a-f]{48}'$/);

    // segunda ejecucion: sin variables de entorno, todo viene del .env
    const second = await sb.run(['--yes'], '', { HOST_PORT: String(port) });
    assert.equal(second.code, 0, second.out);
    assert.equal(envValue(sb.dir, 'CHAT_API_KEY'), key);
    assert.equal(envValue(sb.dir, 'GEMINI_API_KEY'), "'clave-uno-1234'");
    assert.equal(envValue(sb.dir, 'STORE_NAME'), "'Mi Tienda'");
    assert.ok(fs.existsSync(path.join(sb.dir, '.env.bak')));
    assert.equal((fs.statSync(path.join(sb.dir, '.env.bak')).mode & 0o777).toString(8), '600');
    assert.doesNotMatch(second.out, new RegExp((key ?? '').replace(/'/g, '')), 'la clave solo se imprime cuando se genera');
  });

  it('modo live: pide Odoo y corrige localhost por host.docker.internal', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const answers = [
      '', // gemini vacio
      'live',
      'http://localhost:8069', // url -> advierte
      '', // usar host.docker.internal -> si
      'tecs_prod',
      'bot@tecs.local',
      'api-key-odoo-9999',
      '', '', '', // tienda
      'n', // sin CHAT_API_KEY
      '', '', // demo, bind
      String(port),
      '', '', '', // proxy, rate, canales
      'n', // no arrancar
    ].join('\n') + '\n';
    const { code, out } = await sb.run([], answers);
    assert.equal(code, 0, out);
    assert.equal(envValue(sb.dir, 'ODOO_MODE'), "'live'");
    assert.equal(envValue(sb.dir, 'ODOO_URL'), "'http://host.docker.internal:8069'");
    assert.equal(envValue(sb.dir, 'ODOO_DB'), "'tecs_prod'");
    assert.equal(envValue(sb.dir, 'ODOO_PASSWORD'), "'api-key-odoo-9999'");
    assert.match(out, /Sin CHAT_API_KEY/);
    assert.equal(sb.calls().includes('compose up'), false);
  });

  it('configura canales con tokens de verificacion generados', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const answers = [
      'gk-1234567890', '', '', '', '', 'n', '', '', String(port), '', '', 's', // hasta "configurar canales? si"
      'meta-secret-1', // META_APP_SECRET
      '12345', 'wa-token-xyz', '', // phone id, access token, verify (generado)
      'ig-token-xyz', '', // instagram token, verify
      'ml-id', 'ml-secret', 'ml-access', 'ml-refresh', 'ml-seller',
      'n',
    ].join('\n') + '\n';
    const { code, out } = await sb.run([], answers);
    assert.equal(code, 0, out);
    assert.equal(envValue(sb.dir, 'META_APP_SECRET'), "'meta-secret-1'");
    assert.equal(envValue(sb.dir, 'WHATSAPP_PHONE_NUMBER_ID'), "'12345'");
    assert.match(envValue(sb.dir, 'WHATSAPP_VERIFY_TOKEN') ?? '', /^'[0-9a-f]{32}'$/);
    assert.match(envValue(sb.dir, 'INSTAGRAM_VERIFY_TOKEN') ?? '', /^'[0-9a-f]{32}'$/);
    assert.equal(envValue(sb.dir, 'MERCADOLIBRE_SELLER_ID'), "'ml-seller'");
  });

  it('valida entradas en --yes: puerto, modo, comillas simples y live incompleto', async () => {
    const sb = makeSandbox();
    const bad = async (env: Record<string, string>, pattern: RegExp): Promise<void> => {
      const { code, out } = await sb.run(['--yes', '--no-start'], '', env);
      assert.notEqual(code, 0, out);
      assert.match(out, pattern);
    };
    await bad({ HOST_PORT: 'abc' }, /HOST_PORT invalido/);
    await bad({ HOST_PORT: '70000' }, /HOST_PORT invalido/);
    await bad({ ODOO_MODE: 'otro' }, /ODOO_MODE debe ser mock o live/);
    await bad({ BIND_ADDRESS: '1.2.3.4' }, /BIND_ADDRESS debe ser/);
    await bad({ RATE_LIMIT_MAX: '0' }, /RATE_LIMIT_MAX invalido/);
    await bad({ STORE_NAME: "O'Brien" }, /comillas simples/);
    await bad({ ODOO_MODE: 'live' }, /modo live se necesitan/);
  });

  it('si el contenedor se cae: muestra el registro y falla (exit != 0)', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const { code, out } = await sb.run(['--yes'], '', { GEMINI_API_KEY: 'k-123456789', HOST_PORT: String(port), STUB_STATE: 'exited', STUB_NO_SERVER: '1' });
    assert.notEqual(code, 0);
    assert.match(out, /no esta corriendo \(estado: exited\)/);
    assert.match(out, /ultimas lineas del contenedor/);
  });

  it('si /health nunca responde: falla tras el tiempo de espera con el registro', async () => {
    const sb = makeSandbox();
    const port = await freePort();
    const { code, out } = await sb.run(['--yes'], '', { GEMINI_API_KEY: 'k-123456789', HOST_PORT: String(port), STUB_NO_SERVER: '1', INSTALL_HEALTH_TIMEOUT: '3' });
    assert.notEqual(code, 0);
    assert.match(out, /Pasaron 3s sin un \/health correcto/);
  });

  it('falla con mensaje claro si falta docker o el servicio no responde', async () => {
    const sb = makeSandbox();
    // PATH sin el stub y sin docker real
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tecs-nodocker-'));
    for (const tool of ['bash', 'dirname', 'cat', 'sed', 'grep', 'awk', 'tr', 'mktemp', 'cp', 'mv', 'chmod', 'head', 'od', 'cut', 'id', 'mkdir', 'sleep']) {
      const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      if (found) fs.symlinkSync(found, path.join(empty, tool));
    }
    const { code, out } = await sb.run(['--yes', '--no-start'], '', { PATH: empty });
    fs.rmSync(empty, { recursive: true, force: true });
    assert.notEqual(code, 0);
    assert.match(out, /No se encontro Docker/);
  });
});
