# CHANGELOG_SESSION

Rama de trabajo: `development`. Cada sesión se aplica con `node apply-update.js` en la raíz del proyecto
(`--dry-run` muestra qué haría sin escribir). El `apply-update.js` de cada sesión contiene **solo** los archivos
creados o modificados en ella.

---

## Sesión 6 (corrección) — Alta demanda de Gemini (503): reintentos y modelo de respaldo (2026-11-21)

Se aplica con `node patch-06-reintentos-gemini.js` (sobre los parches anteriores).

**Síntoma (log del usuario):** tras corregir el modelo, la primera consulta fallaba con `503 UNAVAILABLE: This model is currently
experiencing high demand`. No es un error de clave ni de configuración: es saturación temporal del servicio de Google. El código solo
reintentaba **una vez** a los 800 ms, poco para una saturación que dura segundos.

**Cambios:** `src/ai/GoogleGenAiClient.ts`, `src/config/env.ts`, `src/container.ts`, `src/utils/errors.ts`, `.env.example`, `README.md`,
`tests/dotenv-and-gemini-key.test.ts` (+8 pruebas), este archivo.

1. **Reintentos con retroceso exponencial** ante 429/500/502/503/504: 1 s, 2 s, 4 s (tope 8 s) más hasta 50 % de azar; por defecto 3 reintentos
   (peor caso ≈ 7–9 s extra, por debajo del tiempo de espera de 120 s del simulador). Cada reintento se registra como `warn`.
2. **Modelo de respaldo opcional** (`GEMINI_FALLBACK_MODEL`, vacío por defecto): si el principal sigue con error de servidor tras los reintentos,
   se prueba el de respaldo. No se usa con 429, 401/403, 404 ni 400 (cambiar de modelo no los arregla). No hay valor por defecto porque no
   pude verificar qué modelo ofrece tu cuenta.
3. **Error nuevo `LLM_UNAVAILABLE`** (HTTP 503, mensaje amable, `details`: `status`, `model`, `attempts`, `cause`) cuando se agotan los intentos;
   antes era un `LLM_ERROR` 502 genérico. El 429 sigue siendo `RATE_LIMITED`.

### Variables de entorno nuevas

| Variable | Defecto | Uso |
| --- | --- | --- |
| `GEMINI_MAX_RETRIES` | `3` | Reintentos ante alta demanda (0..6; 0 = sin reintentos) |
| `GEMINI_RETRY_BASE_MS` | `1000` | Espera base en ms del retroceso exponencial (0..30000) |
| `GEMINI_FALLBACK_MODEL` | vacío | Modelo alternativo ante fallos de servidor persistentes |

**Verificado:** `tsc` sin errores; 213 de 213 pruebas (guion de fallos 503/429, esperas exactas, tope, intentos, respaldo, configuración);
mutación: 4 regresiones, 4 detectadas. **No verificado:** el comportamiento real de Google bajo carga; si el 503 persiste minutos, ningún
reintento lo resuelve (conviene un `GEMINI_FALLBACK_MODEL` vigente de tu cuenta, o reintentar más tarde).

---

## Sesión 5 (corrección) — Modelo de Gemini retirado (404) (2026-11-21)

Se aplica con `node patch-05-modelo-gemini.js` (sobre los parches anteriores).

**Causa del `LLM_ERROR`** (ahora visible gracias al patch-04): Google respondió `404 NOT_FOUND` — `models/gemini-2.5-flash` ya no está
disponible para cuentas nuevas y recomienda `gemini-3.8-flash`. La clave `AQ.` funciona; el modelo del `.env` era el problema.

**Cambios:** `src/config/env.ts` (`DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash'`), `src/ai/GoogleGenAiClient.ts` y `src/utils/errors.ts`
(un 404 ahora es `LLM_MODEL_ERROR`, 502, con el modelo y la pista de qué cambiar), `.env.example` (`GEMINI_MODEL=gemini-3.8-flash` y
nota), `tests/dotenv-and-gemini-key.test.ts` (+1), `tests/packaging.test.ts` (el mensaje de fallo ahora nombra las variables que faltan en
`.env.example`), `README.md`. Sin variables nuevas. **Acción del usuario:** el `GEMINI_MODEL` de su `.env` manda sobre el
valor por defecto: debe cambiarlo a `gemini-3.8-flash` (o quitar la línea) y reiniciar.

