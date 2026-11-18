#!/usr/bin/env bash
# ============================================================================
# Bot Ecommerce TECS Acarigua - instalador interactivo (Docker)
#
# Pide las variables clave, escribe el .env, construye y arranca el contenedor
# y verifica que /health responda "ok".
#
# Uso:
#   ./install.sh            asistente interactivo (se puede repetir: conserva lo ya configurado)
#   ./install.sh --yes      sin preguntas: usa el .env actual, las variables de entorno y los valores por defecto
#   ./install.sh --no-start solo configura (.env y carpetas), sin construir ni arrancar
#   ./install.sh --help
#
# Ejemplo sin preguntas:  GEMINI_API_KEY=xxxx ./install.sh --yes
# Requiere: Docker con Compose v2 (docker compose) y curl o wget. Linux, macOS, WSL o Git Bash.
# ============================================================================
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
TEMPLATE=".env.example"
CONTAINER="tecs-bot"
HEALTH_TIMEOUT="${INSTALL_HEALTH_TIMEOUT:-120}"
ASSUME_YES=0
NO_START=0
GENERATED_CHAT_KEY=""
COMPOSE=""

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BOLD=$'\033[1m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BOLD=""; C_OFF=""
fi

info() { printf '%s\n' "$*"; }
ok()   { printf '%s✔%s %s\n' "$C_GREEN" "$C_OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW" "$C_OFF" "$*" >&2; }
fail() { printf '%s✖ %s%s\n' "$C_RED" "$*" "$C_OFF" >&2; exit 1; }
title() { printf '\n%s%s%s\n' "$C_BOLD" "$*" "$C_OFF"; }

usage() {
  sed -n '3,15p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    --no-start) NO_START=1 ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Opcion desconocida: $arg (usa --help)" ;;
  esac
done

# ------------------------------------------------------------------ .env ---

# Valor de KEY en .env (sin comillas envolventes); vacio si no existe.
env_get() {
  local key="$1" line value
  [ -f "$ENV_FILE" ] || return 0
  line=$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 || true)
  value=${line#*=}
  case "$value" in
    \'*\') value=${value#\'}; value=${value%\'} ;;
    \"*\") value=${value#\"}; value=${value%\"} ;;
  esac
  printf '%s' "$value"
}

# Escribe KEY='VALUE' en .env (reemplaza la linea existente o agrega una). Los valores van entre comillas simples
# para que ni Docker Compose ni Node interpreten "$" u otros caracteres.
env_set() {
  local key="$1" value="$2" tmp
  case "$value" in
    *\'*) fail "El valor de $key no puede contener comillas simples (')." ;;
    *$'\n'*|*$'\r'*) fail "El valor de $key no puede tener saltos de linea." ;;
  esac
  tmp=$(mktemp "${ENV_FILE}.XXXXXX")
  ENV_KEY="$key" ENV_VALUE="$value" awk '
    BEGIN { k = ENVIRON["ENV_KEY"]; v = ENVIRON["ENV_VALUE"]; q = sprintf("%c", 39); done = 0 }
    index($0, k "=") == 1 { if (!done) { print k "=" q v q; done = 1 }; next }
    { print }
    END { if (!done) print k "=" q v q }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

# Valor inicial de una variable: (con --yes) variable de entorno > .env actual > valor por defecto.
current() {
  local key="$1" default="${2:-}" value=""
  if [ "$ASSUME_YES" = 1 ] && [ -n "${!key:-}" ]; then value="${!key}"; fi
  [ -n "$value" ] || value=$(env_get "$key")
  [ -n "$value" ] || value="$default"
  printf '%s' "$value"
}

# -------------------------------------------------------------- preguntas ---

# ask VAR "Pregunta" "defecto"
ask() {
  local var="$1" prompt="$2" default="${3:-}" reply=""
  if [ "$ASSUME_YES" = 1 ]; then printf -v "$var" '%s' "$default"; return 0; fi
  if [ -n "$default" ]; then printf '%s [%s]: ' "$prompt" "$default" >&2; else printf '%s: ' "$prompt" >&2; fi
  IFS= read -r reply || true
  [ -n "$reply" ] || reply="$default"
  printf -v "$var" '%s' "$reply"
}

mask() {
  local value="$1"
  if [ -z "$value" ]; then printf 'vacio'; elif [ "${#value}" -gt 8 ]; then printf '****%s' "${value: -4}"; else printf '****'; fi
}

