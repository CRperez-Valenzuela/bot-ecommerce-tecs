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
prueban las politicas de seguridad de ese canal.

## Arquitectura

| Capa | Ubicacion | Responsabilidad |
| --- | --- | --- |
| Datos (patron adaptador) | `src/repositories` | `IInventoryRepository` + `MockRepository` (JSON local) + `OdooRepository` (XML-RPC) |
| Negocio | `src/services` | Curaduria (max. 3 opciones, desambiguacion), compatibilidad, motor de armado de PC, sesiones |
| IA | `src/ai` | Prompt del sistema, declaracion/ejecucion de herramientas, bucle de Function Calling con Gemini, filtro de salida por canal |
| Canales | `src/channels` | WhatsApp Cloud API, Instagram DM, Mercado Libre (webhooks + envio) |
| HTTP | `src/app.ts`, `src/routes` | Express: `/health`, `/api/chat`, `/webhooks/*`; errores `{ success:false, error:{ code, message, details } }` |

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
