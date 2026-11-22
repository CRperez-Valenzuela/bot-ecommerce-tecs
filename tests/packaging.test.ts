import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config/env';

const ROOT = path.resolve(__dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore').split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
const compose = read('docker-compose.yml');
const installer = read('install.sh');
const envExample = read('.env.example');

/** Claves "KEY=" definidas (comentadas o no) en .env.example. */
const documentedKeys = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] as string));

describe('Dockerfile', () => {
  const stages = [...dockerfile.matchAll(/^FROM\s+\S+\s+AS\s+(\S+)/gm)].map((m) => m[1]);

  it('es multi-stage: deps -> build -> prod-deps -> runtime', () => {
    assert.deepEqual(stages, ['deps', 'build', 'prod-deps', 'runtime']);
  });

  it('la imagen final copia dist/, data/ y public/ (y node_modules de produccion)', () => {
    const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
    assert.match(runtime, /COPY --from=build\b[^\n]*\/app\/dist \.\/dist/);
    assert.match(runtime, /COPY\b[^\n]*\bdata \.\/data/);
    assert.match(runtime, /COPY\b[^\n]*\bpublic \.\/public/);
    assert.match(runtime, /COPY --from=prod-deps\b[^\n]*node_modules/);
    assert.doesNotMatch(runtime, /COPY --from=deps/, 'no debe heredar devDependencies');
  });

  it('instala dependencias reproducibles y las de produccion sin dev', () => {
    assert.match(dockerfile, /npm ci --no-audit --no-fund/);
    assert.match(dockerfile, /npm ci --omit=dev/);
    assert.doesNotMatch(dockerfile, /npm install/);
  });

  it('corre sin privilegios, con healthcheck y arranque coherente con package.json', () => {
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /^HEALTHCHECK\b/m);
    assert.match(dockerfile, /\/health/);
    assert.match(dockerfile, /NODE_ENV=production/);
    const main = (JSON.parse(read('package.json')) as { main: string }).main;
    assert.match(dockerfile, new RegExp(`CMD \\["node", "${main.replace('.', '\\.')}"\\]`));
  });

  it('no copia todo el contexto ni secretos', () => {
    assert.doesNotMatch(dockerfile, /^COPY\s+\.\s+\.?/m);
    assert.doesNotMatch(dockerfile, /^(?:COPY|ADD)\b[^\n]*\s\.env\b/m);
  });

  it('crea las mismas carpetas de datos que monta docker-compose', () => {
    for (const dir of ['/app/storage/leads', '/app/storage/logs']) {
      assert.ok(dockerfile.includes(dir), `${dir} falta en el Dockerfile`);
      assert.ok(compose.includes(`:${dir}`), `${dir} falta como volumen en docker-compose.yml`);
    }
  });
});