# ask_secret VAR "Pregunta" "valor actual"  (Enter conserva el actual; "-" lo deja vacio)
ask_secret() {
  local var="$1" prompt="$2" current_value="${3:-}" reply=""
  if [ "$ASSUME_YES" = 1 ]; then printf -v "$var" '%s' "$current_value"; return 0; fi
  printf '%s [Enter = conservar (%s), - = vaciar]: ' "$prompt" "$(mask "$current_value")" >&2
  IFS= read -r -s reply || true
  printf '\n' >&2
  if [ -z "$reply" ]; then reply="$current_value"; elif [ "$reply" = "-" ]; then reply=""; fi
  printf -v "$var" '%s' "$reply"
}

# ask_yn "Pregunta" S|N  -> 0 si la respuesta es si
ask_yn() {
  local prompt="$1" default="$2" reply="" hint="[S/n]"
  [ "$default" = "N" ] && hint="[s/N]"
  if [ "$ASSUME_YES" = 1 ]; then [ "$default" = "S" ]; return; fi
  printf '%s %s: ' "$prompt" "$hint" >&2
  IFS= read -r reply || true
  reply=$(printf '%s' "${reply:-$default}" | tr '[:upper:]' '[:lower:]')
  case "$reply" in s|si|y|yes) return 0 ;; *) return 1 ;; esac
}

random_hex() {
  local bytes="${1:-24}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  else
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

is_port() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
is_posint() { case "$1" in ''|*[!0-9]*) return 1 ;; esac; [ "$1" -ge 1 ] && [ "$1" -le 100000 ]; }

port_in_use() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    return 1
  fi
}

# ------------------------------------------------------------- requisitos ---

preflight() {
  title "1/5  Comprobando requisitos"
  command -v docker >/dev/null 2>&1 || fail "No se encontro Docker. Instalalo desde https://docs.docker.com/get-docker/ y vuelve a ejecutar."
  if docker compose version >/dev/null 2>&1; then
    COMPOSE="docker compose"
  elif command -v docker-compose >/dev/null 2>&1 && docker-compose version >/dev/null 2>&1; then
    COMPOSE="docker-compose"
    warn "Se usara docker-compose (v1). Se recomienda Docker Compose v2."
  else
    fail "Falta Docker Compose. Instala el plugin 'docker compose' (v2)."
  fi
  docker info >/dev/null 2>&1 || fail "El servicio de Docker no responde. Inicialo (o agrega tu usuario al grupo 'docker') y reintenta."
  command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1 || fail "Se necesita curl o wget para verificar /health."
  local file
  for file in Dockerfile docker-compose.yml "$TEMPLATE" package.json package-lock.json; do
    [ -f "$file" ] || fail "Falta $file en $(pwd). Ejecuta el instalador desde la raiz del proyecto."
  done
  [ -d dist ] || [ -d src ] || fail "No se encontro el codigo (src/). Ejecuta el instalador desde la raiz del proyecto."
  ok "Docker listo ($COMPOSE)"
}

# ---------------------------------------------------------- configuracion ---