**Prueba fallida reportada** (`packaging.test.ts`: "GEMINI_API_KEY" sin documentar en `.env.example`): la prueba exige una línea
`GEMINI_API_KEY=` en `.env.example` porque `install.sh` la escribe. Con los archivos entregados pasa (205/205 aquí; también con CRLF/BOM),
así que el `.env.example` local no tiene esa línea al inicio de renglón (editado a mano, sin aplicar el parche o con la clave en otro formato).
**No pude reproducirlo ni confirmar la causa.** Comprobar: `findstr /B "GEMINI_API_KEY" .env.example`.

**Verificado:** `tsc` sin errores, 205 de 205 pruebas. **No verificado:** que `gemini-3.8-flash` funcione con la clave del usuario
(nombre tomado del mensaje de error de Google) ni con Function Calling real.

---

## Sesión 4 (corrección) — Ver la causa real de `LLM_ERROR` en los logs (2026-11-21)

Se aplica con `node patch-04-log-errores-llm.js` (sobre los dos parches de la sesión 3).

**Síntoma:** con la clave ya detectada (`Gemini configurado`, `keyPrefix: "AQ."`), el log mostraba solo `LLM_ERROR: Fallo la consulta al
modelo de IA`. **Causa de ese silencio:** el logger serializaba los errores únicamente con `name`, `message` y `stack`, y descartaba
`code` y `details`, que es donde `GoogleGenAiClient` guarda el estado HTTP y el mensaje que devolvió Google. No es un fallo de la clave:
un 401/403 saldría como `LLM_AUTH_ERROR`, así que el rechazo fue de otro tipo (modelo, petición o red).

**Cambios:** `src/utils/logger.ts` (los errores ahora incluyen `code`, `details` y `cause`, con las claves sensibles aún en `[REDACTED]`),
`src/ai/GoogleGenAiClient.ts` (la causa guardada sube de 300 a 800 caracteres), `tests/error-logging.test.ts` (2 pruebas),
este archivo. Sin variables nuevas. `tsc` sin errores y 204 de 204 pruebas.

**No verificado:** la causa concreta del `LLM_ERROR` del usuario; sin acceso a su clave ni a Google no se puede determinar desde aquí.
Siguiente paso: reiniciar, repetir el mensaje y leer `error.details.status` y `error.details.cause` en el log.

---

## Sesión 3 (corrección) — Clave de Gemini y carga de `.env` en Windows (2026-11-18)

Se aplica con `node patch-03-fix-gemini-env.js` (requiere el `patch-03-docker-produccion.js` ya aplicado).

### Diagnóstico

- **No existe validación de prefijo ni longitud de la clave** en `env.ts`, `container.ts`, `GeminiService.ts` ni `GoogleGenAiClient.ts`:
  `AQ.Ab...` no se rechazaba por su formato. El aviso sale cuando `config.gemini.apiKey` llega `null`, o sea, cuando el proceso no ve
  la variable al cargar la configuración (`GeminiService.ts:52` solo lanza `LLM_NOT_CONFIGURED`).
- **Causa reproducida: `.env` guardado con BOM UTF-8 o en UTF-16** (Bloc de notas, PowerShell 5.1 con `-Encoding utf8`, `echo ... > .env`).
  `process.loadEnvFile` dejaba la primera variable con el nombre `"\uFEFFGEMINI_API_KEY"` (BOM UTF-8) o no leía nada (UTF-16), **sin avisar**.
- **No reproducible aquí:** una variable puesta con `$env:GEMINI_API_KEY` en PowerShell sí llega al proceso (Node la prioriza sobre `.env`).
  Si aun así falla, lo más probable es que el servidor se arrancara en otra ventana/terminal (la variable `$env:` solo vive en esa
  ventana) o que quedara un proceso viejo en el puerto. El nuevo log de arranque lo aclara (ver abajo).
- Orden de carga correcto: `loadDotEnv()` ya corría antes de `loadConfig()`; `npm run dev` y `npm start` pasan ambos por `server.ts`.

### Cambios

**Nuevos:** `src/config/dotenv.ts` (cargador propio sin dependencias), `tests/dotenv-and-gemini-key.test.ts` (19 pruebas)

**Modificados:** `src/config/env.ts`, `src/container.ts`, `src/server.ts`, `src/ai/GoogleGenAiClient.ts`, `src/utils/errors.ts`,
`.env.example`, `README.md` (sección de diagnóstico), este archivo.

