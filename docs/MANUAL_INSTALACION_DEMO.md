# Manual de instalación y demostración — Asistente comercial TECS

Guía para instalar el asistente en modo **demo** (catálogo de prueba, sin Odoo) y presentarlo al dueño de TECS.
Pensada para Windows; los pasos de Docker también valen en Linux.

---

## 1. Qué se va a mostrar

Un asistente de IA (Gemini) que atiende consultas de una tienda de computación:

- Filtra consultas vagas con 1 o 2 preguntas y muestra **máximo 3 opciones** (nunca vuelca el inventario).
- Consulta un producto puntual (precio y disponibilidad; si está agotado ofrece alternativas).
- **Arma una PC paso a paso** (procesador → placa → memoria → almacenamiento → video → fuente → case), verifica compatibilidad, suma el ensamblaje y el tiempo de entrega.
- Invita a **visitar la tienda en Acarigua** y registra al cliente (nombre y teléfono).
- Funciona por **WhatsApp, Instagram y Mercado Libre** (en Mercado Libre nunca da teléfonos, direcciones ni enlaces).

En la demo se usa el **simulador web** (`/demo`), que se comporta como esos canales sin necesitar cuentas de Meta ni de Mercado Libre.

> Importante: el catálogo, los precios y el stock de la demo son **datos de ejemplo** (`data/catalog.mock.json`). Se reemplazan por los reales de TECS al conectar Odoo.

---

## 2. Qué necesitas

| Qué | Detalle |
| --- | --- |
| Computadora | Windows 10/11 (o Linux/macOS), con internet |
| Node.js | Versión **22 o superior** (`node -v`). Descarga LTS en nodejs.org |
| Clave de Gemini | Se crea en Google AI Studio. Vale el formato `AQ.Ab...` o `AIza...` |
| Proyecto | La carpeta del proyecto con los parches aplicados (`node patch-XX.js` en orden) |

**Sobre la cuota de Gemini:** el nivel gratuito tiene límites bajos y un mensaje del cliente puede usar varias llamadas. Para una demo con el dueño alcanza, pero **no para clientes reales**: cuando TECS decida usarlo en producción conviene activar facturación en Google AI Studio.

---

## 3. Instalación (Opción A: directo con Node — la más simple para la demo)

En una terminal (PowerShell) dentro de la carpeta del proyecto:

```powershell
npm install
copy .env.example .env
notepad .env
```

En el `.env` completa **como mínimo** (guárdalo como UTF-8):

```dotenv
GEMINI_API_KEY=AQ.Ab...tu_clave...
GEMINI_MODEL=gemini-3.6-flash
GEMINI_FALLBACK_MODEL=gemini-3.7-flash,gemini-3.5-flash
STORE_NAME=TECS
STORE_CITY=Acarigua, Portuguesa
STORE_ADDRESS=Dirección real de la tienda
STORE_HOURS=Lunes a sábado 8:00 a 18:00
ODOO_MODE=mock
```

Los nombres de modelo cambian con el tiempo: **verifica cuáles responden con tu clave** antes de la demo:

```powershell
node probe-models.js gemini-3.6-flash gemini-3.7-flash gemini-3.5-flash gemini-3.8-flash
```

Deja en `GEMINI_MODEL` uno que diga FUNCIONA y los demás que funcionen en `GEMINI_FALLBACK_MODEL` (separados por coma).

Arranca:

```powershell
npm run dev
```

Debes ver en la consola, entre otras líneas:

- `Archivo .env cargado` (con la ruta)
- `Gemini configurado` (origen, longitud de la clave y el modelo)
- `Servidor iniciado` … `"demo":"http://localhost:3000/demo/"`

Abre **http://localhost:3000/demo/** en el navegador.

Para dejarlo corriendo "como en producción" (más estable que `dev`, no se reinicia al editar archivos):

```powershell
npm run build
npm start
```

> Si cambias el `.env`, **detén (Ctrl+C) y vuelve a arrancar**. El modo `dev` no vigila ese archivo.

---

## 4. Instalación (Opción B: Docker, "llave en mano")

Requiere Docker (Docker Desktop en Windows, con bash/WSL) y la carpeta del proyecto.

```bash
chmod +x install.sh      # solo si hace falta
./install.sh
```

El asistente te pregunta la clave de Gemini, el modo (`mock`), los datos de la tienda, genera la clave de acceso (`CHAT_API_KEY`), levanta el contenedor y comprueba `/health`. Al final imprime las direcciones y la clave generada **una sola vez: anótala**.

Por defecto queda en `http://127.0.0.1:3000` (solo esa computadora). Los leads y logs quedan en `storage/leads` y `storage/logs`. Usa la Opción A si no necesitas Docker.

---

## 5. ¿Podrá el jefe de TECS ver la interfaz desde su computadora?

Sí. Hay tres formas, de la más simple a la más "real":

### 5.1 Presentarla tú, en tu pantalla (recomendado para la primera demo)
Abres `http://localhost:3000/demo/` y se la muestras. Cero configuración de red.

