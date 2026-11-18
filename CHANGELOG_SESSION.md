# CHANGELOG_SESSION

Rama de trabajo: `development`. Cada sesión se aplica con `node apply-update.js` en la raíz del proyecto
(`--dry-run` muestra qué haría sin escribir). El `apply-update.js` de cada sesión contiene **solo** los archivos
creados o modificados en ella.

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