1. **Cargador de `.env` propio** (`dotenv.ts`): detecta UTF-8, UTF-8 con BOM, UTF-16 LE/BE (con y sin BOM), CRLF, comillas simples/dobles,
   `export`, comentarios; `$` es literal. Busca `.env` en la carpeta de trabajo y luego en la raíz del proyecto, así que funciona aunque
   `npm run dev` se lance desde otra carpeta. Prioridad: variable de entorno **con valor** > `.env`; una variable definida pero **vacía** se
   rellena desde `.env`. Nunca lanza excepciones ni registra valores.
2. **Clave de Gemini** (`resolveGeminiKey`): limpia comillas, espacios y caracteres invisibles; **no valida prefijo ni longitud**
   (acepta `AQ.Ab...`, `AIza...` y formatos futuros); acepta `GOOGLE_API_KEY` como alternativa si `GEMINI_API_KEY` está vacía; avisa si
   la clave tiene espacios internos o parece un ejemplo.
3. **Diagnóstico al arrancar** (sin exponer la clave): `Archivo .env cargado` (ruta, codificación, nº de variables) o `No hay archivo .env`
   (rutas buscadas); `Gemini configurado` (origen, longitud, 3 primeros caracteres); avisos si el `.env` tenía problemas.
4. **`GoogleGenAiClient`**: `new GoogleGenAI({ apiKey, vertexai: false })` para que variables como `GOOGLE_GENAI_USE_VERTEXAI` no desvíen
   la llamada; un 401/403 de Google ahora es `LLM_AUTH_ERROR` (502) con pista, sin reintento; antes era un `LLM_ERROR` genérico.
   Se añadió la opción `sdk` (solo pruebas).

### Variables de entorno

Sin variables obligatorias nuevas. `GOOGLE_API_KEY` se reconoce como alternativa opcional a `GEMINI_API_KEY`.

### Verificación realizada

- `tsc` estricto sin errores; **202 de 202** pruebas (19 nuevas): BOM, UTF-16, CRLF, comillas, precedencia entorno/`.env`, búsqueda
  de rutas, claves `AQ.`/`AIza`, flujo `.env` → `loadConfig`, 401/403 → `LLM_AUTH_ERROR`, informes sin valores.
- Mutación: 6 regresiones introducidas; 5 detectadas y 1 equivalente (el BOM se quita dos veces, es defensa redundante).

### Lo que NO se pudo verificar

- **Con una clave real contra Google:** aquí no hay red hacia la API ni `@google/genai` real (solo tipos de apoyo). Según la documentación y
  reportes de Google, las claves `AQ.` funcionan con el endpoint nativo de Gemini vía `x-goog-api-key` (lo que usa el SDK) y fallan con
  `Authorization: Bearer`; también hay reportes de 401 `ACCESS_TOKEN_TYPE_UNSUPPORTED` por clave truncada o proyecto sin la API habilitada.
- **Tu PowerShell:** no pude reproducir el fallo con `$env:`; si persiste tras el parche, copia las 3 líneas del log (`Archivo .env…`,
  `Gemini configurado`/aviso) para ubicarlo.
- **`tsx watch --include .env`:** probé reiniciar el modo watch al cambiar `.env`, pero no lo hace (ignora archivos con punto), así que
  **no se incluyó**: tras editar `.env`, reinicia `npm run dev`.
- Si ves `LLM_AUTH_ERROR`, considera actualizar `@google/genai` (`npm i @google/genai@latest`); no lo toqué por no poder probarlo aquí.

---

## Sesión 3 — Empaquetado Docker de producción y límite de tasa (2026-11-18)

Se aplica con `node patch-03-docker-produccion.js` (misma mecánica que `apply-update.js`; `--dry-run` disponible).
Requiere las sesiones 1 y 2.

### Archivos

**Nuevos:** `Dockerfile`, `docker-compose.yml`, `install.sh` (modo 755), `.dockerignore`, `.gitattributes`,
`src/middleware/rateLimit.ts`, `src/utils/fileLogSink.ts`, `tests/rate-limit.test.ts`, `tests/file-logging.test.ts`,
`tests/packaging.test.ts`, `tests/installer.test.ts`

**Modificados:** `src/app.ts` (trust proxy + limitador), `src/routes/chat.routes.ts` (limitador solo en `POST /api/chat`),
`src/config/env.ts`, `src/server.ts` (log a archivo), `src/utils/logger.ts` (sink opcional), `public/demo/index.html`
(mensaje amable ante `RATE_LIMITED`), `.env.example`, `.gitignore` (`storage/`, `.env.bak`), `README.md`, este archivo.