describe('.dockerignore', () => {
  it('excluye secretos, dependencias locales y datos de ejecucion', () => {
    for (const entry of ['.env', 'node_modules', 'dist', 'storage', '.git', 'tests']) {
      assert.ok(dockerignore.includes(entry), `falta ${entry}`);
    }
  });

  it('NO excluye lo que la imagen necesita', () => {
    for (const needed of ['public', 'public/demo/index.html', 'data', 'data/catalog.mock.json', 'src', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.build.json']) {
      const hit = dockerignore.find((pattern) => pattern === needed || (pattern.includes('*') && new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(needed)));
      assert.equal(hit, undefined, `${needed} esta excluido por "${hit}"`);
    }
  });
});

describe('docker-compose.yml', () => {
  it('red aislada propia, puerto solo en loopback por defecto y sin modos peligrosos', () => {
    assert.match(compose, /^networks:\s*\n\s+tecs_net:/m);
    assert.match(compose, /networks:\s*\n\s+- tecs_net/);
    assert.match(compose, /\$\{BIND_ADDRESS:-127\.0\.0\.1\}:\$\{HOST_PORT:-3000\}:3000/);
    assert.doesNotMatch(compose, /privileged|network_mode|pid:\s*host|docker\.sock/);
  });

  it('persistencia de leads y logs en ./storage y rutas que la app entiende', () => {
    assert.match(compose, /- \.\/storage\/leads:\/app\/storage\/leads/);
    assert.match(compose, /- \.\/storage\/logs:\/app\/storage\/logs/);
    assert.match(compose, /MOCK_LEADS_PATH: \/app\/storage\/leads\//);
    assert.match(compose, /LOG_DIR: \/app\/storage\/logs/);
    const config = loadConfig({ MOCK_LEADS_PATH: '/app/storage/leads/leads.mock.json', LOG_DIR: '/app/storage/logs', NODE_ENV: 'production', PORT: '3000' });
    assert.equal(config.mock.leadsPath, '/app/storage/leads/leads.mock.json');
    assert.equal(config.logging.dir, '/app/storage/logs');
  });

  it('endurecimiento: solo lectura, sin capacidades, sin escalado de privilegios, limites y rotacion de logs', () => {
    assert.match(compose, /read_only: true/);
    assert.match(compose, /cap_drop:\s*\n\s+- ALL/);
    assert.match(compose, /no-new-privileges:true/);
    assert.match(compose, /mem_limit:/);
    assert.match(compose, /pids_limit:/);
    assert.match(compose, /max-size: "10m"/);
    assert.match(compose, /restart: unless-stopped/);
    assert.match(compose, /user: "\$\{APP_UID:-1000\}:\$\{APP_GID:-1000\}"/);
  });

  it('el nombre del contenedor coincide con el que usa install.sh', () => {
    const name = /container_name: (\S+)/.exec(compose)?.[1];
    assert.equal(name, 'tecs-bot');
    assert.match(installer, /^CONTAINER="tecs-bot"$/m);
  });

  it('fuerza NODE_ENV=production y puerto interno 3000', () => {
    assert.match(compose, /NODE_ENV: production/);
    assert.match(compose, /PORT: "3000"/);
  });
});

describe('install.sh y archivos de fin de linea', () => {
  it('tiene shebang bash y la sintaxis es valida', { skip: process.platform === 'win32' }, () => {
    assert.match(installer, /^#!\/usr\/bin\/env bash\n/);
    const result = spawnSync('bash', ['-n', path.join(ROOT, 'install.sh')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  it('verifica /health y no usa rutas fuera del proyecto', () => {
    assert.match(installer, /\/health/);
    assert.doesNotMatch(installer, /\brm\s+-rf?\b/);
  });

  it('los archivos de contenedor usan LF y .gitattributes lo fuerza', () => {
    for (const file of ['Dockerfile', 'docker-compose.yml', 'install.sh', '.dockerignore', '.env.example']) {
      assert.equal(read(file).includes('\r'), false, `${file} tiene CRLF`);
    }
    const attributes = read('.gitattributes');
    assert.match(attributes, /^\*\.sh text eol=lf$/m);
    assert.match(attributes, /^Dockerfile text eol=lf$/m);
  });
});

describe('cableado del limite de tasa (revision estatica; Express real no se ejecuta en estas pruebas)', () => {
  const routes = read('src/routes/chat.routes.ts');
  const app = read('src/app.ts');

  it('POST /api/chat ejecuta el limitador ANTES de autenticar y de llamar a Gemini', () => {
    const post = /router\.post\(\s*'\/api\/chat',\s*\.\.\.limit,\s*asyncHandler\(/.exec(routes);
    assert.ok(post, 'el limitador debe ir antes del handler de /api/chat');
    // /reset y /config no consumen Gemini: sin limitador
    assert.doesNotMatch(routes, /'\/api\/chat\/reset',\s*\.\.\.limit/);
  });

  it('app.ts crea el limitador desde la configuracion y respeta TRUST_PROXY', () => {
    assert.match(app, /config\.rateLimit\.enabled/);
    assert.match(app, /new RateLimiter\(\{ max: config\.rateLimit\.max, windowMs: config\.rateLimit\.windowSeconds \* 1000 \}\)/);
    assert.match(app, /\{ rateLimit: chatRateLimit \}/);
    assert.match(app, /if \(config\.trustProxy > 0\) app\.set\('trust proxy', config\.trustProxy\)/);
  });
});

describe('.env.example documenta todo lo que se usa', () => {
  it('cada variable que lee env.ts esta documentada', () => {
    const source = read('src/config/env.ts');
    const keys = [...source.matchAll(/\br\.(?:str|int|float|bool|required)\('([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1] as string);
    assert.ok(keys.length > 30, 'no se pudieron extraer las variables de env.ts');
    const missing = keys.filter((key) => !documentedKeys.has(key));
    assert.deepEqual(missing, []);
  });

  it('cada variable que escribe install.sh y las de docker-compose estan documentadas', () => {
    const written = [...installer.matchAll(/env_set ([A-Z][A-Z0-9_]+)/g)].map((m) => m[1] as string);
    assert.ok(written.length > 20);
    const composeVars = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]+)[:}-]/g)].map((m) => m[1] as string);
    const undocumented = [...new Set([...written, ...composeVars])].filter((key) => !documentedKeys.has(key));
    assert.deepEqual(undocumented, [], `faltan en .env.example (una linea "CLAVE=" por variable): ${undocumented.join(', ')}`);
  });

  it('con la plantilla tal cual, la configuracion carga sin errores', () => {
    const env: Record<string, string> = {};
    for (const line of envExample.split('\n')) {
      const match = /^([A-Z][A-Z0-9_]+)=(.*)$/.exec(line);
      if (match) env[match[1] as string] = match[2] as string;
    }
    assert.doesNotThrow(() => loadConfig(env));
  });
});