configure() {
  title "2/5  Configuracion"
  if [ -f "$ENV_FILE" ]; then
    cp -p "$ENV_FILE" "$ENV_FILE.bak"
    chmod 600 "$ENV_FILE.bak"
    info "Ya existe un .env: se conservan sus valores como predeterminados (copia en $ENV_FILE.bak)."
  else
    cp "$TEMPLATE" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
  [ "$ASSUME_YES" = 1 ] && info "Modo --yes: sin preguntas."
  [ "$ASSUME_YES" = 1 ] || info "Pulsa Enter para aceptar el valor entre corchetes."

  local gemini mode odoo_url odoo_db odoo_user odoo_pass store_name store_address store_hours
  local chat_key bind port demo proxy rate

  # --- Gemini ---
  info ""
  ask_secret gemini "Clave de Gemini (GEMINI_API_KEY)" "$(current GEMINI_API_KEY)"
  [ -n "$gemini" ] || warn "Sin GEMINI_API_KEY el bot arranca pero respondera con error hasta que la configures en .env."

  # --- Fuente de datos ---
  while :; do
    ask mode "Fuente de datos: mock (catalogo local de demostracion) o live (Odoo)" "$(current ODOO_MODE mock)"
    mode=$(printf '%s' "$mode" | tr '[:upper:]' '[:lower:]')
    case "$mode" in mock|live) break ;; esac
    [ "$ASSUME_YES" = 1 ] && fail "ODOO_MODE debe ser mock o live."
    warn "Escribe mock o live."
  done
  if [ "$mode" = "live" ]; then
    ask odoo_url "URL de Odoo (desde el contenedor)" "$(current ODOO_URL http://host.docker.internal:8069)"
    case "$odoo_url" in
      http://localhost*|https://localhost*|http://127.0.0.1*|https://127.0.0.1*)
        warn "Dentro de Docker, 'localhost' es el propio contenedor, no tu servidor."
        if ask_yn "Usar host.docker.internal (el equipo anfitrion)?" S; then
          odoo_url=${odoo_url/localhost/host.docker.internal}
          odoo_url=${odoo_url/127.0.0.1/host.docker.internal}
        fi ;;
    esac
    ask odoo_db "Base de datos de Odoo" "$(current ODOO_DB tecs)"
    ask odoo_user "Usuario de integracion de Odoo" "$(current ODOO_USERNAME bot@tecs.local)"
    ask_secret odoo_pass "Contrasena o API key de Odoo" "$(current ODOO_PASSWORD)"
    if [ -z "$odoo_url" ] || [ -z "$odoo_db" ] || [ -z "$odoo_user" ] || [ -z "$odoo_pass" ]; then
      fail "En modo live se necesitan URL, base de datos, usuario y contrasena de Odoo."
    fi
  fi

  # --- Tienda ---
  info ""
  ask store_name "Nombre de la tienda" "$(current STORE_NAME TECS)"
  ask store_address "Direccion de la tienda (solo se comparte en WhatsApp/Instagram)" "$(current STORE_ADDRESS)"
  ask store_hours "Horario de atencion" "$(current STORE_HOURS)"

  # --- Acceso y red ---
  info ""
  local existing_key
  existing_key=$(current CHAT_API_KEY)
  if [ -n "$existing_key" ]; then
    ask_secret chat_key "Clave de acceso al chat/simulador (CHAT_API_KEY)" "$existing_key"
  elif ask_yn "Generar una CHAT_API_KEY aleatoria para proteger el chat? (recomendado)" S; then
    chat_key=$(random_hex 24)
    GENERATED_CHAT_KEY="$chat_key"
  else
    chat_key=""
    warn "Sin CHAT_API_KEY, cualquiera con acceso a la URL puede gastar tu cuota de Gemini."
  fi
  if ask_yn "Activar el simulador web en /demo?" "$([ "$(current DEMO_ENABLED true)" = "false" ] && echo N || echo S)"; then demo=true; else demo=false; fi

  while :; do
    ask bind "Direccion de escucha: 127.0.0.1 (solo este equipo) o 0.0.0.0 (toda la red)" "$(current BIND_ADDRESS 127.0.0.1)"
    case "$bind" in 127.0.0.1|0.0.0.0) break ;; esac
    [ "$ASSUME_YES" = 1 ] && fail "BIND_ADDRESS debe ser 127.0.0.1 o 0.0.0.0."
    warn "Escribe 127.0.0.1 o 0.0.0.0."
  done
  while :; do
    ask port "Puerto del equipo donde se publica el bot" "$(current HOST_PORT 3000)"
    if is_port "$port"; then
      if port_in_use "$port" && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
        [ "$ASSUME_YES" = 1 ] && fail "El puerto $port ya esta en uso."
        warn "El puerto $port ya esta en uso por otro programa. Elige otro."
        continue
      fi
      break
    fi
    [ "$ASSUME_YES" = 1 ] && fail "HOST_PORT invalido: $port"
    warn "Escribe un puerto entre 1 y 65535."
  done
  if [ "$bind" = "0.0.0.0" ] && [ -z "$chat_key" ]; then
    warn "Abriste el bot a toda la red SIN CHAT_API_KEY."
  fi

  if ask_yn "Hay un proxy inverso (nginx, Caddy, Cloudflare...) delante del bot?" N; then proxy=1; else proxy=0; fi
  while :; do
    ask rate "Mensajes maximos por minuto y por IP en /api/chat (protege el gasto de Gemini)" "$(current RATE_LIMIT_MAX 20)"
    is_posint "$rate" && break
    [ "$ASSUME_YES" = 1 ] && fail "RATE_LIMIT_MAX invalido: $rate"
    warn "Escribe un numero entero mayor que 0."
  done

  # --- Escritura ---
  env_set GEMINI_API_KEY "$gemini"
  env_set ODOO_MODE "$mode"
  if [ "$mode" = "live" ]; then
    env_set ODOO_URL "$odoo_url"
    env_set ODOO_DB "$odoo_db"
    env_set ODOO_USERNAME "$odoo_user"
    env_set ODOO_PASSWORD "$odoo_pass"
  fi
  env_set STORE_NAME "$store_name"
  env_set STORE_ADDRESS "$store_address"
  env_set STORE_HOURS "$store_hours"
  env_set CHAT_API_KEY "$chat_key"
  env_set DEMO_ENABLED "$demo"
  env_set BIND_ADDRESS "$bind"
  env_set HOST_PORT "$port"
  env_set TRUST_PROXY "$proxy"
  env_set RATE_LIMIT_MAX "$rate"
  env_set RATE_LIMIT_WINDOW_SECONDS "$(current RATE_LIMIT_WINDOW_SECONDS 60)"

  # Usuario del contenedor = tu usuario, para poder escribir en ./storage (nunca root).
  local uid gid
  uid=$(id -u); gid=$(id -g)
  if [ "$uid" = "0" ]; then uid=1000; gid=1000; fi
  env_set APP_UID "$uid"
  env_set APP_GID "$gid"

  configure_channels
  ok "Configuracion guardada en $ENV_FILE (permisos 600)"
}