### Variables de entorno nuevas

| Variable | Defecto | Uso |
| --- | --- | --- |
| `RATE_LIMIT_ENABLED` | `true` | Activa el límite por IP en `/api/chat` |
| `RATE_LIMIT_MAX` | `20` | Peticiones por ventana (1..100000) |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Ventana en segundos (1..86400) |
| `TRUST_PROXY` | `0` | Saltos de proxy confiables para leer `X-Forwarded-For` (0..10) |
| `LOG_DIR` | vacío | Carpeta de logs diarios (en Docker: `/app/storage/logs`) |
| `LOG_RETENTION_DAYS` | `14` | Días de logs que se conservan |
| `HOST_PORT`, `BIND_ADDRESS` | `3000`, `127.0.0.1` | Solo Docker: puerto y dirección publicados |
| `APP_UID`, `APP_GID`, `TZ` | `1000`, `1000`, `America/Caracas` | Solo Docker: dueño de `storage/` y zona horaria |

### Decisiones de diseño

- **Imagen**: 4 etapas; solo dependencias de producción, sin tests ni `.env`; usuario no-root; `HEALTHCHECK` a `/health`.
- **Red**: `tecs_net` propia (no `internal`, porque Gemini, Meta y Mercado Libre requieren salida). Aislamiento por
  raíz de solo lectura, `cap_drop: ALL`, `no-new-privileges`, `tmpfs /tmp` (`mode=1777,noexec,nosuid`), límites de memoria/procesos.
- **Persistencia**: bind mounts `./storage/leads` y `./storage/logs`; el instalador los crea con el UID correcto.
- **Límite de tasa**: ventana fija en memoria; IPv6 agrupado por /64; responde `429 RATE_LIMITED` con `Retry-After` y
  `RateLimit-*`. Se evalúa antes de autenticar. `/reset`, `/config` y webhooks no se limitan.
- **Logs**: si la carpeta no se puede crear, el servidor sigue solo con stdout; un fallo de escritura nunca tumba la app.
- **`.env`**: el instalador escribe `CLAVE='valor'` para que ni Compose ni Node interpolen `$`.

### Verificación realizada

- `tsc` estricto sin errores; suite completa de pruebas en verde (incluye pruebas nuevas de límite, logs, empaquetado e instalador).
- Pruebas de mutación sobre el limitador y la retención de logs: todas detectadas.
- `docker compose config` y `docker build --check` sin avisos; el Dockerfile real construyó contra una imagen base local.
- Contenedor con las banderas de Compose y UID arbitrario: `/app` y `/etc` de solo lectura, `storage` y `/tmp` escribibles.
- Instalador probado con `docker` simulado (interactivo, `--yes`, modo live, canales, validaciones, fallos).
- El parche se verificó sobre copia limpia: simulación, aplicación, segunda corrida idempotente y contenido idéntico.

### Lo que NO se pudo verificar

- `npm ci` real dentro del build ni la descarga de `node:22-alpine` (sin acceso a Docker Hub aquí).
- Comportamiento con Express real detrás de un proxy, ni llamadas reales a Gemini.

### Notas y pendientes

- El limitador es por proceso: con varias réplicas, cada una cuenta aparte. Con Docker Desktop o proxy sin `TRUST_PROXY`
  todos comparten una IP.
- Falta el proxy HTTPS (Caddy/nginx) para exponer los webhooks de Meta y Mercado Libre.
- Si el bit de ejecución se pierde al clonar: `git update-index --chmod=+x install.sh`.
- Primera prueba del 429: ver el bucle `curl` en el README.

---

## Sesión 2 — Simulador web de chat para demostración (2026-11-17)

Página de demostración en `http://localhost:3000/demo/` (HTML + CSS + JS vanilla en un solo archivo, sin frameworks
ni CDNs) para mostrarle al dueño de TECS cómo atiende el asistente y cómo se arma una PC paso a paso.

### Qué incluye el simulador

1. **App de mensajería** con identidad TECS (barra azul marino, acento naranja, logotipo de texto), burbujas
   por canal (verde WhatsApp, degradado Instagram, amarillo Mercado Libre), indicador de escritura, errores con
   botón **Reintentar** y diseño adaptable: en escritorio el panel va al lado; en móvil es un cajón deslizable
   con insignia de progreso (`3/7`) en el botón.
