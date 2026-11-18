# CHANGELOG_SESSION — Estructura base del backend (2026-11-17)

Rama de trabajo: `development` (partía solo con `README.md` y `.gitignore`).
Aplicar con `node apply-update.js` en la raíz del proyecto (`--dry-run` para ver qué haría sin escribir).

## Resumen

Backend completo en Node.js + TypeScript + Express con patrón adaptador `ODOO_MODE=mock | live`:
catálogo mock (35 productos + 3 servicios), `MockRepository`, `OdooRepository` (XML-RPC propio, sin dependencias),
servicio de Gemini con Function Calling, motor de armado de PC en memoria, adaptadores de canal
(WhatsApp, Instagram, Mercado Libre) y suite de pruebas.

## Archivos

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

## Variables de entorno

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
| `CHAT_API_KEY` | recomendada en producción | — | Protege `POST /api/chat` (header `x-api-key`) |
| `PORT`, `NODE_ENV`, `LOG_LEVEL` | no | `3000`, `development`, `info` | Servidor |

## Decisiones de diseño que conviene conocer

- **Reglas comerciales aplicadas en código, no solo en el prompt:** consulta vaga ⇒ la herramienta responde `NEEDS_CLARIFICATION` con las preguntas y no consulta inventario; tope de 3 productos por mensaje (`DISPLAY_LIMIT_REACHED`) aunque el modelo encadene búsquedas; los repositorios filtran `stock > 0` y recortan a `limit 5`.
- **Excepciones deliberadas al filtro de stock** (documentadas en la interfaz): `lookupByName`/`getProductBySku` devuelven también agotados para poder decir "agotado" con precio exacto, y `listServices` (los servicios no tienen stock). Todas conservan el tope de 5.
- **Mercado Libre, defensa en tres capas:** prompt del canal + herramienta `registrar_visita` bloqueada + filtro de salida (`replyGuard`) que elimina teléfonos, correos, `@usuarios`, enlaces/dominios, direcciones y la dirección configurada.
- **Odoo sin dependencias:** códec XML-RPC propio (`xmlrpc.ts`) sobre `fetch`. Las especificaciones técnicas se leen de líneas `clave: valor` en `description_sale` y los filtros técnicos (socket, DDR, formato de case) se traducen a dominios `ilike`, de modo que el `limit: 5` se aplica del lado de Odoo.
- **Aislamiento del SDK:** todo el sistema habla con `LlmClient`; solo `GoogleGenAiClient.ts` importa `@google/genai`. Conserva `thoughtSignature` e `id` de las llamadas, requisito de los modelos Gemini 3.
- **Compatibilidad:** socket CPU/placa, DDR RAM/placa, formato placa/case, largo de GPU/case y potencia de fuente (TDP + 120 W). Si falta una especificación se emite advertencia, no bloqueo.
- **Presupuesto por paso:** reparto por propósito (gaming/creación/oficina) descontando servicios y redistribuyendo lo ya gastado; si nada cabe, ofrece las 2 más económicas marcadas `overBudget`.

## Verificación realizada

- `tsc` en modo estricto (`strict`, `noUnusedLocals`, `noUnusedParameters`): 0 errores; `build` emite `dist/server.js` y el CJS compilado carga.
- 110 pruebas en 22 suites: todas pasan. Incluyen paridad Mock vs Odoo (13 consultas, mismo orden de SKUs) contra un servidor Odoo XML-RPC simulado con evaluador de dominios, y el flujo completo de armado.
- Pruebas de mutación: 12 regresiones introducidas a propósito (quitar filtro de stock, tope de 3, filtro de teléfonos, firma de Meta, etc.), las 12 fueron detectadas.
- Exploración de 42 escenarios (3 propósitos × 7 presupuestos × elección primera/última): 0 callejones sin salida, 0 incompatibilidades.
- Revisión estática: sin `any`, sin residuos de otros proyectos, sin secretos, capas de negocio sin dependencia de implementaciones de datos.

## Lo que NO se pudo verificar (sin red para `npm install`)

- **Capa Express** (`app.ts`, `routes/`, `middleware/`): comprobada con tipos de apoyo locales, **no ejecutada contra `express` real**. Primer paso al instalar: `npm install && npm run typecheck && npm test && npm run dev`.
- **`@google/genai`**: tipado modelado desde la API pública, no compilado contra el paquete real ni probado contra la API de Gemini. Verifica `GEMINI_MODEL` (el alias `gemini-flash-latest` cambia de modelo con el tiempo; conviene fijar uno).
- **Odoo, WhatsApp, Instagram y Mercado Libre reales:** probados solo contra simulaciones. Los payloads siguen la documentación de cada plataforma, pero requieren una prueba de punta a punta con credenciales.
- **Catálogo:** modelos reales, pero precios, stock y varias especificaciones (p. ej. largo máximo de GPU de algunos cases) son **valores de demostración** a validar con la tienda.

## Pendientes / siguientes pasos sugeridos

1. `Dockerfile`, `docker-compose.yml`, `install.sh` (entrega "llave en mano").
2. Límite de tasa por usuario/IP (protege el costo de Gemini en `/api/chat` y webhooks).
3. Persistir el `refresh_token` de Mercado Libre (hoy solo vive en memoria tras renovarse).
4. Sesiones en Redis si se necesita más de una instancia (hoy son en memoria por diseño).
5. Script de migración que cargue `catalog.mock.json` a Odoo usando `formatSpecText`.