### 5.2 Que él la abra en su PC, dentro de la misma red (Wi-Fi/LAN de la tienda)
1. En la computadora donde corre el asistente, averigua su IP: `ipconfig` → "Dirección IPv4" (ej. `192.168.1.25`).
2. El servidor Node escucha en todas las interfaces, así que desde su PC basta abrir `http://192.168.1.25:3000/demo/`.
3. Si no abre, es el **Firewall de Windows**: permite el puerto 3000 de entrada para redes privadas (Windows Defender Firewall → Reglas de entrada → Nueva regla → Puerto → TCP 3000 → Permitir, solo "Privada").
4. En Docker, además, edita `.env`: `BIND_ADDRESS=0.0.0.0` y vuelve a ejecutar `./install.sh`.
5. **Pon una `CHAT_API_KEY`** en el `.env` (cualquier texto largo). El simulador pedirá esa clave la primera vez y la recordará en ese navegador. Sin clave, cualquiera en la red podría gastar tu cuota de Gemini.

Esta conexión no usa HTTPS: úsala solo en una red de confianza.

### 5.3 Desde fuera de la tienda (opcional)
Con un túnel (Cloudflare Tunnel, ngrok) se obtiene un enlace público con HTTPS. Hazlo **solo con `CHAT_API_KEY` activa**, y apaga el túnel al terminar la demo. Este mismo mecanismo (una URL pública con HTTPS) será necesario más adelante para conectar WhatsApp e Instagram de verdad.

---

## 6. Qué tendrá el jefe a su disposición hoy (y qué no)

**Sí hay:**

| Qué | Dónde |
| --- | --- |
| Simulador de chat con selector de canal (WhatsApp / Instagram / Mercado Libre) | `/demo/` |
| Visor del armado de PC en vivo (componentes, total, compatibilidad, tiempo de entrega) | Panel lateral del simulador |
| Botones de pruebas rápidas y "Nueva conversación" | Simulador |
| Estado del servidor | `http://localhost:3000/health` |
| Leads (clientes que quieren visitar la tienda) | Archivo `data/leads.mock.json` (Docker: `storage/leads/leads.mock.json`) |
| Registros de actividad y errores | Consola; con Docker en `storage/logs/app-AAAA-MM-DD.log` |
| Catálogo y precios de ejemplo (editable) | `data/catalog.mock.json` (reiniciar para aplicar) |

**No hay todavía:**

- **Panel de administración:** no existe una pantalla para ver leads, editar el catálogo ni ver estadísticas; se hace con los archivos de arriba. Es el siguiente paso natural si el cliente lo pide.
- **Derivación a un humano:** el asistente **no** pasa la conversación a un vendedor. Lo más cercano es registrar al cliente para una visita con `registrar_visita`; nadie recibe una alerta. Para producción conviene agregarla (ver sección 10).
- **Catálogo real:** requiere conectar Odoo (`ODOO_MODE=live`).
- **WhatsApp/Instagram/Mercado Libre reales:** requieren cuentas, tokens y una URL pública con HTTPS (sección 9).

---

## 7. Guion sugerido para la demostración (10–15 minutos)

Usa el canal **WhatsApp** y los botones de "Pruebas rápidas" si prefieres no escribir.

1. **Consulta vaga:** "¿Qué cases tienen?" → el asistente **no lista todo**: pregunta presupuesto o formato y luego muestra 2–3 opciones.
2. **Producto puntual:** "¿Tienen Ryzen 5 5600G?" → precio y disponibilidad. Luego "¿Tienen Ryzen 7 5700X?" → está **agotado a propósito**: ofrece alternativas.
3. **Flujo estrella:** "Quiero armar una PC gamer de $800" → paso a paso. Muestra el **panel lateral** llenándose, el control de compatibilidad, el costo de ensamblaje y el tiempo de entrega.
4. **Visita a la tienda:** al terminar, da nombre y teléfono → queda registrado el lead. Abre `data/leads.mock.json` y muéstralo.
5. **Seguridad en Mercado Libre:** cambia a ese canal y pregunta "¿Dónde están ubicados? ¿Me das su teléfono?" → **no entrega** teléfono, dirección ni enlaces.
6. **Ráfagas (WhatsApp móvil):** el asistente junta varios mensajes seguidos en una sola respuesta (ver sección 8).
7. **Cierre:** explica qué falta para producción (sección 9) y la cuota de Gemini.

Evita improvisar preguntas muy largas o fuera de tema en vivo la primera vez; ensáyalo antes.

---

## 8. Cómo se comporta con WhatsApp móvil (control de flujo)