2. **Selector de canal** (`whatsapp | instagram | mercadolibre`) en la barra superior; envía `channel` a
   `POST /api/chat`. Cada conversación genera un `sessionId` propio (`demo-<16 hex>`). **Nueva conversación**
   libera la sesión anterior en el servidor (`POST /api/chat/reset`) y abre otra. Cambiar de canal también abre
   una conversación nueva (el servidor guarda el estado por canal + sessionId; mezclar canales confundiría el historial).
3. **Pruebas rápidas** (plegables): armado (“Quiero armar una PC gamer de $800”, oficina, edición, “Muéstrame
   cómo va mi armado”), consultas (“¿Qué cases tienen?”, “Busco una laptop”, “¿Tienen Ryzen 5 5600G?”,
   “¿Tienen Ryzen 7 5700X?” — agotado a propósito) y seguridad de canal (dirección y teléfono, para probar el filtro
   de Mercado Libre). **Visor del armado en vivo**: propósito, presupuesto, barra de gasto, los 7 pasos
   (hecho / siguiente / omitido), compatibilidad (errores y avisos), servicios de ensamblaje, total, diferencia
   contra el presupuesto, tiempo de entrega y el JSON completo. Lo recién elegido se resalta.
4. **`CHAT_API_KEY`**: la página consulta `GET /api/chat/config`; si el servidor exige clave, abre un modal
   (`<dialog>`) para ingresarla, la guarda en `localStorage` y la envía en `x-api-key`. Ante un `401` reabre el
   modal y reenvía el mensaje pendiente al guardar. Un botón con candado permite cambiarla o quitarla.
5. Casilla **“Ver detalle técnico”**: muestra las herramientas que usó el modelo por mensaje y los SKU.

### Archivos

**Nuevos:** `public/demo/index.html`, `src/routes/chat.handlers.ts`, `tests/demo-simulator.test.ts`, `tests/helpers/fakeLlm.ts`

**Modificados:** `src/app.ts` (sirve `/demo` con `express.static`, CSP y `nosniff`), `src/routes/chat.routes.ts`
(ahora delgado: delega en `chat.handlers.ts`), `src/services/ConversationService.ts` (`build` en el resultado + `reset`),
`src/services/PCBuildEngine.ts` (`view()` y tipo `PCBuildView`), `src/container.ts` (inyecta el motor a la conversación),
`src/config/env.ts` (`DEMO_ENABLED`), `src/server.ts` (log con la URL del demo), `.env.example`, `README.md`, `CHANGELOG_SESSION.md`

### Contrato HTTP (cambios)

| Ruta | Auth | Descripción |
| --- | --- | --- |
| `GET /demo/` | no | Simulador (solo si `DEMO_ENABLED=true`) |
| `GET /api/chat/config` | no | `{ requiresApiKey, storeName, mode, geminiConfigured, maxMessageChars }`. Nunca devuelve la clave |
| `POST /api/chat` | `x-api-key` si hay clave | **Nuevo campo `data.build`**: `PCBuildView` o `null` si no hay armado en curso |
| `POST /api/chat/reset` | `x-api-key` si hay clave | Body `{ sessionId, channel? }` → `{ sessionId, channel, reset }` (`reset:false` si ya no existía) |

`data.build` (`PCBuildView`): `purpose`, `budgetUsd`, `selected[{category,sku,name,priceUsd}]`, `nextStep`, `remainingSteps`,
`gpuOptional`, `gpuSkipped`, `spentUsd`, `complete`, `services[]`, `subtotalUsd`, `servicesUsd`, `totalUsd`, `deliveryEta`,
`budgetDeltaUsd`, `issues[{code,severity,message,categories}]`, `updatedAt`. Los servicios solo se suman al completar el armado.
Los errores siguen el formato `{ success:false, error:{ code, message, details } }`.

### Variables de entorno nuevas

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| `DEMO_ENABLED` | no | `true` | `false` desactiva `/demo`. Valor inválido ⇒ `CONFIG_ERROR` al arrancar |

(`CHAT_API_KEY` ya existía y ahora también protege `/api/chat/reset`.)

### Decisiones de diseño

- **Lógica fuera de Express:** `chat.handlers.ts` contiene funciones puras (`handleChat`, `handleReset`, `getChatConfig`);
  las rutas solo adaptan `req`/`res`. Así la autenticación, validación y forma de respuesta se probaron sin depender de Express.
