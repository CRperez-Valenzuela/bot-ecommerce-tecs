# Bot Ecommerce TECS Acarigua

Asistente comercial omnicanal con IA (Gemini + Node.js/TypeScript/Express) para la tienda TECS (Acarigua).
Atiende WhatsApp, Instagram DM y Mercado Libre, filtra consultas vagas, arma cotizaciones de PC paso a paso
en memoria y concreta visitas en la tienda fisica. Arquitectura dual: `ODOO_MODE=mock | live`.

## Inicio rapido (modo demo, sin Odoo)

```bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env y define GEMINI_API_KEY
npm run dev
```

Prueba el asistente sin WhatsApp:

```bash
curl -s localhost:3000/api/chat -H "content-type: application/json" \
  -d '{"message":"Quiero armar una PC para jugar, tengo 800 dolares"}'
```

La respuesta incluye un `sessionId`: reenvialo para continuar la conversacion. Con `"channel":"mercadolibre"` se
prueban las politicas de seguridad de ese canal. Si el armado de PC esta en curso, `data.build` trae su estado.

### Simulador web de demostracion

Abre **http://localhost:3000/demo/** para chatear desde el navegador: elige canal (WhatsApp, Instagram, Mercado Libre),
usa las pruebas rapidas y mira en vivo como la IA va llenando el armado de PC y calculando el montaje. Si defines
`CHAT_API_KEY`, la pagina pide la clave en un modal y la envia en `x-api-key`. Desactivalo con `DEMO_ENABLED=false`.

### Si el servidor dice "GEMINI_API_KEY no configurada"

1. Al arrancar, el log indica si cargo un `.env` (`Archivo .env cargado`, con su ruta) o dónde lo buscó. El `.env` debe estar en la
   raíz del proyecto (junto a `package.json`), con una línea `GEMINI_API_KEY=AQ.Ab...` (sin comillas ni espacios).
2. Con la clave detectada verás `Gemini configurado` con su origen, longitud y los 3 primeros caracteres (nunca la clave completa).
3. Las variables del entorno (p. ej. `$env:GEMINI_API_KEY="..."` en PowerShell) tienen prioridad sobre `.env`, pero solo valen para esa
   ventana de PowerShell: arranca `npm run dev` en la misma ventana. Si la variable existe pero está vacía, se usa la del `.env`.
4. Se aceptan claves `AQ.Ab...` y `AIza...`; no se valida el formato. Si Google la rechaza (401/403) la respuesta es `LLM_AUTH_ERROR`:
   copia la clave completa y confirma que su proyecto tiene habilitada la API de Gemini.
4b. Si el log muestra `LLM_MODEL_ERROR` (404), el modelo ya no existe para tu cuenta: cambia `GEMINI_MODEL` en `.env` (por defecto `gemini-3.8-flash`) y reinicia.
4c. `LLM_UNAVAILABLE` (503) = Gemini con alta demanda temporal: el servidor ya reintenta solo (`GEMINI_MAX_RETRIES`, `GEMINI_RETRY_BASE_MS`); puedes definir `GEMINI_FALLBACK_MODEL` como respaldo.
5. Tras editar `.env`, reinicia `npm run dev` (el modo watch no vigila archivos que empiezan con punto).
6. Evita crear el `.env` con `echo ... > .env` de PowerShell (genera UTF-16); el cargador lo tolera y avisa, pero guárdalo como UTF-8.

## Despliegue con Docker (llave en mano)

Requisitos: Docker con Compose v2 y `bash`/`curl` (Linux, macOS o WSL). En el servidor de TECS:

```bash
chmod +x install.sh   # solo si el bit de ejecucion se perdio (git update-index --chmod=+x install.sh)
./install.sh          # asistente interactivo; --yes usa los valores existentes/por defecto, --no-start solo escribe .env
```

El asistente pide la clave de Gemini, el modo (`mock` o `live` con datos de Odoo), los datos de la tienda, genera
`CHAT_API_KEY`, escribe `.env` (permisos 600, con copia `.env.bak`), construye la imagen, levanta el contenedor y
espera a que `/health` responda `ok`. Es idempotente: puedes volver a correrlo para cambiar valores.

| Elemento | Detalle |
| --- | --- |
| `Dockerfile` | Multi-stage (deps, build, prod-deps, runtime). Copia `dist/`, `data/` y `public/`; corre como usuario `node` con `HEALTHCHECK` en `/health`. |
| `docker-compose.yml` | Red propia `tecs_net`, raiz de solo lectura, `cap_drop: ALL`, `no-new-privileges`, limites de memoria/procesos, rotacion de logs de Docker. |
| Persistencia | `./storage/leads` (leads del modo mock) y `./storage/logs` (`app-AAAA-MM-DD.log`, rotacion diaria, `LOG_RETENTION_DAYS`). |
| Puerto | `127.0.0.1:3000` por defecto (`BIND_ADDRESS`, `HOST_PORT`). Para Meta/Mercado Libre publica detras de un proxy HTTPS (no incluido). |

### Limite de tasa en `/api/chat`

Ventana fija por IP para proteger el consumo de Gemini: `RATE_LIMIT_ENABLED` (true), `RATE_LIMIT_MAX` (20) y
`RATE_LIMIT_WINDOW_SECONDS` (60). Al excederlo responde `429` con `error.code = "RATE_LIMITED"` y `Retry-After`.
Detras de un proxy inverso define `TRUST_PROXY=1` (numero de saltos); sin eso todos los clientes comparten la IP del proxy.
El contador vive en memoria de cada proceso. Prueba: `for i in $(seq 25); do curl -s -o /dev/null -w "%{http_code} " localhost:3000/api/chat -H "content-type: application/json" -d '{"message":"hola"}'; done`.

## Arquitectura

| Capa | Ubicacion | Responsabilidad |
| --- | --- | --- |
| Datos (patron adaptador) | `src/repositories` | `IInventoryRepository` + `MockRepository` (JSON local) + `OdooRepository` (XML-RPC) |
| Negocio | `src/services` | Curaduria (max. 3 opciones, desambiguacion), compatibilidad, motor de armado de PC, sesiones |
| IA | `src/ai` | Prompt del sistema, declaracion/ejecucion de herramientas, bucle de Function Calling con Gemini, filtro de salida por canal |
| Demo | `public/demo` | Simulador web (HTML/CSS/JS vanilla, sin dependencias) |
| Canales | `src/channels` | WhatsApp Cloud API, Instagram DM, Mercado Libre (webhooks + envio) |
| HTTP | `src/app.ts`, `src/routes` | Express: `/health`, `/api/chat` (+ `/config`, `/reset`), `/webhooks/*`, `/demo`; errores `{ success:false, error:{ code, message, details } }` |

## Pasar a Odoo real (`ODOO_MODE=live`)

1. Define `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME` y `ODOO_PASSWORD` (API key del usuario de integracion).
2. Apps instaladas en Odoo Community: Inventario, Ventas y CRM. Productos **almacenables** (con seguimiento de inventario).
3. Categorias de producto con los nombres de `DEFAULT_CATEGORY_MAP` (`src/config/env.ts`) o su equivalente en `ODOO_CATEGORY_MAP`.
4. Especificaciones tecnicas en `description_sale`, una por linea (`clave: valor`):

```text
socket: AM4
memory_type: DDR4
form_factors: |ATX|mATX|ITX|
tdp_w: 65
igpu: si
tags: gaming, economico
summary: Frase corta para el cliente
```

`formatSpecText` (`src/repositories/odoo/specs.ts`) genera este texto desde el catalogo mock para migrar los productos.

## Pruebas

```bash
npm run typecheck
npm test
```