configure_channels() {
  info ""
  if ! ask_yn "Configurar ahora los canales (WhatsApp, Instagram, Mercado Libre)? Puedes hacerlo luego editando .env" N; then
    return 0
  fi
  local v
  info "Deja vacio (Enter) lo que no uses."
  ask_secret v "META_APP_SECRET (secreto de la app de Meta; obligatorio para WhatsApp/Instagram)" "$(current META_APP_SECRET)"; env_set META_APP_SECRET "$v"

  ask v "WhatsApp - WHATSAPP_PHONE_NUMBER_ID" "$(current WHATSAPP_PHONE_NUMBER_ID)"; env_set WHATSAPP_PHONE_NUMBER_ID "$v"
  ask_secret v "WhatsApp - WHATSAPP_ACCESS_TOKEN" "$(current WHATSAPP_ACCESS_TOKEN)"; env_set WHATSAPP_ACCESS_TOKEN "$v"
  local verify
  verify=$(current WHATSAPP_VERIFY_TOKEN)
  [ -n "$verify" ] || verify=$(random_hex 16)
  ask v "WhatsApp - WHATSAPP_VERIFY_TOKEN (lo escribes tambien en el panel de Meta)" "$verify"; env_set WHATSAPP_VERIFY_TOKEN "$v"

  ask_secret v "Instagram - INSTAGRAM_ACCESS_TOKEN" "$(current INSTAGRAM_ACCESS_TOKEN)"; env_set INSTAGRAM_ACCESS_TOKEN "$v"
  verify=$(current INSTAGRAM_VERIFY_TOKEN)
  [ -n "$verify" ] || verify=$(random_hex 16)
  ask v "Instagram - INSTAGRAM_VERIFY_TOKEN" "$verify"; env_set INSTAGRAM_VERIFY_TOKEN "$v"

  ask v "Mercado Libre - MERCADOLIBRE_CLIENT_ID" "$(current MERCADOLIBRE_CLIENT_ID)"; env_set MERCADOLIBRE_CLIENT_ID "$v"
  ask_secret v "Mercado Libre - MERCADOLIBRE_CLIENT_SECRET" "$(current MERCADOLIBRE_CLIENT_SECRET)"; env_set MERCADOLIBRE_CLIENT_SECRET "$v"
  ask_secret v "Mercado Libre - MERCADOLIBRE_ACCESS_TOKEN" "$(current MERCADOLIBRE_ACCESS_TOKEN)"; env_set MERCADOLIBRE_ACCESS_TOKEN "$v"
  ask_secret v "Mercado Libre - MERCADOLIBRE_REFRESH_TOKEN" "$(current MERCADOLIBRE_REFRESH_TOKEN)"; env_set MERCADOLIBRE_REFRESH_TOKEN "$v"
  ask v "Mercado Libre - MERCADOLIBRE_SELLER_ID" "$(current MERCADOLIBRE_SELLER_ID)"; env_set MERCADOLIBRE_SELLER_ID "$v"
  warn "Los webhooks de Meta y Mercado Libre exigen una URL publica con HTTPS (proxy inverso o tunel)."
}

# ------------------------------------------------------------- carpetas ---

prepare_storage() {
  title "3/5  Carpetas de datos persistentes"
  mkdir -p storage/leads storage/logs
  local uid gid
  uid=$(env_get APP_UID); gid=$(env_get APP_GID)
  if [ "$(id -u)" = "0" ]; then
    chown -R "$uid:$gid" storage 2>/dev/null || warn "No se pudo asignar ./storage al usuario $uid:$gid; el bot podria no poder escribir."
  fi
  ok "storage/leads (cotizaciones y visitas) y storage/logs (registros diarios)"
}