- **La vista del armado es informativa:** si `engine.view()` falla (p. ej. Odoo caído al listar servicios), la respuesta al
  cliente sigue su curso con `build: null` y se registra un aviso.
- **Seguridad de la página:** todo el texto (incluidas las respuestas del modelo) se inserta como nodos de texto, nunca como HTML;
  CSP restrictiva (`default-src 'none'`, solo scripts/estilos en línea, `connect-src 'self'`); sin recursos externos.
  La clave de API vive solo en `localStorage` del navegador de quien la escribe.
- **Colores e identidad:** no se dispone del manual de marca de TECS; los colores son provisionales y están en variables CSS al
  inicio del archivo (`--navy`, `--blue`, `--orange`), y el logotipo es texto. Basta cambiarlos ahí.
- **Seguridad en producción:** `/demo` es una página estática pública; lo sensible es `/api/chat`. Sin `CHAT_API_KEY` esa ruta
  queda abierta (el servidor ya lo advierte al arrancar en producción). Para una instalación en producción sin demo: `DEMO_ENABLED=false`.

### Verificación realizada

- `tsc` estricto: 0 errores. **131 pruebas** (21 nuevas) pasan: vista del armado (vacío / en curso / completo / sin GPU),
  reinicio por canal + sessionId, fallo de la vista sin tumbar la respuesta, autenticación (4 claves inválidas), validación del
  cuerpo, `debug` según entorno, `config` sin filtrar la clave, `DEMO_ENABLED`, y revisiones estáticas del HTML (sin URLs externas,
  JS que compila, sin `eval`/HTML dinámico, ids existentes y únicos, categorías del visor = categorías del motor).
- Pruebas de mutación: 5 regresiones introducidas a propósito (reset que no borra, auth omitida, vista sin filtro de “sin armado”,
  `build` descartado, cabecera `x-api-key` cambiada); las 5 fueron detectadas.
- **Prueba de punta a punta en Chrome headless** contra los handlers reales (`ConversationService`, motor, catálogo mock) con un LLM
  simulado: armado completo de 7 pasos con total y servicios, cambio a Mercado Libre (teléfono y enlace eliminados), error 502 con
  “Reintentar”, nueva conversación, y flujo de clave (modal automático, clave errónea ⇒ modal con mensaje, clave correcta ⇒ reenvío
  automático, persistencia tras recargar, quitar clave). Escritorio 1280×820 y móvil 390×844 sin desbordamiento horizontal.
  **Con la CSP real activa: 0 violaciones ni errores de consola.**

### Lo que NO se pudo verificar

- **`express.static` y las cabeceras en `app.ts` con Express real** (sin red para `npm install`): se comprobó con tipos de apoyo y,
  para la página, con un servidor `node:http` que aplica la misma CSP. Primer paso: `npm install && npm run dev` y abrir `/demo/`.
- **Gemini real:** la prueba usó un modelo simulado; la latencia y el texto reales pueden variar (tiempo de espera del navegador: 120 s).
- **Navegadores:** probado en Chrome (escritorio y emulación móvil). No se probó en Safari ni Firefox.

### Pendientes / siguientes pasos sugeridos

1. `Dockerfile`, `docker-compose.yml`, `install.sh`: la imagen **debe copiar `public/`** además de `dist/` y `data/` (el servidor lo busca en `<raíz>/public`).
2. Límite de tasa por IP en `/api/chat` (protege el costo de Gemini; el simulador lo hace más fácil de alcanzar).
3. Logotipo y colores oficiales de TECS en el simulador.
4. Pendientes de la sesión 1 (abajo).

---

## Sesión 1 — Estructura base del backend (2026-11-17)

Rama de trabajo: `development` (partía solo con `README.md` y `.gitignore`).
Aplicar con `node apply-update.js` en la raíz del proyecto (`--dry-run` para ver qué haría sin escribir).

### Resumen

Backend completo en Node.js + TypeScript + Express con patrón adaptador `ODOO_MODE=mock | live`:
catálogo mock (35 productos + 3 servicios), `MockRepository`, `OdooRepository` (XML-RPC propio, sin dependencias),
servicio de Gemini con Function Calling, motor de armado de PC en memoria, adaptadores de canal
(WhatsApp, Instagram, Mercado Libre) y suite de pruebas.

### Archivos