| Situación | Qué hace el sistema |
| --- | --- |
| El cliente escribe 3 mensajes seguidos | Espera ~2,5 s tras el último y responde **una sola vez** (`MESSAGE_DEBOUNCE_MS`) |
| Un cliente manda demasiados mensajes | Pasado el límite (10 por minuto, `WEBHOOK_USER_RATE_MAX`) avisa **una vez** y descarta el resto sin gastar Gemini |
| Muchos clientes a la vez | Las llamadas a Gemini hacen cola con ritmo controlado (`GEMINI_MAX_CONCURRENT`, `GEMINI_MAX_RPM`) |
| Meta reenvía un mensaje | Se ignora el duplicado |
| Gemini saturado o sin cuota | Reintenta y pasa a los modelos de respaldo (`GEMINI_FALLBACK_MODEL`) |

Pon `GEMINI_MAX_RPM` igual al límite por minuto de tu plan (míralo en Google AI Studio) para no chocar con el 429.

---

## 9. Para pasar de demo a producción

1. **Gemini de pago** (o un plan con cuota suficiente) y revisar los modelos vigentes.
2. **Odoo Community:** `ODOO_MODE=live` y las variables `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD`; cargar productos reales (con especificaciones `clave: valor` en la descripción de venta).
3. **WhatsApp Cloud API / Instagram:** cuenta de Meta Business, tokens (`WHATSAPP_*`, `INSTAGRAM_*`, `META_APP_SECRET`), y un **servidor con dominio y HTTPS** (nginx o Caddy) para el webhook. Meta solo permite texto libre dentro de ~24 horas desde el último mensaje del cliente (confirmar en su documentación).
4. **Mercado Libre:** credenciales de la aplicación (`MERCADOLIBRE_*`).
5. **Datos reales de la tienda** (dirección, horario, tiempo de entrega `BUILD_DELIVERY_ETA`) y revisión del tono del asistente con el dueño.
6. **Servidor encendido siempre** (Docker con `restart: unless-stopped` ya viene configurado) y respaldo de `storage/`.

---

## 10. Pendientes recomendados antes de producción

- **Derivar a un humano:** que el cliente pueda pedir "hablar con un asesor" y la conversación se avise a un vendedor (mensaje al WhatsApp del encargado) mientras el bot se silencia en ese chat.
- **Panel sencillo para el dueño:** leads recibidos, conversaciones y catálogo.
- **Reducir llamadas a Gemini por mensaje** (menos vueltas de herramientas) para gastar menos cuota.
- **Dejar de enviar `temperature`** a los modelos nuevos (Google la deprecó desde 3.6 Flash).

---

## 11. Lista de verificación

**24 horas antes**
- [ ] `node -v` muestra 22 o más; `npm install` sin errores.
- [ ] `npm run typecheck` y `npm test` en verde.
- [ ] `node probe-models.js ...` → al menos 2 modelos en FUNCIONA; ya están en `.env`.
- [ ] Recorrido completo del guion (sección 7) sin errores.
- [ ] Datos de la tienda reales en `.env` (nombre, dirección, horario).

**1 hora antes**
- [ ] Internet estable; computadora conectada a la corriente.
- [ ] `npm run dev` (o `npm start`) corriendo; `http://localhost:3000/health` responde `ok`.
- [ ] Navegador en `/demo/`, canal WhatsApp, "Nueva conversación".
- [ ] Si el jefe verá la página desde su PC: probar abrirla desde otra computadora de la red, y tener la `CHAT_API_KEY` a la mano.
- [ ] Capturas o un video corto de una demo exitosa, **por si falla internet o Gemini** (plan B).
- [ ] Cerrar programas pesados; desactivar el reposo de la computadora.

---

## 12. Solución de problemas

| Lo que ves | Qué significa | Qué hacer |
| --- | --- | --- |
| `GEMINI_API_KEY no configurada` | El servidor no ve la clave | Revisa que el `.env` esté en la carpeta del proyecto (junto a `package.json`) y reinicia. Mira la línea `Archivo .env cargado` en la consola |
| `LLM_NOT_CONFIGURED` en el chat | Igual que el anterior | Igual |
| `LLM_MODEL_ERROR` (404) | Esos modelos no están disponibles para tu clave | `node probe-models.js ...` y ajusta `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` |
| `LLM_UNAVAILABLE` (503) | Gemini saturado o sin respuesta | Espera unos segundos y pulsa **Reintentar**; agrega modelos de respaldo |
| `LLM_QUOTA` (429) | Cuota de Gemini agotada (no es el límite del simulador) | Espera 1 minuto; si es cuota diaria, usa otro modelo o activa facturación |
| `LLM_AUTH_ERROR` | Google rechazó la clave | Copia la clave completa, sin comillas ni espacios; verifica la API en tu proyecto |
| `RATE_LIMITED` | Demasiados mensajes seguidos al servidor (20/min por IP) | Espera unos segundos |
| La página no abre desde otra PC | Firewall o IP equivocada | Sección 5.2 |
| El simulador pide una clave | Hay `CHAT_API_KEY` | Escríbela una vez en el recuadro |
| Los cambios del `.env` no se aplican | El modo dev no vigila ese archivo | Ctrl+C y `npm run dev` otra vez |

Cuando algo falle, copia las 3–5 últimas líneas de la consola: traen el código del error y el detalle que devolvió Google.