# ---------------------------------------------------------------- docker ---

http_get() {
  if command -v curl >/dev/null 2>&1; then
    curl -sS --max-time 4 "$1" 2>/dev/null
  else
    wget -qO- --timeout=4 "$1" 2>/dev/null
  fi
}

start_stack() {
  title "4/5  Construyendo e iniciando el contenedor"
  $COMPOSE config -q || fail "docker-compose.yml o .env tienen un error (ver arriba)."
  if ! $COMPOSE up -d --build; then
    fail "No se pudo construir o iniciar el contenedor. Revisa el mensaje de arriba."
  fi
}

wait_for_health() {
  title "5/5  Verificando /health"
  local port url waited=0 state body=""
  port=$(env_get HOST_PORT)
  url="http://127.0.0.1:${port}/health"
  info "Esperando respuesta de $url (hasta ${HEALTH_TIMEOUT}s)..."
  while [ "$waited" -lt "$HEALTH_TIMEOUT" ]; do
    state=$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")
    case "$state" in
      exited|dead|restarting|missing)
        warn "El contenedor no esta corriendo (estado: $state)."
        report_failure "$body"
        ;;
    esac
    body=$(http_get "$url" || true)
    if printf '%s' "$body" | grep -q '"status":"ok"'; then
      HEALTH_BODY="$body"
      ok "/health responde OK"
      return 0
    fi
    sleep 2
    waited=$((waited + 2))
  done
  warn "Pasaron ${HEALTH_TIMEOUT}s sin un /health correcto."
  report_failure "$body"
}

report_failure() {
  local body="$1"
  [ -z "$body" ] || printf 'Ultima respuesta de /health: %s\n' "$body" >&2
  printf '\nUltimas lineas del registro del contenedor:\n' >&2
  $COMPOSE logs --tail=40 >&2 2>&1 || true
  fail "El bot no quedo operativo. Corrige lo indicado en el registro y vuelve a ejecutar ./install.sh"
}

summary() {
  local port bind host_shown mode gemini
  port=$(env_get HOST_PORT); bind=$(env_get BIND_ADDRESS)
  host_shown="localhost"
  [ "$bind" = "0.0.0.0" ] && host_shown="<IP-de-este-equipo>"
  mode=$(printf '%s' "$HEALTH_BODY" | grep -o '"mode":"[a-z]*"' | head -n 1 | cut -d'"' -f4 || true)
  gemini=$(printf '%s' "$HEALTH_BODY" | grep -o '"geminiConfigured":[a-z]*' | head -n 1 | cut -d: -f2 || true)

  printf '\n%sListo. El bot esta en marcha.%s\n' "$C_BOLD" "$C_OFF"
  info "  Salud:      http://${host_shown}:${port}/health"
  if [ "$(env_get DEMO_ENABLED)" = "true" ]; then info "  Simulador:  http://${host_shown}:${port}/demo/"; fi
  info "  Datos:      modo ${mode:-desconocido}"
  [ "$gemini" = "true" ] || warn "Gemini NO esta configurado: define GEMINI_API_KEY en .env y ejecuta: $COMPOSE up -d"
  if [ -n "$GENERATED_CHAT_KEY" ]; then
    info ""
    info "  Clave del chat/simulador (guardala; tambien esta en .env):"
    info "    $GENERATED_CHAT_KEY"
  fi
  info ""
  info "Datos persistentes: ./storage/leads y ./storage/logs"
  info "Ver registros:      $COMPOSE logs -f"
  info "Detener:            $COMPOSE down"
  info "Actualizar codigo:  git pull && ./install.sh --yes"
  if [ "$(env_get ODOO_MODE)" = "mock" ]; then
    info ""
    warn "Modo mock: el catalogo es de demostracion (precios y stock de ejemplo)."
  fi
}

# ------------------------------------------------------------------- main ---

HEALTH_BODY=""
printf '%sBot Ecommerce TECS Acarigua - instalador%s\n' "$C_BOLD" "$C_OFF"

preflight
configure
prepare_storage
if [ "$NO_START" = 1 ]; then
  ok "Configuracion lista. Para arrancar: $COMPOSE up -d --build"
  exit 0
fi
if [ "$ASSUME_YES" != 1 ] && ! ask_yn "Construir e iniciar ahora?" S; then
  info "Cuando quieras arrancar: $COMPOSE up -d --build"
  exit 0
fi
start_stack
wait_for_health
summary