**Modificados (ya existían):** `README.md` (reemplazado por guía de inicio), `.gitignore` (mismas 4 reglas + `coverage/` y archivos de leads mock).

**Raíz:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `.env.example`, `CHANGELOG_SESSION.md`

**Datos:** `data/catalog.mock.json`

**`src/` — arranque y HTTP:** `server.ts`, `app.ts`, `container.ts` (composición de dependencias), `routes/{health,chat,webhooks}.routes.ts`, `middleware/errorHandler.ts`

**`src/config`, `src/types`, `src/utils`:** `config/env.ts`, `types/{domain,api,llm}.ts`, `utils/{errors,logger,text,validators}.ts`

**`src/repositories` (patrón adaptador):** `IInventoryRepository.ts`, `matching.ts`, `MockRepository.ts`, `index.ts` (fábrica según `ODOO_MODE`), `odoo/{xmlrpc,OdooClient,specs,OdooRepository}.ts`

**`src/services` (lógica de negocio):** `compatibility.ts`, `curation.ts`, `CatalogService.ts`, `PCBuildEngine.ts`, `SessionStore.ts`, `ConversationService.ts`

**`src/ai`:** `prompt.ts`, `tools.ts`, `ToolExecutor.ts`, `GeminiService.ts`, `GoogleGenAiClient.ts`, `history.ts`, `replyGuard.ts`

**`src/channels`:** `types.ts`, `WhatsAppAdapter.ts`, `InstagramAdapter.ts`, `MercadoLibreAdapter.ts`, `ChannelDispatcher.ts`, `metaSignature.ts`, `SeenCache.ts`, `http.ts`, `payload.ts`

**`tests/`:** 7 archivos `*.test.ts` + `helpers/{fixtures,fakeOdoo}.ts` (servidor Odoo XML-RPC simulado)

### Variables de entorno

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| `ODOO_MODE` | no | `mock` | `mock` o `live` |
| `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` | solo `live` | — | Conexión XML-RPC (password = API key) |
| `ODOO_TIMEOUT_MS` | no | `15000` | Timeout por llamada |
| `ODOO_SPECS_FIELD` | no | `description_sale` | Campo con las especificaciones `clave: valor` |
| `ODOO_CATEGORY_MAP` | no | ver `env.ts` | JSON categoría-bot → categoría Odoo |
| `ODOO_CREATE_QUOTATION` | no | `false` | Crear además `sale.order` borrador |
| `MOCK_CATALOG_PATH`, `MOCK_LEADS_PATH` | no | `./data/...` | Catálogo y leads del modo mock |
| `GEMINI_API_KEY` | para atender | — | Sin ella el servidor arranca y responde `LLM_NOT_CONFIGURED` |
| `GEMINI_MODEL`, `GEMINI_TEMPERATURE`, `GEMINI_MAX_TOOL_ROUNDS` | no | `gemini-flash-latest`, `0.4`, `6` | Modelo y bucle de herramientas |
| `SESSION_TTL_MINUTES`, `SESSION_MAX_COUNT`, `SESSION_MAX_HISTORY_TURNS` | no | `120`, `5000`, `14` | Memoria de sesiones |
| `STORE_NAME`, `STORE_CITY`, `STORE_ADDRESS`, `STORE_HOURS` | no | `TECS`, `Acarigua, Portuguesa`, vacío | Datos de tienda (dirección/horario solo salen en WhatsApp/Instagram) |
| `BUILD_DELIVERY_ETA` | no | `24 a 48 horas hábiles tras confirmar el pago` | Tiempo de entrega en cotizaciones |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN` | para ese canal | — | WhatsApp Cloud API |
| `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_VERIFY_TOKEN` | para ese canal | — | Instagram DM |
| `META_APP_SECRET` | **sí en producción** | — | Valida `X-Hub-Signature-256` |
| `META_GRAPH_VERSION` | no | `v23.0` | Versión del Graph API (verificar la vigente) |
| `MERCADOLIBRE_ACCESS_TOKEN`, `_REFRESH_TOKEN`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_SELLER_ID` | para ese canal | — | Mercado Libre |
| `CHAT_API_KEY` | recomendada en producción | — | Protege `POST /api/chat` y `POST /api/chat/reset` (header `x-api-key`) |
| `DEMO_ENABLED` | no | `true` | Sirve el simulador web en `/demo` (sesión 2) |
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | no | `3000`, `development`, `info` | Servidor |

### Decisiones de diseño que conviene conocer

- **Reglas comerciales aplicadas en código, no solo en el prompt:** consulta vaga ⇒ la herramienta responde `NEEDS_CLARIFICATION` con las preguntas y no consulta inventario; tope de 3 productos por mensaje (`DISPLAY_LIMIT_REACHED`) aunque el modelo encadene búsquedas; los repositorios filtran `stock > 0` y recortan a `limit 5`.
- **Excepciones deliberadas al filtro de stock** (documentadas en la interfaz): `lookupByName`/`getProductBySku` devuelven también agotados para poder decir "agotado" con precio exacto, y `listServices` (los servicios no tienen stock). Todas conservan el tope de 5.
- **Mercado Libre, defensa en tres capas:** prompt del canal + herramienta `registrar_visita` bloqueada + filtro de salida (`replyGuard`) que elimina teléfonos, correos, `@usuarios`, enlaces/dominios, direcciones y la dirección configurada.
- **Odoo sin dependencias:** códec XML-RPC propio (`xmlrpc.ts`) sobre `fetch`. Las especificaciones técnicas se leen de líneas `clave: valor` en `description_sale` y los filtros técnicos (socket, DDR, formato de case) se traducen a dominios `ilike`, de modo que el `limit: 5` se aplica del lado de Odoo.
- **Aislamiento del SDK:** todo el sistema habla con `LlmClient`; solo `GoogleGenAiClient.ts` importa `@google/genai`. Conserva `thoughtSignature` e `id` de las llamadas, requisito de los modelos Gemini 3.
- **Compatibilidad:** socket CPU/placa, DDR RAM/placa, formato placa/case, largo de GPU/case y potencia de fuente (TDP + 120 W). Si falta una especificación se emite advertencia, no bloqueo.
- **Presupuesto por paso:** reparto por propósito (gaming/creación/oficina) descontando servicios y redistribuyendo lo ya gastado; si nada cabe, ofrece las 2 más económicas marcadas `overBudget`.

### Verificación realizada

- `tsc` en modo estricto (`strict`, `noUnusedLocals`, `noUnusedParameters`): 0 errores; `build` emite `dist/server.js` y el CJS compilado carga.
- 110 pruebas en 22 suites: todas pasan. Incluyen paridad Mock vs Odoo (13 consultas, mismo orden de SKUs) contra un servidor Odoo XML-RPC simulado con evaluador de dominios, y el flujo completo de armado.
- Pruebas de mutación: 12 regresiones introducidas a propósito (quitar filtro de stock, tope de 3, filtro de teléfonos, firma de Meta, etc.), las 12 fueron detectadas.
- Exploración de 42 escenarios (3 propósitos × 7 presupuestos × elección primera/última): 0 callejones sin salida, 0 incompatibilidades.
- Revisión estática: sin `any`, sin residuos de otros proyectos, sin secretos, capas de negocio sin dependencia de implementaciones de datos.

### Lo que NO se pudo verificar (sin red para `npm install`)

- **Capa Express** (`app.ts`, `routes/`, `middleware/`): comprobada con tipos de apoyo locales, **no ejecutada contra `express` real**. Primer paso al instalar: `npm install && npm run typecheck && npm test && npm run dev`.
- **`@google/genai`**: tipado modelado desde la API pública, no compilado contra el paquete real ni probado contra la API de Gemini. Verifica `GEMINI_MODEL` (el alias `gemini-flash-latest` cambia de modelo con el tiempo; conviene fijar uno).
- **Odoo, WhatsApp, Instagram y Mercado Libre reales:** probados solo contra simulaciones. Los payloads siguen la documentación de cada plataforma, pero requieren una prueba de punta a punta con credenciales.
- **Catálogo:** modelos reales, pero precios, stock y varias especificaciones (p. ej. largo máximo de GPU de algunos cases) son **valores de demostración** a validar con la tienda.

### Pendientes / siguientes pasos sugeridos

1. `Dockerfile`, `docker-compose.yml`, `install.sh` (entrega "llave en mano").
2. Límite de tasa por usuario/IP (protege el costo de Gemini en `/api/chat` y webhooks).
3. Persistir el `refresh_token` de Mercado Libre (hoy solo vive en memoria tras renovarse).
4. Sesiones en Redis si se necesita más de una instancia (hoy son en memoria por diseño).
5. Script de migración que cargue `catalog.mock.json` a Odoo usando `formatSpecText`.
