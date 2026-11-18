#!/usr/bin/env node
'use strict';
/**
 * apply-update.js - Bot Ecommerce TECS Acarigua
 * Sesion 2: simulador web de chat para demostracion (/demo), 2026-11-17.
 * Requiere haber aplicado antes el apply-update.js de la sesion 1 (estructura base del backend).
 *
 * Uso (en la RAIZ del proyecto local, Windows o Linux):
 *   node apply-update.js            escribe/actualiza los archivos
 *   node apply-update.js --dry-run  muestra que haria, sin escribir nada
 *
 * Solo usa los modulos nativos fs y path. Crea las carpetas que falten y sobrescribe
 * los archivos listados (usa git para revisar el diff). No toca .env ni otros archivos.
 * Contiene SOLO los archivos creados o modificados en esta sesion.
 */
const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = process.cwd();

// [ruta relativa con "/", contenido]
const FILES = [
  [".env.example", `# ============================================================
# Bot Ecommerce TECS Acarigua - Variables de entorno
# Copia este archivo a .env y ajusta los valores.
# ============================================================

# --- Servidor ---
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
# Si se define, POST /api/chat (simulador/demo) exige el encabezado x-api-key con este valor
CHAT_API_KEY=
# Simulador web de demostracion en http://localhost:PORT/demo (true | false)
DEMO_ENABLED=true

# --- Interruptor de arquitectura dual: mock | live ---
# mock: catalogo local (data/catalog.mock.json), leads en data/leads.mock.json
# live: Odoo Community via XML-RPC (requiere las variables ODOO_* de abajo)
ODOO_MODE=mock

# --- Modo MOCK ---
MOCK_CATALOG_PATH=./data/catalog.mock.json
MOCK_LEADS_PATH=./data/leads.mock.json

# --- Modo LIVE (Odoo Community, XML-RPC) ---
ODOO_URL=http://localhost:8069
ODOO_DB=tecs
ODOO_USERNAME=bot@tecs.local
# Contrasena o API key del usuario de integracion
ODOO_PASSWORD=
ODOO_TIMEOUT_MS=15000
# Campo de product.template donde viven las especificaciones tecnicas
# (lineas "clave: valor"). Por defecto description_sale.
ODOO_SPECS_FIELD=description_sale
# Mapa opcional categoria-bot -> nombre de categoria en Odoo (JSON). Se mezcla con los valores por defecto.
# Claves: cpu, motherboard, ram, storage, gpu, psu, case, laptop, service
# ODOO_CATEGORY_MAP={"cpu":"Procesadores","case":"Cases"}
# Si es true, ademas del crm.lead se crea una cotizacion borrador (sale.order)
ODOO_CREATE_QUOTATION=false

# --- Gemini ---
GEMINI_API_KEY=
# Fija aqui un modelo estable de tu cuenta (ej. un modelo flash vigente). El alias por defecto siempre apunta al ultimo flash.
GEMINI_MODEL=gemini-flash-latest
GEMINI_TEMPERATURE=0.4
GEMINI_MAX_TOOL_ROUNDS=6

# --- Sesiones en memoria ---
SESSION_TTL_MINUTES=120
SESSION_MAX_COUNT=5000
SESSION_MAX_HISTORY_TURNS=14

# --- Datos de la tienda ---
STORE_NAME=TECS
STORE_CITY=Acarigua, Portuguesa
# Direccion y horario: SOLO se comparten en WhatsApp/Instagram (nunca en Mercado Libre)
STORE_ADDRESS=
STORE_HOURS=
BUILD_DELIVERY_ETA=24 a 48 horas habiles tras confirmar el pago

# --- Canal: WhatsApp Cloud API ---
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=

# --- Canal: Instagram DM ---
INSTAGRAM_ACCESS_TOKEN=
INSTAGRAM_VERIFY_TOKEN=

# --- Meta (WhatsApp + Instagram) ---
# Version del Graph API (verifica la vigente en developers.facebook.com)
META_GRAPH_VERSION=v23.0
# Secreto de la app: valida la firma X-Hub-Signature-256. Obligatorio en produccion.
META_APP_SECRET=

# --- Canal: Mercado Libre ---
MERCADOLIBRE_ACCESS_TOKEN=
MERCADOLIBRE_REFRESH_TOKEN=
MERCADOLIBRE_CLIENT_ID=
MERCADOLIBRE_CLIENT_SECRET=
# ID de usuario vendedor: se usa para validar las notificaciones y ignorar preguntas propias
MERCADOLIBRE_SELLER_ID=
`],
  ["public/demo/index.html", `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 32 32%27%3E%3Crect width=%2732%27 height=%2732%27 rx=%277%27 fill=%27%231e6bff%27/%3E%3Ctext x=%2716%27 y=%2723%27 font-size=%2720%27 font-family=%27Arial%27 font-weight=%27700%27 text-anchor=%27middle%27 fill=%27white%27%3ET%3C/text%3E%3C/svg%3E">
<title>TECS Acarigua · Simulador del asistente</title>
<style>
  /* Identidad TECS: ajusta estos colores en un solo lugar. */
  :root {
    --navy: #0b1f3a;
    --navy-2: #14305c;
    --blue: #1e6bff;
    --orange: #ff7a1a;
    --bg: #f2f5fa;
    --card: #ffffff;
    --ink: #0f1b2d;
    --muted: #5a6a82;
    --line: #dfe5ef;
    --ok: #0f9d58;
    --warn: #b86e00;
    --err: #d92d20;
    --radius: 14px;

    /* Se reemplazan segun el canal activo (ver [data-channel] mas abajo). */
    --accent: #25d366;
    --accent-ink: #052e16;
    --chat-bg: #efeae2;
    --user-bg: #d9fdd3;
    --user-ink: #0f1b2d;
    --bot-bg: #ffffff;
    --bot-ink: #0f1b2d;
  }
  .app[data-channel="instagram"] {
    --accent: #e1306c;
    --accent-ink: #ffffff;
    --chat-bg: #ffffff;
    --user-bg: linear-gradient(135deg, #7a3cff, #e1306c);
    --user-ink: #ffffff;
    --bot-bg: #efefef;
  }
  .app[data-channel="mercadolibre"] {
    --accent: #ffe600;
    --accent-ink: #2d3277;
    --chat-bg: #ebebeb;
    --user-bg: #ffe600;
    --user-ink: #2d3277;
    --bot-bg: #ffffff;
  }

  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--bg);
    -webkit-text-size-adjust: 100%;
  }
  button, input, textarea { font: inherit; color: inherit; }
  button { cursor: pointer; }
  :focus-visible { outline: 3px solid var(--blue); outline-offset: 2px; }
  [hidden] { display: none !important; }

  .app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; }

  /* ---------- Barra superior ---------- */
  .topbar {
    background: var(--navy);
    color: #fff;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 16px;
    padding: 10px 16px;
    padding-top: calc(10px + env(safe-area-inset-top));
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(16px + env(safe-area-inset-right));
    border-bottom: 3px solid var(--orange);
  }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .logo {
    background: var(--blue);
    color: #fff;
    font-weight: 800;
    letter-spacing: 1px;
    padding: 6px 10px;
    border-radius: 8px;
    line-height: 1;
  }
  .brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.15; }
  .brand-text strong { font-size: 15px; white-space: nowrap; }
  .brand-text small { font-size: 12px; color: #b9c6dd; white-space: nowrap; }

  .channels { display: flex; gap: 4px; background: var(--navy-2); padding: 4px; border-radius: 999px; margin-left: auto; }
  .channels input { position: absolute; opacity: 0; pointer-events: none; }
  .channels label {
    padding: 7px 14px;
    border-radius: 999px;
    font-size: 14px;
    font-weight: 600;
    color: #cfd9ec;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }
  .channels input:checked + label { background: var(--accent); color: var(--accent-ink); }
  .channels input:focus-visible + label { outline: 3px solid #fff; outline-offset: 1px; }

  .actions { display: flex; gap: 8px; align-items: center; }
  .btn {
    border: 1px solid transparent;
    border-radius: 10px;
    padding: 8px 12px;
    min-height: 40px;
    font-weight: 600;
    font-size: 14px;
    background: #fff;
    color: var(--navy);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn:hover { filter: brightness(0.96); }
  .btn.ghost { background: transparent; color: #fff; border-color: #3b5688; }
  .btn.primary { background: var(--blue); color: #fff; }
  .btn.danger { background: #fff; color: var(--err); border-color: #f1b8b3; }
  .btn svg { width: 18px; height: 18px; flex: none; }
  .btn .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); }
  .btn .dot.off { background: var(--orange); }
  .panel-toggle { display: none; position: relative; }
  .badge {
    background: var(--orange);
    color: #fff;
    border-radius: 999px;
    font-size: 12px;
    padding: 1px 7px;
    font-weight: 700;
  }
  .badge.pulse { animation: pulse 0.9s ease-out; }

  .banner {
    background: #fff4e5;
    color: #7a4a00;
    border-bottom: 1px solid #ffd9a0;
    padding: 8px 16px;
    font-size: 14px;
  }

  /* ---------- Disposicion ---------- */
  .layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 390px; }

  .chat { display: flex; flex-direction: column; min-height: 0; background: var(--chat-bg); position: relative; }
  .channel-note {
    font-size: 13px;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.85);
    border-bottom: 1px solid var(--line);
    padding: 6px 16px;
  }
  .messages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    scroll-behavior: smooth;
  }
  .messages > * { width: 100%; max-width: 820px; margin-left: auto; margin-right: auto; }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.85);
    border: 1px dashed var(--line);
    border-radius: var(--radius);
    padding: 18px;
    max-width: 420px !important;
  }
  .empty strong { color: var(--ink); display: block; margin-bottom: 4px; }

  .system-note {
    align-self: center;
    text-align: center;
    font-size: 12px;
    color: var(--muted);
    background: rgba(255, 255, 255, 0.85);
    border-radius: 999px;
    padding: 3px 12px;
    width: auto !important;
  }

  .row { display: flex; flex-direction: column; }
  .row.user { align-items: flex-end; }
  .row.bot { align-items: flex-start; }
  .bubble {
    max-width: min(86%, 560px);
    padding: 8px 12px;
    border-radius: 16px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    box-shadow: 0 1px 1px rgba(0, 0, 0, 0.08);
  }
  .row.user .bubble { background: var(--user-bg); color: var(--user-ink); border-bottom-right-radius: 4px; }
  .row.bot .bubble { background: var(--bot-bg); color: var(--bot-ink); border-bottom-left-radius: 4px; }
  .bubble.error { background: #fff1f0; color: #7a1a12; border: 1px solid #f1b8b3; }
  .meta { font-size: 11px; color: var(--muted); margin: 2px 6px 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tools { display: none; gap: 4px; flex-wrap: wrap; }
  .show-debug .tools { display: flex; }
  .chip {
    background: #e8eefb;
    color: #23407a;
    border-radius: 6px;
    padding: 1px 6px;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .link-btn { background: none; border: 0; padding: 0; color: var(--blue); font-weight: 700; text-decoration: underline; }

  .typing .bubble { display: inline-flex; gap: 4px; padding: 12px 14px; }
  .typing i { width: 7px; height: 7px; border-radius: 50%; background: #98a4b8; animation: blink 1.2s infinite; }
  .typing i:nth-child(2) { animation-delay: 0.2s; }
  .typing i:nth-child(3) { animation-delay: 0.4s; }

  .composer {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    padding: 10px 12px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
    background: #f7f8fb;
    border-top: 1px solid var(--line);
  }
  .composer textarea {
    flex: 1;
    resize: none;
    max-height: 140px;
    min-height: 44px;
    border: 1px solid var(--line);
    border-radius: 22px;
    padding: 10px 16px;
    background: #fff;
  }
  .send {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 0;
    background: var(--blue);
    color: #fff;
    display: grid;
    place-items: center;
    flex: none;
  }
  .send:disabled { background: #a9b6cf; cursor: not-allowed; }
  .send svg { width: 20px; height: 20px; }

  /* ---------- Panel lateral ---------- */
  .panel {
    background: var(--card);
    border-left: 1px solid var(--line);
    overflow-y: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .panel-head { display: none; align-items: center; justify-content: space-between; padding: 10px 14px; border-bottom: 1px solid var(--line); }
  .section { padding: 14px 16px; border-bottom: 1px solid var(--line); }
  .section h2, .collapsible summary { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: var(--muted); margin: 0 0 10px; font-weight: 700; }
  .collapsible summary { cursor: pointer; margin-bottom: 0; }
  .collapsible[open] summary { margin-bottom: 10px; }
  .group-title { font-size: 12px; font-weight: 700; color: var(--navy-2); margin: 10px 0 6px; }
  .group-title:first-of-type { margin-top: 0; }
  .quick { display: flex; flex-wrap: wrap; gap: 6px; }
  .quick button {
    border: 1px solid #c9d6ef;
    background: #f4f8ff;
    color: var(--navy-2);
    border-radius: 999px;
    padding: 7px 12px;
    font-size: 13.5px;
    text-align: left;
  }
  .quick button:hover:not(:disabled) { background: #e5eeff; }
  .quick button:disabled { opacity: 0.5; cursor: not-allowed; }

  .build-empty { color: var(--muted); font-size: 14px; background: #f6f8fc; border-radius: 10px; padding: 12px; }
  .build-top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 10px; }
  .pill { background: #e8eefb; color: #23407a; border-radius: 999px; padding: 2px 10px; font-size: 13px; font-weight: 700; }
  .pill.orange { background: #ffe9d6; color: #8a3f00; }
  .bar { height: 10px; background: #e6ebf4; border-radius: 999px; overflow: hidden; margin: 6px 0 2px; }
  .bar > span { display: block; height: 100%; background: var(--blue); border-radius: 999px; transition: width 0.4s; }
  .bar.over > span { background: var(--err); }
  .bar-label { font-size: 12.5px; color: var(--muted); display: flex; justify-content: space-between; }

  .steps { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 6px; }
  .step { display: grid; grid-template-columns: 26px 1fr auto; gap: 8px; align-items: start; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; }
  .step .ico { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 800; background: #e6ebf4; color: var(--muted); }
  .step.done { border-color: #b9e5cb; background: #f3fbf6; }
  .step.done .ico { background: var(--ok); color: #fff; }
  .step.next { border-color: var(--blue); background: #f2f7ff; }
  .step.next .ico { background: var(--blue); color: #fff; }
  .step.skipped { opacity: 0.7; }
  .step .cat { font-size: 12px; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
  .step .name { font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
  .step .hint { font-size: 13px; color: var(--muted); }
  .step .sku { display: none; font-size: 11px; color: var(--muted); font-family: ui-monospace, Menlo, Consolas, monospace; }
  .show-debug .step .sku { display: block; }
  .step .price { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .flash { animation: flash 1.6s ease-out; }

  .issues { list-style: none; padding: 0; margin: 10px 0 0; display: grid; gap: 6px; }
  .issue { font-size: 13px; border-radius: 8px; padding: 6px 10px; }
  .issue.error { background: #fff1f0; color: #7a1a12; border: 1px solid #f1b8b3; }
  .issue.warning { background: #fff8e6; color: #6b4300; border: 1px solid #ffe0a3; }

  .totals { margin-top: 12px; border-top: 2px solid var(--navy); padding-top: 10px; display: grid; gap: 4px; font-size: 14px; }
  .totals .line { display: flex; justify-content: space-between; gap: 8px; }
  .totals .line span:last-child { font-variant-numeric: tabular-nums; font-weight: 600; }
  .totals .total { font-size: 18px; font-weight: 800; border-top: 1px dashed var(--line); padding-top: 6px; margin-top: 4px; }
  .totals .total span:last-child { font-weight: 800; }
  .totals .note { font-size: 12.5px; color: var(--muted); }
  .totals .over { color: var(--err); }
  .totals .under { color: var(--ok); }

  details.json { margin-top: 12px; }
  details.json summary { cursor: pointer; font-size: 13px; font-weight: 700; color: var(--navy-2); }
  details.json pre {
    background: #0b1f3a;
    color: #cfe0ff;
    border-radius: 10px;
    padding: 10px;
    font-size: 11.5px;
    max-height: 260px;
    overflow: auto;
    margin: 8px 0 0;
  }

  .toggle { display: flex; gap: 8px; align-items: center; font-size: 14px; }
  .toggle input { width: 18px; height: 18px; }
  .mode-pill { margin-top: 8px; font-size: 12.5px; color: var(--muted); }

  .backdrop { display: none; }

  /* ---------- Modal de API key ---------- */
  dialog {
    border: 0;
    border-radius: 16px;
    padding: 0;
    width: min(92vw, 420px);
    box-shadow: 0 20px 60px rgba(11, 31, 58, 0.35);
    color: var(--ink);
  }
  dialog::backdrop { background: rgba(11, 31, 58, 0.55); }
  dialog form { padding: 20px; display: grid; gap: 12px; }
  dialog h3 { margin: 0; font-size: 18px; }
  dialog p { margin: 0; color: var(--muted); font-size: 14px; }
  dialog input[type="password"], dialog input[type="text"] {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 10px 12px;
  }
  .dialog-error { color: var(--err); font-size: 13.5px; min-height: 1.2em; }
  .dialog-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .dialog-actions .btn { border-color: var(--line); }
  .dialog-actions .btn.primary { border-color: transparent; }

  /* ---------- Animaciones ---------- */
  @keyframes blink { 0%, 80%, 100% { opacity: 0.25; } 40% { opacity: 1; } }
  @keyframes flash { 0% { background: #fff1c2; } 100% { background: transparent; } }
  @keyframes pulse { 0% { transform: scale(1.5); } 100% { transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
  }

  /* ---------- Movil / tablet ---------- */
  @media (max-width: 959px) {
    .layout { display: block; position: relative; }
    .chat { height: 100%; }
    .channels { margin-left: 0; order: 3; width: 100%; justify-content: space-between; overflow-x: auto; }
    .channels label { flex: 1; text-align: center; padding: 8px 10px; }
    .brand { flex: 1 1 0; }
    .brand-text strong { overflow: hidden; text-overflow: ellipsis; }
    .actions { margin-left: auto; }
    .panel-toggle { display: inline-flex; }
    .btn .label { display: none; }
    .panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: min(92vw, 410px);
      z-index: 30;
      transform: translateX(100%);
      visibility: hidden;
      transition: transform 0.25s ease, visibility 0s linear 0.25s;
      box-shadow: -10px 0 30px rgba(11, 31, 58, 0.25);
      padding-top: env(safe-area-inset-top);
      padding-bottom: env(safe-area-inset-bottom);
    }
    .panel.open { transform: none; visibility: visible; transition-delay: 0s; }
    .panel-head { display: flex; }
    .backdrop.open { display: block; position: fixed; inset: 0; background: rgba(11, 31, 58, 0.45); z-index: 20; }
    .bubble { max-width: 90%; }
  }
  @media (max-width: 420px) {
    .brand-text small { display: none; }
    .messages { padding: 12px 10px; }
  }
</style>
</head>
<body>
<div class="app" id="app" data-channel="whatsapp">
  <header class="topbar">
    <div class="brand">
      <span class="logo" aria-hidden="true">TECS</span>
      <div class="brand-text">
        <strong>Asistente TECS Acarigua</strong>
        <small>Simulador de demostración</small>
      </div>
    </div>

    <div class="channels" role="radiogroup" aria-label="Canal de atención">
      <input type="radio" name="channel" id="ch-whatsapp" value="whatsapp" checked>
      <label for="ch-whatsapp">WhatsApp</label>
      <input type="radio" name="channel" id="ch-instagram" value="instagram">
      <label for="ch-instagram">Instagram</label>
      <input type="radio" name="channel" id="ch-mercadolibre" value="mercadolibre">
      <label for="ch-mercadolibre">Mercado Libre</label>
    </div>

    <div class="actions">
      <button type="button" class="btn ghost" id="keyBtn" hidden aria-label="Clave de acceso (API key)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        <span class="label">Clave</span><span class="dot off" id="keyDot"></span>
      </button>
      <button type="button" class="btn" id="newBtn" aria-label="Nueva conversación">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>
        <span class="label">Nueva conversación</span>
      </button>
      <button type="button" class="btn ghost panel-toggle" id="panelBtn" aria-controls="panel" aria-expanded="false" aria-label="Abrir panel de pruebas y armado">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/></svg>
        <span class="badge" id="panelBadge" hidden>0/7</span>
      </button>
    </div>
  </header>

  <div class="banner" id="banner" role="status" hidden></div>

  <div class="layout">
    <section class="chat" aria-label="Conversación">
      <div class="channel-note" id="channelNote"></div>
      <div class="messages" id="messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <form class="composer" id="composer" autocomplete="off">
        <textarea id="input" rows="1" maxlength="1500" placeholder="Escribe como lo haría un cliente…" aria-label="Mensaje"></textarea>
        <button type="submit" class="send" id="sendBtn" aria-label="Enviar">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.4 20.4 21 12 3.4 3.6 3.3 10l12 2-12 2z"/></svg>
        </button>
      </form>
    </section>

    <aside class="panel" id="panel" aria-label="Pruebas rápidas y armado de PC">
      <div class="panel-head">
        <strong>Panel de demostración</strong>
        <button type="button" class="btn" id="panelClose">Cerrar</button>
      </div>

      <details class="section collapsible" open>
        <summary>Pruebas rápidas</summary>
        <div id="quick"></div>
      </details>

      <div class="section">
        <h2>Armado de PC en vivo</h2>
        <div id="build"></div>
      </div>

      <div class="section">
        <label class="toggle"><input type="checkbox" id="debugToggle"> Ver detalle técnico (herramientas, SKU, JSON)</label>
        <div class="mode-pill" id="modePill"></div>
      </div>
    </aside>
  </div>
  <div class="backdrop" id="backdrop"></div>
</div>

<dialog id="keyDialog" aria-labelledby="keyTitle">
  <form id="keyForm" novalidate>
    <h3 id="keyTitle">Clave de acceso</h3>
    <p>El servidor tiene activa una API key (<code>CHAT_API_KEY</code>). Se guarda solo en este navegador y se envía en el encabezado <code>x-api-key</code>.</p>
    <input type="password" id="keyInput" autocomplete="off" spellcheck="false" aria-label="API key" placeholder="Pega la clave aquí">
    <div class="dialog-error" id="keyError" role="alert"></div>
    <div class="dialog-actions">
      <button type="button" class="btn danger" id="keyClear">Quitar clave</button>
      <button type="button" class="btn" id="keyCancel">Cancelar</button>
      <button type="submit" class="btn primary">Guardar</button>
    </div>
  </form>
</dialog>

<script>
(function () {
  'use strict';

  /* ================= Constantes ================= */
  var CHANNELS = {
    whatsapp: { label: 'WhatsApp', note: 'Canal WhatsApp: conversación directa con el cliente.' },
    instagram: { label: 'Instagram', note: 'Canal Instagram DM: mensajes directos del perfil de la tienda.' },
    mercadolibre: {
      label: 'Mercado Libre',
      note: 'Pregunta pública de Mercado Libre: el sistema elimina teléfonos, correos, enlaces y direcciones de la respuesta, y no registra visitas por este canal.'
    }
  };
  var STEPS = [
    ['cpu', 'Procesador'], ['motherboard', 'Placa madre'], ['ram', 'Memoria RAM'],
    ['storage', 'Almacenamiento'], ['gpu', 'Tarjeta de video'], ['psu', 'Fuente de poder'], ['case', 'Case']
  ];
  var PURPOSES = { gaming: 'Gaming', creation: 'Creación', office: 'Oficina' };
  var QUICK = [
    { title: 'Armado de PC', items: [
      'Quiero armar una PC gamer de $800',
      'Necesito una PC de oficina de $400',
      'Quiero una PC para editar video, tengo $1200',
      'Muéstrame cómo va mi armado'
    ] },
    { title: 'Consultas de productos', items: [
      '¿Qué cases tienen?',
      'Busco una laptop',
      '¿Tienen Ryzen 5 5600G?',
      '¿Tienen Ryzen 7 5700X?'
    ] },
    { title: 'Visita y seguridad de canal', items: [
      'Quiero ir a la tienda, ¿dónde queda y a qué hora abren?',
      '¿Me pasas tu teléfono para hablar por WhatsApp?'
    ] }
  ];
  var KEY_STORAGE = 'tecs-demo-api-key';
  var REQUEST_TIMEOUT_MS = 120000;

  /* ================= Utilidades ================= */
  function $(id) { return document.getElementById(id); }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else el.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return el;
  }

  function store(action, key, value) {
    try {
      if (action === 'get') return window.localStorage.getItem(key);
      if (action === 'set') window.localStorage.setItem(key, value);
      if (action === 'del') window.localStorage.removeItem(key);
    } catch (e) { /* almacenamiento bloqueado: se trabaja solo en memoria */ }
    return null;
  }

  function randomId() {
    var bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    var hex = '';
    for (var j = 0; j < bytes.length; j++) hex += ('0' + bytes[j].toString(16)).slice(-2);
    return 'demo-' + hex;
  }

  function usd(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '—';
    return '$' + (Math.round(n) === n ? String(n) : n.toFixed(2));
  }

  function clock() {
    try { return new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================= Estado ================= */
  var state = {
    channel: 'whatsapp',
    sessionId: randomId(),
    busy: false,
    apiKey: store('get', KEY_STORAGE) || '',
    config: null,
    build: null,
    prevSkus: {},
    prevTotal: null,
    pendingRetry: null
  };

  var els = {
    app: $('app'), messages: $('messages'), input: $('input'), composer: $('composer'), sendBtn: $('sendBtn'),
    banner: $('banner'), channelNote: $('channelNote'), quick: $('quick'), build: $('build'),
    panel: $('panel'), panelBtn: $('panelBtn'), panelClose: $('panelClose'), backdrop: $('backdrop'), panelBadge: $('panelBadge'),
    keyBtn: $('keyBtn'), keyDot: $('keyDot'), keyDialog: $('keyDialog'), keyForm: $('keyForm'), keyInput: $('keyInput'),
    keyError: $('keyError'), keyClear: $('keyClear'), keyCancel: $('keyCancel'),
    newBtn: $('newBtn'), debugToggle: $('debugToggle'), modePill: $('modePill')
  };

  /* ================= API ================= */
  function apiUrl(path) { return new URL('../api/chat' + path, window.location.href).pathname; }

  function ApiError(code, message, status, details) {
    this.code = code; this.message = message; this.status = status; this.details = details;
  }

  function request(method, path, body) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.apiKey) headers['x-api-key'] = state.apiKey;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS);
    return fetch(apiUrl(path), {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store'
    }).then(function (res) {
      return res.text().then(function (text) {
        var json = null;
        try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
        if (res.ok && json && json.success === true) return json.data;
        var err = json && json.error ? json.error : {};
        throw new ApiError(err.code || 'HTTP_' + res.status, err.message || 'Respuesta inesperada del servidor (HTTP ' + res.status + ')', res.status, err.details || null);
      });
    }).catch(function (e) {
      if (e instanceof ApiError) throw e;
      if (e && e.name === 'AbortError') throw new ApiError('TIMEOUT', 'El servidor tardó demasiado en responder.', 0, null);
      throw new ApiError('NETWORK_ERROR', 'No hay conexión con el servidor.', 0, null);
    }).then(function (data) { clearTimeout(timer); return data; }, function (e) { clearTimeout(timer); throw e; });
  }

  /* ================= Mensajes ================= */
  function scrollDown() {
    var box = els.messages;
    if (reduceMotion) box.scrollTop = box.scrollHeight;
    else box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
  }

  // Formato minimo: **negrita** / *negrita* y vinetas. Todo se inserta como nodos de texto (nunca como HTML).
  function richText(target, text) {
    var clean = String(text).replace(/^[ \\t]*[-*][ \\t]+/gm, '• ');
    var pattern = /\\*\\*[^\\s*](?:[^*\\n]*[^\\s*])?\\*\\*|\\*[^\\s*](?:[^*\\n]*[^\\s*])?\\*/g;
    var last = 0, m;
    while ((m = pattern.exec(clean)) !== null) {
      if (m.index > last) target.appendChild(document.createTextNode(clean.slice(last, m.index)));
      var inner = m[0].charAt(1) === '*' ? m[0].slice(2, -2) : m[0].slice(1, -1);
      target.appendChild(h('strong', { text: inner }));
      last = m.index + m[0].length;
    }
    if (last < clean.length) target.appendChild(document.createTextNode(clean.slice(last)));
  }

  function removeEmpty() {
    var empty = els.messages.querySelector('.empty');
    if (empty) empty.remove();
  }

  function showEmpty() {
    els.messages.textContent = '';
    els.messages.appendChild(h('div', { class: 'empty' },
      h('strong', { text: 'Conversación nueva' }),
      'Escribe un mensaje o usa una prueba rápida del panel. Cada conversación usa una sesión distinta en memoria.'
    ));
  }

  function addSystem(text) {
    removeEmpty();
    els.messages.appendChild(h('div', { class: 'system-note', text: text }));
    scrollDown();
  }

  function addUser(text) {
    removeEmpty();
    var bubble = h('div', { class: 'bubble' });
    bubble.textContent = text;
    els.messages.appendChild(h('div', { class: 'row user' }, bubble, h('div', { class: 'meta', text: clock() })));
    scrollDown();
  }

  function addBot(text, toolsUsed) {
    removeEmpty();
    var bubble = h('div', { class: 'bubble' });
    richText(bubble, text);
    var tools = h('span', { class: 'tools' });
    (toolsUsed || []).forEach(function (t) { tools.appendChild(h('span', { class: 'chip', text: t })); });
    els.messages.appendChild(h('div', { class: 'row bot' }, bubble, h('div', { class: 'meta' }, clock(), tools)));
    scrollDown();
  }

  function addTyping() {
    var row = h('div', { class: 'row bot typing', 'aria-label': 'El asistente está escribiendo' },
      h('div', { class: 'bubble' }, h('i'), h('i'), h('i')));
    els.messages.appendChild(row);
    scrollDown();
    return row;
  }

  function addError(err, retryText) {
    var title = 'No se pudo obtener respuesta';
    var text = err.message;
    if (err.code === 'LLM_NOT_CONFIGURED') text = 'El servidor no tiene configurada la clave de Gemini (GEMINI_API_KEY).';
    if (err.code === 'UNAUTHORIZED') text = 'La clave de acceso es inválida o falta.';
    var bubble = h('div', { class: 'bubble error' },
      h('strong', { text: title + ' (' + err.code + ')' }), '\\n' + text);
    var meta = h('div', { class: 'meta' });
    if (retryText && err.code !== 'LLM_NOT_CONFIGURED') {
      var retry = h('button', { type: 'button', class: 'link-btn', text: 'Reintentar' });
      retry.addEventListener('click', function () { row.remove(); send(retryText, true); });
      meta.appendChild(retry);
    }
    var row = h('div', { class: 'row bot' }, bubble, meta);
    els.messages.appendChild(row);
    scrollDown();
  }

  /* ================= Envio ================= */
  function setBusy(busy) {
    state.busy = busy;
    els.sendBtn.disabled = busy;
    els.input.disabled = busy;
    Array.prototype.forEach.call(els.quick.querySelectorAll('button'), function (b) { b.disabled = busy; });
    if (!busy && !els.keyDialog.open) els.input.focus({ preventScroll: true });
  }

  function send(text, isRetry) {
    text = String(text || '').trim();
    if (!text || state.busy) return;
    if (state.config && state.config.requiresApiKey && !state.apiKey) {
      state.pendingRetry = { text: text, isRetry: isRetry === true };
      openKeyDialog('Ingresa la clave para poder enviar mensajes.');
      return;
    }
    if (!isRetry) addUser(text);
    setBusy(true);
    var typing = addTyping();
    var channel = state.channel;
    var sessionId = state.sessionId;

    request('POST', '', { message: text, channel: channel, sessionId: sessionId })
      .then(function (data) {
        if (sessionId !== state.sessionId) return; // la conversacion se reinicio mientras esperaba
        typing.remove();
        addBot(data.reply, data.debug && data.debug.toolsUsed);
        renderBuild(data.build || null);
      })
      .catch(function (err) {
        if (sessionId !== state.sessionId) return;
        typing.remove();
        if (err.code === 'UNAUTHORIZED') {
          state.pendingRetry = { text: text, isRetry: true };
          addSystem('El mensaje no se envi\\u00f3: falta una clave de acceso v\\u00e1lida.');
          openKeyDialog(state.apiKey ? 'La clave guardada no es válida. Ingresa la correcta.' : 'El servidor exige una clave de acceso.');
          return;
        }
        addError(err, text);
      })
      .then(function () {
        if (sessionId === state.sessionId) setBusy(false);
      });
  }

  /* ================= Conversaciones ================= */
  /** Abre una conversacion nueva (sesion distinta) y libera la anterior en el servidor. */
  function startConversation(reason, previous) {
    var old = previous || { channel: state.channel, sessionId: state.sessionId };
    var hadActivity = els.messages.querySelector('.row') !== null || state.build !== null;
    if (hadActivity && (!state.config || !state.config.requiresApiKey || state.apiKey)) {
      // Si falla no importa: la sesion expira sola por TTL en el servidor.
      request('POST', '/reset', { channel: old.channel, sessionId: old.sessionId }).catch(function () {});
    }
    state.sessionId = randomId();
    state.pendingRetry = null;
    state.prevSkus = {};
    state.prevTotal = null;
    showEmpty();
    addSystem(reason + ' \\u00b7 ' + CHANNELS[state.channel].label + ' \\u00b7 sesi\\u00f3n ' + state.sessionId);
    renderBuild(null);
    setBusy(false);
    els.input.value = '';
    autoGrow();
  }

  function setChannel(channel) {
    state.channel = channel;
    els.app.setAttribute('data-channel', channel);
    els.channelNote.textContent = CHANNELS[channel].note;
  }

  /* ================= Visor del armado ================= */
  function renderBuild(view) {
    state.build = view;
    var box = els.build;
    box.textContent = '';

    if (!view) {
      box.appendChild(h('div', { class: 'build-empty', text: 'Aún no hay un armado en curso. Prueba con “Quiero armar una PC gamer de $800” y mira cómo la IA va completando los componentes.' }));
      els.panelBadge.hidden = true;
      state.prevSkus = {};
      state.prevTotal = null;
      return;
    }

    var selected = {};
    (view.selected || []).forEach(function (s) { selected[s.category] = s; });
    var totalSteps = STEPS.length - (view.gpuSkipped ? 1 : 0);
    var doneSteps = (view.selected || []).length;

    els.panelBadge.hidden = false;
    els.panelBadge.textContent = doneSteps + '/' + totalSteps;
    els.panelBadge.classList.remove('pulse');
    void els.panelBadge.offsetWidth;
    els.panelBadge.classList.add('pulse');

    var top = h('div', { class: 'build-top' },
      view.purpose ? h('span', { class: 'pill', text: PURPOSES[view.purpose] || view.purpose }) : null,
      view.budgetUsd !== null && view.budgetUsd !== undefined ? h('span', { class: 'pill orange', text: 'Presupuesto ' + usd(view.budgetUsd) }) : null,
      h('span', { class: 'pill', text: doneSteps + ' de ' + totalSteps + ' componentes' })
    );
    box.appendChild(top);

    if (view.budgetUsd) {
      var ratio = Math.min(100, Math.round((view.spentUsd / view.budgetUsd) * 100));
      var over = view.spentUsd > view.budgetUsd;
      box.appendChild(h('div', { class: 'bar' + (over ? ' over' : ''), role: 'img', 'aria-label': 'Gastado ' + usd(view.spentUsd) + ' de ' + usd(view.budgetUsd) },
        h('span', { style: 'width:' + ratio + '%' })));
      box.appendChild(h('div', { class: 'bar-label' }, h('span', { text: 'Componentes: ' + usd(view.spentUsd) }), h('span', { text: ratio + '%' })));
    }

    var list = h('ol', { class: 'steps' });
    STEPS.forEach(function (step, index) {
      var key = step[0];
      var sel = selected[key];
      var skipped = key === 'gpu' && view.gpuSkipped && !sel;
      var isNext = !sel && !skipped && view.nextStep === key;
      var cls = 'step' + (sel ? ' done' : '') + (isNext ? ' next' : '') + (skipped ? ' skipped' : '');
      var changed = sel && state.prevSkus[key] !== sel.sku;
      if (changed) cls += ' flash';

      var ico = h('span', { class: 'ico', 'aria-hidden': 'true', text: sel ? '✓' : skipped ? '–' : String(index + 1) });
      var info = h('div', null, h('div', { class: 'cat', text: step[1] }));
      if (sel) {
        info.appendChild(h('div', { class: 'name', text: sel.name }));
        info.appendChild(h('div', { class: 'sku', text: sel.sku }));
      } else if (skipped) {
        info.appendChild(h('div', { class: 'hint', text: 'Omitida: el procesador trae video integrado' }));
      } else if (isNext) {
        info.appendChild(h('div', { class: 'hint', text: 'Siguiente paso' }));
      } else {
        info.appendChild(h('div', { class: 'hint', text: 'Pendiente' }));
      }
      list.appendChild(h('li', { class: cls }, ico, info, h('span', { class: 'price', text: sel ? usd(sel.priceUsd) : '' })));
    });
    box.appendChild(list);

    if (view.issues && view.issues.length) {
      var issues = h('ul', { class: 'issues' });
      view.issues.forEach(function (i) {
        issues.appendChild(h('li', { class: 'issue ' + (i.severity === 'error' ? 'error' : 'warning'), text: (i.severity === 'error' ? 'Incompatible: ' : 'Aviso: ') + i.message }));
      });
      box.appendChild(issues);
    }

    var totals = h('div', { class: 'totals' });
    totals.appendChild(h('div', { class: 'line' }, h('span', { text: 'Subtotal componentes' }), h('span', { text: usd(view.subtotalUsd) })));
    if (view.complete) {
      (view.services || []).forEach(function (s) {
        totals.appendChild(h('div', { class: 'line' }, h('span', { text: s.name }), h('span', { text: usd(s.priceUsd) })));
      });
      var totalLine = h('div', { class: 'line total' + (state.prevTotal !== null && state.prevTotal !== view.totalUsd ? ' flash' : '') },
        h('span', { text: 'Total con ensamblaje' }), h('span', { text: usd(view.totalUsd) }));
      totals.appendChild(totalLine);
      if (view.budgetDeltaUsd !== null && view.budgetDeltaUsd !== undefined) {
        var delta = view.budgetDeltaUsd;
        totals.appendChild(h('div', { class: 'note ' + (delta > 0 ? 'over' : 'under'), text:
          delta > 0 ? 'Excede el presupuesto en ' + usd(delta) : delta < 0 ? 'Dentro del presupuesto (sobran ' + usd(-delta) + ')' : 'Justo en el presupuesto' }));
      }
      totals.appendChild(h('div', { class: 'note', text: 'Entrega estimada: ' + view.deliveryEta }));
    } else {
      totals.appendChild(h('div', { class: 'note', text: 'El costo de ensamblaje y configuración se suma al completar todos los componentes.' }));
    }
    box.appendChild(totals);

    var json = h('details', { class: 'json' }, h('summary', { text: 'Ver estado en JSON' }));
    var pre = h('pre');
    pre.textContent = JSON.stringify(view, null, 2);
    json.appendChild(pre);
    box.appendChild(json);

    state.prevSkus = {};
    (view.selected || []).forEach(function (s) { state.prevSkus[s.category] = s.sku; });
    state.prevTotal = view.complete ? view.totalUsd : null;
  }

  /* ================= Panel y pruebas rapidas ================= */
  function buildQuick() {
    QUICK.forEach(function (group) {
      els.quick.appendChild(h('div', { class: 'group-title', text: group.title }));
      var wrap = h('div', { class: 'quick' });
      group.items.forEach(function (text) {
        var btn = h('button', { type: 'button', text: text });
        btn.addEventListener('click', function () {
          closePanel();
          send(text);
        });
        wrap.appendChild(btn);
      });
      els.quick.appendChild(wrap);
    });
  }

  function openPanel() {
    els.panel.classList.add('open');
    els.backdrop.classList.add('open');
    els.panelBtn.setAttribute('aria-expanded', 'true');
  }
  function closePanel() {
    els.panel.classList.remove('open');
    els.backdrop.classList.remove('open');
    els.panelBtn.setAttribute('aria-expanded', 'false');
  }

  /* ================= Modal de API key ================= */
  function refreshKeyUi() {
    var needed = !state.config || state.config.requiresApiKey;
    els.keyBtn.hidden = !needed;
    els.keyDot.classList.toggle('off', !state.apiKey);
  }

  function openKeyDialog(message) {
    els.keyError.textContent = message || '';
    els.keyInput.value = state.apiKey;
    if (!els.keyDialog.open) {
      if (typeof els.keyDialog.showModal === 'function') els.keyDialog.showModal();
      else els.keyDialog.setAttribute('open', '');
    }
    els.keyInput.focus();
  }

  function closeKeyDialog() {
    if (typeof els.keyDialog.close === 'function') els.keyDialog.close();
    else els.keyDialog.removeAttribute('open');
  }

  function saveKey(e) {
    e.preventDefault();
    var value = els.keyInput.value.trim();
    if (!value) { els.keyError.textContent = 'Escribe la clave o usa “Quitar clave”.'; return; }
    state.apiKey = value;
    store('set', KEY_STORAGE, value);
    refreshKeyUi();
    closeKeyDialog();
    var pending = state.pendingRetry;
    state.pendingRetry = null;
    if (pending) send(pending.text, pending.isRetry);
  }

  function clearKey() {
    state.apiKey = '';
    store('del', KEY_STORAGE);
    els.keyInput.value = '';
    els.keyError.textContent = 'Clave eliminada de este navegador.';
    refreshKeyUi();
  }

  /* ================= Configuracion del servidor ================= */
  function loadConfig() {
    return request('GET', '/config').then(function (cfg) {
      state.config = cfg;
      refreshKeyUi();
      var notes = [];
      if (cfg.geminiConfigured === false) notes.push('El servidor no tiene GEMINI_API_KEY: el chat responderá con error hasta configurarla.');
      els.banner.hidden = notes.length === 0;
      els.banner.textContent = notes.join(' ');
      els.modePill.textContent = 'Datos: ' + (cfg.mode === 'live' ? 'Odoo (modo live)' : 'catálogo local de demostración (modo mock)') + ' · ' + cfg.storeName;
      if (cfg.requiresApiKey && !state.apiKey) openKeyDialog('El servidor exige una clave de acceso para usar el chat.');
    }).catch(function () {
      state.config = null;
      refreshKeyUi();
      els.banner.hidden = false;
      els.banner.textContent = 'No se pudo leer la configuración del servidor. Verifica que esté en marcha.';
    });
  }

  /* ================= Entrada de texto ================= */
  function autoGrow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
  }

  /* ================= Eventos ================= */
  els.composer.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = els.input.value;
    if (!text.trim()) return;
    els.input.value = '';
    autoGrow();
    send(text);
  });
  els.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      els.composer.requestSubmit();
    }
  });
  els.input.addEventListener('input', autoGrow);

  Array.prototype.forEach.call(document.querySelectorAll('input[name="channel"]'), function (radio) {
    radio.addEventListener('change', function () {
      if (!radio.checked || radio.value === state.channel) return;
      // La sesion del servidor es por canal: se abre una conversacion nueva para no mezclar historiales.
      var previous = { channel: state.channel, sessionId: state.sessionId };
      setChannel(radio.value);
      startConversation('Canal cambiado', previous);
    });
  });

  els.newBtn.addEventListener('click', function () { startConversation('Nueva conversaci\\u00f3n'); });
  els.panelBtn.addEventListener('click', function () {
    if (els.panel.classList.contains('open')) closePanel(); else openPanel();
  });
  els.panelClose.addEventListener('click', closePanel);
  els.backdrop.addEventListener('click', closePanel);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

  els.keyBtn.addEventListener('click', function () { openKeyDialog(''); });
  els.keyForm.addEventListener('submit', saveKey);
  els.keyClear.addEventListener('click', clearKey);
  els.keyCancel.addEventListener('click', function () { state.pendingRetry = null; closeKeyDialog(); });

  els.debugToggle.addEventListener('change', function () {
    els.app.classList.toggle('show-debug', els.debugToggle.checked);
  });

  /* ================= Inicio ================= */
  buildQuick();
  setChannel('whatsapp');
  showEmpty();
  addSystem('Sesi\\u00f3n ' + state.sessionId + ' \\u00b7 ' + CHANNELS.whatsapp.label);
  renderBuild(null);
  refreshKeyUi();
  loadConfig();
})();
</script>
</body>
</html>
`],
  ["src/app.ts", `import path from 'node:path';
import type { Express } from 'express';
import express from 'express';
import type { Container } from './container';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { createChatRouter } from './routes/chat.routes';
import { createHealthRouter } from './routes/health.routes';
import type { RawBodyRequest } from './routes/webhooks.routes';
import { createWebhookRouter } from './routes/webhooks.routes';

export interface AppOptions {
  /** Carpeta con los archivos estaticos (public/demo/...). Por defecto: <raiz del proyecto>/public. */
  publicDir?: string;
}

/** Cabeceras del simulador: la pagina es autocontenida, asi que se prohibe cargar o conectar con terceros. */
const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export function createApp(container: Container, options: AppOptions = {}): Express {
  const { config, log } = container;
  const app = express();
  app.disable('x-powered-by');

  // Se conserva el cuerpo crudo: la firma de Meta se calcula sobre los bytes originales.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buffer) => {
        (req as RawBodyRequest).rawBody = buffer;
      },
    }),
  );

  if (config.demoEnabled) {
    // __dirname es src/ (tsx) o dist/ (compilado): en ambos casos public/ queda un nivel arriba.
    const publicDir = options.publicDir ?? path.resolve(__dirname, '..', 'public');
    app.use(
      '/demo',
      express.static(path.join(publicDir, 'demo'), {
        index: 'index.html',
        maxAge: 0,
        setHeaders: (res) => {
          res.setHeader('Content-Security-Policy', DEMO_CSP);
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Referrer-Policy', 'no-referrer');
          res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
  }

  app.use(
    createHealthRouter({
      repository: container.repository,
      gemini: container.gemini,
      sessions: container.sessions,
    }),
  );
  app.use(
    createChatRouter({
      conversation: container.conversation,
      apiKey: config.chatApiKey,
      exposeDebug: config.nodeEnv !== 'production',
      info: {
        storeName: config.store.name,
        mode: config.odooMode,
        geminiConfigured: container.gemini.configured,
      },
    }),
  );
  app.use(
    createWebhookRouter({
      dispatcher: container.dispatcher,
      adapters: container.adapters,
      metaAppSecret: config.channels.metaAppSecret,
      production: config.nodeEnv === 'production',
      log: log.child({ component: 'webhooks' }),
    }),
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(log));
  return app;
}
`],
  ["src/config/env.ts", `import fs from 'node:fs';
import type { OdooMode, ProductCategory } from '../types/domain';
import { PRODUCT_CATEGORIES } from '../types/domain';
import type { LogLevel } from '../utils/logger';
import { AppError } from '../utils/errors';

export type OdooCategoryKey = ProductCategory | 'service';

export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
  timeoutMs: number;
  /** Categoria del bot -> nombre de categoria en Odoo (se busca con child_of). */
  categoryMap: Record<OdooCategoryKey, string>;
  /** Campo de product.template con las especificaciones ("clave: valor" por linea). */
  specsField: string;
  createQuotation: boolean;
}

export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;
  logLevel: LogLevel;
  /** Si se define, POST /api/chat exige el encabezado x-api-key con este valor. */
  chatApiKey: string | null;
  /** Sirve el simulador web en /demo (carpeta public/demo). */
  demoEnabled: boolean;
  odooMode: OdooMode;
  mock: { catalogPath: string; leadsPath: string };
  /** Solo presente cuando ODOO_MODE=live. */
  odoo: OdooConfig | null;
  gemini: { apiKey: string | null; model: string; temperature: number; maxToolRounds: number };
  session: { ttlMinutes: number; maxSessions: number; maxHistoryTurns: number };
  store: { name: string; city: string; address: string; hours: string; deliveryEta: string };
  channels: {
    graphVersion: string;
    metaAppSecret: string | null;
    whatsapp: { phoneNumberId: string; accessToken: string; verifyToken: string };
    instagram: { accessToken: string; verifyToken: string };
    mercadolibre: {
      accessToken: string;
      refreshToken: string;
      clientId: string;
      clientSecret: string;
      sellerId: string;
    };
  };
}

export const DEFAULT_CATEGORY_MAP: Record<OdooCategoryKey, string> = {
  cpu: 'Procesadores',
  motherboard: 'Placas Madre',
  ram: 'Memoria RAM',
  storage: 'Almacenamiento',
  gpu: 'Tarjetas de Video',
  psu: 'Fuentes de Poder',
  case: 'Cases',
  laptop: 'Laptops',
  service: 'Servicios',
};

/** Carga .env (si existe) sin dependencias externas. Requiere Node >= 20.12. */
export function loadDotEnv(path = '.env'): void {
  if (typeof process.loadEnvFile === 'function' && fs.existsSync(path)) {
    process.loadEnvFile(path);
  }
}

class EnvReader {
  readonly errors: string[] = [];

  constructor(private readonly env: NodeJS.ProcessEnv) {}

  str(key: string, fallback = ''): string {
    const value = this.env[key];
    return value === undefined ? fallback : value.trim();
  }

  int(key: string, fallback: number, min: number, max: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      this.errors.push(\`\${key} debe ser un entero entre \${min} y \${max}\`);
      return fallback;
    }
    return value;
  }

  float(key: string, fallback: number, min: number, max: number): number {
    const raw = this.env[key];
    if (raw === undefined || raw.trim() === '') return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < min || value > max) {
      this.errors.push(\`\${key} debe ser un numero entre \${min} y \${max}\`);
      return fallback;
    }
    return value;
  }

  bool(key: string, fallback: boolean): boolean {
    const raw = this.env[key]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return fallback;
    if (['true', '1', 'yes', 'si'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    this.errors.push(\`\${key} debe ser true o false\`);
    return fallback;
  }

  required(key: string): string {
    const value = this.str(key);
    if (value === '') this.errors.push(\`\${key} es obligatorio cuando ODOO_MODE=live\`);
    return value;
  }
}

function parseCategoryMap(raw: string, errors: string[]): Record<OdooCategoryKey, string> {
  const map: Record<OdooCategoryKey, string> = { ...DEFAULT_CATEGORY_MAP };
  if (raw === '') return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    errors.push('ODOO_CATEGORY_MAP no es JSON valido');
    return map;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    errors.push('ODOO_CATEGORY_MAP debe ser un objeto JSON');
    return map;
  }
  const allowed: readonly string[] = [...PRODUCT_CATEGORIES, 'service'];
  for (const [key, value] of Object.entries(parsed)) {
    if (!allowed.includes(key)) {
      errors.push(\`ODOO_CATEGORY_MAP: clave desconocida "\${key}"\`);
    } else if (typeof value !== 'string' || value.trim() === '') {
      errors.push(\`ODOO_CATEGORY_MAP: valor invalido para "\${key}"\`);
    } else {
      map[key as OdooCategoryKey] = value.trim();
    }
  }
  return map;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const r = new EnvReader(env);

  const modeRaw = r.str('ODOO_MODE', 'mock').toLowerCase();
  if (modeRaw !== 'mock' && modeRaw !== 'live') r.errors.push('ODOO_MODE debe ser "mock" o "live"');
  const odooMode: OdooMode = modeRaw === 'live' ? 'live' : 'mock';

  const nodeEnvRaw = r.str('NODE_ENV', 'development');
  const nodeEnv = nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development';

  const logRaw = r.str('LOG_LEVEL', 'info');
  const logLevel: LogLevel = (['debug', 'info', 'warn', 'error'] as const).find((l) => l === logRaw) ?? 'info';

  let odoo: OdooConfig | null = null;
  if (odooMode === 'live') {
    odoo = {
      url: r.required('ODOO_URL').replace(/\\/+$/, ''),
      db: r.required('ODOO_DB'),
      username: r.required('ODOO_USERNAME'),
      password: r.required('ODOO_PASSWORD'),
      timeoutMs: r.int('ODOO_TIMEOUT_MS', 15000, 1000, 120000),
      categoryMap: parseCategoryMap(r.str('ODOO_CATEGORY_MAP'), r.errors),
      specsField: r.str('ODOO_SPECS_FIELD', 'description_sale'),
      createQuotation: r.bool('ODOO_CREATE_QUOTATION', false),
    };
  }

  const config: AppConfig = {
    nodeEnv,
    port: r.int('PORT', 3000, 1, 65535),
    logLevel,
    chatApiKey: r.str('CHAT_API_KEY') || null,
    demoEnabled: r.bool('DEMO_ENABLED', true),
    odooMode,
    mock: {
      catalogPath: r.str('MOCK_CATALOG_PATH', './data/catalog.mock.json'),
      leadsPath: r.str('MOCK_LEADS_PATH', './data/leads.mock.json'),
    },
    odoo,
    gemini: {
      apiKey: r.str('GEMINI_API_KEY') || null,
      model: r.str('GEMINI_MODEL', 'gemini-flash-latest'),
      temperature: r.float('GEMINI_TEMPERATURE', 0.4, 0, 2),
      maxToolRounds: r.int('GEMINI_MAX_TOOL_ROUNDS', 6, 1, 12),
    },
    session: {
      ttlMinutes: r.int('SESSION_TTL_MINUTES', 120, 1, 10080),
      maxSessions: r.int('SESSION_MAX_COUNT', 5000, 10, 1000000),
      maxHistoryTurns: r.int('SESSION_MAX_HISTORY_TURNS', 14, 2, 100),
    },
    store: {
      name: r.str('STORE_NAME', 'TECS'),
      city: r.str('STORE_CITY', 'Acarigua, Portuguesa'),
      address: r.str('STORE_ADDRESS'),
      hours: r.str('STORE_HOURS'),
      deliveryEta: r.str('BUILD_DELIVERY_ETA', '24 a 48 horas hábiles tras confirmar el pago'),
    },
    channels: {
      graphVersion: r.str('META_GRAPH_VERSION', 'v23.0'),
      metaAppSecret: r.str('META_APP_SECRET') || null,
      whatsapp: {
        phoneNumberId: r.str('WHATSAPP_PHONE_NUMBER_ID'),
        accessToken: r.str('WHATSAPP_ACCESS_TOKEN'),
        verifyToken: r.str('WHATSAPP_VERIFY_TOKEN'),
      },
      instagram: {
        accessToken: r.str('INSTAGRAM_ACCESS_TOKEN'),
        verifyToken: r.str('INSTAGRAM_VERIFY_TOKEN'),
      },
      mercadolibre: {
        accessToken: r.str('MERCADOLIBRE_ACCESS_TOKEN'),
        refreshToken: r.str('MERCADOLIBRE_REFRESH_TOKEN'),
        clientId: r.str('MERCADOLIBRE_CLIENT_ID'),
        clientSecret: r.str('MERCADOLIBRE_CLIENT_SECRET'),
        sellerId: r.str('MERCADOLIBRE_SELLER_ID'),
      },
    },
  };

  if (r.errors.length > 0) {
    throw new AppError('CONFIG_ERROR', 'Configuracion de entorno invalida', 500, r.errors);
  }
  return config;
}
`],
  ["src/container.ts", `import { ChannelDispatcher } from './channels/ChannelDispatcher';
import { InstagramAdapter } from './channels/InstagramAdapter';
import { MercadoLibreAdapter } from './channels/MercadoLibreAdapter';
import { WhatsAppAdapter } from './channels/WhatsAppAdapter';
import type { AppConfig } from './config/env';
import { GeminiService } from './ai/GeminiService';
import { GoogleGenAiClient } from './ai/GoogleGenAiClient';
import { ToolExecutor } from './ai/ToolExecutor';
import type { IInventoryRepository } from './repositories/IInventoryRepository';
import { createRepository } from './repositories';
import { CatalogService } from './services/CatalogService';
import { ConversationService } from './services/ConversationService';
import { PCBuildEngine } from './services/PCBuildEngine';
import { SessionStore } from './services/SessionStore';
import type { LlmClient } from './types/llm';
import type { Logger } from './utils/logger';

export interface Container {
  config: AppConfig;
  repository: IInventoryRepository;
  sessions: SessionStore;
  gemini: GeminiService;
  conversation: ConversationService;
  dispatcher: ChannelDispatcher;
  adapters: {
    whatsapp: WhatsAppAdapter;
    instagram: InstagramAdapter;
    mercadolibre: MercadoLibreAdapter;
  };
  log: Logger;
}

export interface ContainerOverrides {
  repository?: IInventoryRepository;
  llm?: LlmClient | null;
}

/** Composicion de dependencias (unico lugar que conoce las implementaciones concretas). */
export function buildContainer(config: AppConfig, log: Logger, overrides: ContainerOverrides = {}): Container {
  const repository = overrides.repository ?? createRepository(config, log);

  const sessions = new SessionStore({
    ttlMs: config.session.ttlMinutes * 60_000,
    maxSessions: config.session.maxSessions,
  });

  const catalog = new CatalogService(repository);
  const engine = new PCBuildEngine(repository, config.store.deliveryEta);
  const tools = new ToolExecutor({
    catalog,
    engine,
    repo: repository,
    store: config.store,
    log: log.child({ component: 'tools' }),
  });

  const llm: LlmClient | null =
    overrides.llm !== undefined
      ? overrides.llm
      : config.gemini.apiKey !== null
        ? new GoogleGenAiClient({ apiKey: config.gemini.apiKey, model: config.gemini.model })
        : null;
  if (llm === null) log.warn('GEMINI_API_KEY no configurada: el asistente respondera LLM_NOT_CONFIGURED');

  const gemini = new GeminiService({
    llm,
    tools,
    store: config.store,
    settings: {
      temperature: config.gemini.temperature,
      maxToolRounds: config.gemini.maxToolRounds,
      maxHistoryTurns: config.session.maxHistoryTurns,
      deliveryEta: config.store.deliveryEta,
    },
    log: log.child({ component: 'gemini' }),
  });

  const conversation = new ConversationService({
    sessions,
    gemini,
    storeAddress: config.store.address,
    engine,
    log: log.child({ component: 'conversation' }),
  });

  const { channels } = config;
  const adapters = {
    whatsapp: new WhatsAppAdapter({ ...channels.whatsapp, graphVersion: channels.graphVersion }, log.child({ component: 'whatsapp' })),
    instagram: new InstagramAdapter({ ...channels.instagram, graphVersion: channels.graphVersion }, log.child({ component: 'instagram' })),
    mercadolibre: new MercadoLibreAdapter(channels.mercadolibre, log.child({ component: 'mercadolibre' })),
  };

  return {
    config,
    repository,
    sessions,
    gemini,
    conversation,
    dispatcher: new ChannelDispatcher(conversation, log.child({ component: 'dispatcher' })),
    adapters,
    log,
  };
}
`],
  ["src/routes/chat.handlers.ts", `import crypto from 'node:crypto';
import type { ConversationService } from '../services/ConversationService';
import type { PCBuildView } from '../services/PCBuildEngine';
import type { ApiSuccessResponse } from '../types/api';
import type { Channel, OdooMode } from '../types/domain';
import { AppError } from '../utils/errors';
import { isRecord, optEnum, optString, reqString } from '../utils/validators';

/** Datos informativos que expone GET /api/chat/config (nunca secretos). */
export interface ChatInfo {
  storeName: string;
  mode: OdooMode;
  geminiConfigured: boolean;
}

export interface ChatDeps {
  conversation: ConversationService;
  /** Si no es null, se exige el encabezado x-api-key. */
  apiKey: string | null;
  exposeDebug: boolean;
  info: ChatInfo;
}

export interface ChatData {
  sessionId: string;
  channel: Channel;
  reply: string;
  /** Estado del armado de PC de la sesion (null si aun no hay armado en curso). */
  build: PCBuildView | null;
  debug?: { toolsUsed: string[] };
}

export interface ResetData {
  sessionId: string;
  channel: Channel;
  /** false si la sesion no existia (p. ej. ya expiro). */
  reset: boolean;
}

export interface ChatConfigData {
  requiresApiKey: boolean;
  storeName: string;
  mode: OdooMode;
  geminiConfigured: boolean;
  maxMessageChars: number;
}

export const CHAT_CHANNELS: readonly Channel[] = ['web', 'whatsapp', 'instagram', 'mercadolibre'];
export const MAX_MESSAGE_CHARS = 1500;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** Lanza UNAUTHORIZED si el servidor exige clave y la recibida no coincide. */
export function assertChatAuthorized(deps: Pick<ChatDeps, 'apiKey'>, providedKey: string | undefined): void {
  if (deps.apiKey === null) return;
  if (providedKey === undefined || !safeEqual(providedKey, deps.apiKey)) {
    throw new AppError('UNAUTHORIZED', 'API key invalida o ausente', 401);
  }
}

function asBody(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new AppError('BAD_REQUEST', 'Se esperaba un cuerpo JSON', 400);
  return body;
}

export async function handleChat(
  deps: ChatDeps,
  providedKey: string | undefined,
  rawBody: unknown,
): Promise<ApiSuccessResponse<ChatData>> {
  assertChatAuthorized(deps, providedKey);
  const body = asBody(rawBody);

  const message = reqString(body, 'message', { max: 2000 });
  const channel: Channel = optEnum(body, 'channel', CHAT_CHANNELS) ?? 'web';
  const sessionId = optString(body, 'sessionId', { max: 100 }) ?? crypto.randomUUID();

  const result = await deps.conversation.handle({ channel, externalUserId: sessionId, text: message });
  return {
    success: true,
    data: {
      sessionId,
      channel,
      reply: result.reply,
      build: result.build,
      ...(deps.exposeDebug ? { debug: { toolsUsed: result.toolsUsed } } : {}),
    },
  };
}

/** Reinicia el estado en memoria (historial + armado) de una sesion del simulador. */
export async function handleReset(
  deps: ChatDeps,
  providedKey: string | undefined,
  rawBody: unknown,
): Promise<ApiSuccessResponse<ResetData>> {
  assertChatAuthorized(deps, providedKey);
  const body = asBody(rawBody);

  const sessionId = reqString(body, 'sessionId', { max: 100 });
  const channel: Channel = optEnum(body, 'channel', CHAT_CHANNELS) ?? 'web';
  const reset = await deps.conversation.reset(channel, sessionId);
  return { success: true, data: { sessionId, channel, reset } };
}

export function getChatConfig(deps: ChatDeps): ApiSuccessResponse<ChatConfigData> {
  return {
    success: true,
    data: {
      requiresApiKey: deps.apiKey !== null,
      storeName: deps.info.storeName,
      mode: deps.info.mode,
      geminiConfigured: deps.info.geminiConfigured,
      maxMessageChars: MAX_MESSAGE_CHARS,
    },
  };
}
`],
  ["src/routes/chat.routes.ts", `import type { Response } from 'express';
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { getChatConfig, handleChat, handleReset } from './chat.handlers';
import type { ChatDeps } from './chat.handlers';

export type { ChatDeps } from './chat.handlers';

function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
}

/**
 * Simulador/demo del asistente sin depender de WhatsApp ni Instagram.
 * Permite probar tambien las politicas de otros canales (ej. channel=mercadolibre).
 * La logica vive en chat.handlers.ts (funciones puras, sin Express) para poder probarla.
 */
export function createChatRouter(deps: ChatDeps): Router {
  const router = Router();

  // Publico a proposito: solo indica si hace falta clave (el simulador decide si abre el modal).
  router.get('/api/chat/config', (_req, res) => {
    noStore(res);
    res.json(getChatConfig(deps));
  });

  router.post(
    '/api/chat',
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await handleChat(deps, req.header('x-api-key'), req.body as unknown));
    }),
  );

  router.post(
    '/api/chat/reset',
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(await handleReset(deps, req.header('x-api-key'), req.body as unknown));
    }),
  );

  return router;
}
`],
  ["src/server.ts", `import { createApp } from './app';
import { loadConfig, loadDotEnv } from './config/env';
import { buildContainer } from './container';
import { isAppError } from './utils/errors';
import { createLogger } from './utils/logger';

function main(): void {
  loadDotEnv();

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    // El logger aun no existe: se informa por consola y se aborta.
    if (isAppError(error)) {
      console.error(JSON.stringify({ level: 'error', message: error.message, details: error.details }));
    } else {
      console.error(error);
    }
    process.exit(1);
  }

  const log = createLogger(config.logLevel, { service: 'bot-ecommerce-tecs' });
  const container = buildContainer(config, log);
  container.sessions.startSweeper();

  if (config.nodeEnv === 'production' && config.chatApiKey === null) {
    log.warn('CHAT_API_KEY no configurada: POST /api/chat queda abierto al publico (defínela o bloquea la ruta en el proxy)');
  }

  const app = createApp(container);
  const server = app.listen(config.port, () => {
    log.info('Servidor iniciado', {
      port: config.port,
      odooMode: config.odooMode,
      env: config.nodeEnv,
      ...(config.demoEnabled ? { demo: \`http://localhost:\${config.port}/demo/\` } : {}),
    });
  });

  const shutdown = (signal: string): void => {
    log.info('Apagando servidor', { signal });
    container.sessions.stopSweeper();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    log.error('Promesa rechazada sin manejar', { reason });
  });
}

main();
`],
  ["src/services/ConversationService.ts", `import { enforceChannelOutput } from '../ai/replyGuard';
import type { GeminiService } from '../ai/GeminiService';
import type { Channel } from '../types/domain';
import { AppError } from '../utils/errors';
import type { Logger } from '../utils/logger';
import type { PCBuildEngine, PCBuildView } from './PCBuildEngine';
import type { Session, SessionStore } from './SessionStore';

export interface ConversationInput {
  channel: Channel;
  externalUserId: string;
  text: string;
}

export interface ConversationResult {
  sessionKey: string;
  reply: string;
  toolsUsed: string[];
  /** Estado actual del armado de PC de la sesion (null si no hay armado en curso o no hay motor). */
  build: PCBuildView | null;
}

export interface ConversationDeps {
  sessions: SessionStore;
  gemini: GeminiService;
  storeAddress: string;
  log: Logger;
  /** Opcional: si se entrega, cada respuesta incluye la vista del armado (simulador/panel). */
  engine?: PCBuildEngine;
  maxInputChars?: number;
}

/** Punto unico de entrada de mensajes: sesion -> Gemini -> politicas del canal. */
export class ConversationService {
  private readonly maxInputChars: number;

  constructor(private readonly deps: ConversationDeps) {
    this.maxInputChars = deps.maxInputChars ?? 1500;
  }

  async handle(input: ConversationInput): Promise<ConversationResult> {
    const text = input.text.trim();
    if (text === '') {
      throw new AppError('BAD_REQUEST', 'El mensaje esta vacio', 400);
    }
    const externalUserId = input.externalUserId.trim();
    if (externalUserId === '') {
      throw new AppError('BAD_REQUEST', 'Falta el identificador del usuario', 400);
    }

    const sessionKey = \`\${input.channel}:\${externalUserId}\`;
    const { sessions, gemini, storeAddress, log } = this.deps;

    return sessions.runExclusive(sessionKey, async () => {
      const session = sessions.getOrCreate(sessionKey, input.channel);
      const result = await gemini.reply(session, text.slice(0, this.maxInputChars));

      const guarded = enforceChannelOutput(input.channel, result.text, { storeAddress });
      if (guarded.modified && input.channel === 'mercadolibre') {
        log.warn('Se elimino contenido prohibido de una respuesta de Mercado Libre', { session: sessionKey });
      }
      log.info('Mensaje atendido', {
        session: sessionKey,
        channel: input.channel,
        tools: result.toolsUsed,
      });
      const build = await this.describeBuild(session.build, sessionKey);
      return { sessionKey, reply: guarded.text, toolsUsed: result.toolsUsed, build };
    });
  }

  /** Descarta la sesion (historial + armado en memoria). Devuelve true si existia. */
  async reset(channel: Channel, externalUserId: string): Promise<boolean> {
    const id = externalUserId.trim();
    if (id === '') {
      throw new AppError('BAD_REQUEST', 'Falta el identificador del usuario', 400);
    }
    const sessionKey = \`\${channel}:\${id}\`;
    return this.deps.sessions.runExclusive(sessionKey, async () => this.deps.sessions.delete(sessionKey));
  }

  /** La vista es informativa: un fallo al calcularla nunca debe tumbar la respuesta al cliente. */
  private async describeBuild(state: Session['build'], sessionKey: string): Promise<PCBuildView | null> {
    const { engine, log } = this.deps;
    if (engine === undefined) return null;
    try {
      return await engine.view(state);
    } catch (error) {
      log.warn('No se pudo calcular la vista del armado', { session: sessionKey, error });
      return null;
    }
  }
}
`],
  ["src/services/PCBuildEngine.ts", `import type { IInventoryRepository } from '../repositories/IInventoryRepository';
import type {
  BuildCategory,
  BuildPurpose,
  BuildSelection,
  PCBuildState,
  Product,
  QuoteLine,
  QuoteSnapshot,
  ServiceItem,
  SpecFilter,
} from '../types/domain';
import { BUILD_CATEGORIES } from '../types/domain';
import { AppError } from '../utils/errors';
import { round2 } from '../utils/text';
import type { BuildComponents, CompatIssue } from './compatibility';
import { blockingIssuesFor, evaluateBuild } from './compatibility';
import { pickSpread, tierLabels } from './curation';

/** Reparto del presupuesto (sin servicios) por proposito. Cada fila suma 1. */
const BUDGET_RATIOS: Record<BuildPurpose, Record<BuildCategory, number>> = {
  gaming: { cpu: 0.2, motherboard: 0.12, ram: 0.09, storage: 0.08, gpu: 0.35, psu: 0.08, case: 0.08 },
  creation: { cpu: 0.26, motherboard: 0.13, ram: 0.14, storage: 0.1, gpu: 0.2, psu: 0.09, case: 0.08 },
  office: { cpu: 0.26, motherboard: 0.16, ram: 0.13, storage: 0.15, gpu: 0.1, psu: 0.1, case: 0.1 },
};

const REQUIRED_SERVICE_KINDS = ['assembly', 'cable_management', 'os_setup'] as const;
const SERVICES_CACHE_MS = 60_000;
const MIN_BUDGET_USD = 50;
const MAX_BUDGET_USD = 20_000;

export interface StartBuildInput {
  purpose: BuildPurpose;
  budgetUsd: number;
  /** Descarta los componentes ya elegidos. */
  reset?: boolean;
}

export interface BuildProgress {
  purpose: BuildPurpose | null;
  budgetUsd: number | null;
  selected: BuildSelection[];
  nextStep: BuildCategory | null;
  remainingSteps: BuildCategory[];
  /** true si el procesador elegido tiene video integrado y se puede omitir la GPU. */
  gpuOptional: boolean;
  spentUsd: number;
}

export interface SuggestedOption {
  product: Product;
  tier: string;
}

export interface SuggestionResult {
  category: BuildCategory | null;
  budgetForCategoryUsd: number;
  options: SuggestedOption[];
  /** true si no habia nada dentro del presupuesto y se muestran las opciones mas economicas. */
  overBudget: boolean;
  note: string;
}

export interface BuildSummary extends QuoteSnapshot {
  complete: boolean;
  missing: BuildCategory[];
  issues: CompatIssue[];
  /** total - presupuesto (positivo = excede). null si no hay presupuesto. */
  budgetDeltaUsd: number | null;
}

/**
 * Vista serializable del armado para clientes de demostracion/panel: progreso + cotizacion en vivo.
 * No incluye el producto completo (solo SKU, nombre y precio) para mantener la respuesta liviana.
 */
export interface PCBuildView extends BuildProgress {
  gpuSkipped: boolean;
  updatedAt: string;
  /** true cuando estan todos los pasos requeridos (los servicios solo se suman en ese caso). */
  complete: boolean;
  services: QuoteLine[];
  subtotalUsd: number;
  servicesUsd: number;
  totalUsd: number;
  deliveryEta: string;
  budgetDeltaUsd: number | null;
  issues: CompatIssue[];
}

export function createEmptyBuild(now: Date = new Date()): PCBuildState {
  const stamp = now.toISOString();
  return { purpose: null, budgetUsd: null, components: {}, gpuSkipped: false, createdAt: stamp, updatedAt: stamp };
}

function toLine(product: Product): QuoteLine {
  return {
    productId: product.id,
    sku: product.sku,
    name: product.name,
    category: product.category as BuildCategory,
    priceUsd: product.priceUsd,
  };
}

/**
 * Motor de armado de PC. Trabaja sobre el estado en memoria de la sesion y consulta
 * catalogo/servicios unicamente a traves de IInventoryRepository.
 */
export class PCBuildEngine {
  private servicesCache: { at: number; items: ServiceItem[] } | null = null;

  constructor(
    private readonly repo: IInventoryRepository,
    private readonly deliveryEta: string,
    private readonly now: () => number = Date.now,
  ) {}

  // ------------------------------------------------------------- estado

  start(build: PCBuildState, input: StartBuildInput): BuildProgress {
    if (!Number.isFinite(input.budgetUsd) || input.budgetUsd < MIN_BUDGET_USD || input.budgetUsd > MAX_BUDGET_USD) {
      throw new AppError(
        'VALIDATION_ERROR',
        \`El presupuesto debe estar entre \${MIN_BUDGET_USD} y \${MAX_BUDGET_USD} USD\`,
        400,
        { field: 'budgetUsd' },
      );
    }
    if (input.reset === true) {
      build.components = {};
      build.gpuSkipped = false;
    }
    build.purpose = input.purpose;
    build.budgetUsd = round2(input.budgetUsd);
    this.touch(build);
    return this.progress(build);
  }

  progress(build: PCBuildState): BuildProgress {
    const selected: BuildSelection[] = BUILD_CATEGORIES.flatMap((category) => {
      const product = build.components[category];
      return product ? [{ category, sku: product.sku, name: product.name, priceUsd: product.priceUsd }] : [];
    });
    const remainingSteps = this.missingSteps(build);
    return {
      purpose: build.purpose,
      budgetUsd: build.budgetUsd,
      selected,
      nextStep: remainingSteps[0] ?? null,
      remainingSteps,
      gpuOptional: build.components.cpu?.specs.igpu === true,
      spentUsd: round2(selected.reduce((sum, s) => sum + s.priceUsd, 0)),
    };
  }

  isComplete(build: PCBuildState): boolean {
    return this.missingSteps(build).length === 0;
  }

  // ------------------------------------------------------- sugerencias

  async suggest(build: PCBuildState, requested?: BuildCategory): Promise<SuggestionResult> {
    if (build.purpose === null || build.budgetUsd === null) {
      throw new AppError(
        'BUILD_PROFILE_INCOMPLETE',
        'Antes de sugerir componentes pregunta el proposito (gaming, creacion u oficina) y el presupuesto, y llama a iniciar_armado_pc',
        409,
      );
    }
    const category = requested ?? this.missingSteps(build)[0] ?? null;
    if (category === null) {
      return {
        category: null,
        budgetForCategoryUsd: 0,
        options: [],
        overBudget: false,
        note: 'El armado ya tiene todos los componentes: presenta el resumen con ver_armado',
      };
    }

    const budgetForCategoryUsd = await this.categoryBudget(build, category);
    const spec = this.specFilterFor(build, category);
    const compatible = async (candidates: Product[]): Promise<Product[]> =>
      candidates.filter((p) => blockingIssuesFor(build.components, p).length === 0);

    let overBudget = false;
    let pool = await compatible(
      await this.repo.searchProducts({ category, maxPriceUsd: budgetForCategoryUsd, spec, sort: 'price_desc' }),
    );
    if (pool.length === 0) {
      overBudget = true;
      pool = (
        await compatible(await this.repo.searchProducts({ category, spec, sort: 'price_asc' }))
      ).slice(0, 2);
    }

    const picked = pickSpread(pool);
    const tiers = tierLabels(picked.length);
    const options = picked.map((product, index) => ({ product, tier: tiers[index] ?? 'opcion' }));

    let note = 'Presenta estas opciones (maximo 3) y espera la eleccion del cliente';
    if (options.length === 0) {
      note =
        'No hay opciones compatibles en stock para este paso; sugiere ajustar el presupuesto o cambiar un componente previo';
    } else if (overBudget) {
      note = 'Nada entra en el presupuesto de este paso: explica que son las opciones mas economicas disponibles';
    }
    return { category, budgetForCategoryUsd, options, overBudget, note };
  }

  // ------------------------------------------------- seleccion de piezas

  async select(build: PCBuildState, sku: string): Promise<{ progress: BuildProgress; warnings: CompatIssue[] }> {
    const product = await this.repo.getProductBySku(sku);
    if (product === null) {
      throw new AppError('COMPONENT_NOT_FOUND', \`No existe un producto con SKU "\${sku}"\`, 404, { sku });
    }
    if (product.category === 'laptop') {
      throw new AppError('VALIDATION_ERROR', 'Las laptops no forman parte de un armado de PC', 400, { sku });
    }
    if (product.stock <= 0) {
      throw new AppError('OUT_OF_STOCK', \`"\${product.name}" esta agotado\`, 409, { sku });
    }

    const blocking = blockingIssuesFor(build.components, product);
    if (blocking.length > 0) {
      throw new AppError('INCOMPATIBLE_COMPONENT', 'El componente no es compatible con el armado actual', 409, {
        sku,
        problemas: blocking.map((i) => ({ code: i.code, message: i.message })),
        sugerencia: 'Ofrece una alternativa compatible con sugerir_componentes o quita el componente en conflicto',
      });
    }

    const category = product.category as BuildCategory;
    build.components[category] = product;
    if (category === 'gpu') build.gpuSkipped = false;
    this.touch(build);

    return {
      progress: this.progress(build),
      warnings: evaluateBuild(build.components).filter((i) => i.severity === 'warning'),
    };
  }

  remove(build: PCBuildState, category: BuildCategory): BuildProgress {
    delete build.components[category];
    if (category === 'gpu') build.gpuSkipped = false;
    this.touch(build);
    return this.progress(build);
  }

  /** Arma sin tarjeta de video dedicada (solo si el procesador tiene graficos integrados). */
  skipGpu(build: PCBuildState): BuildProgress {
    const cpu = build.components.cpu;
    if (cpu === undefined) {
      throw new AppError('BUILD_INCOMPLETE', 'Primero elige el procesador para saber si tiene video integrado', 409);
    }
    if (cpu.specs.igpu !== true) {
      throw new AppError(
        'INCOMPATIBLE_COMPONENT',
        'El procesador elegido no tiene graficos integrados: se necesita una tarjeta de video',
        409,
        { cpu: cpu.sku },
      );
    }
    delete build.components.gpu;
    build.gpuSkipped = true;
    this.touch(build);
    return this.progress(build);
  }

  // --------------------------------------------------------- cotizacion

  async summarize(build: PCBuildState): Promise<BuildSummary> {
    const missing = this.missingSteps(build);
    const complete = missing.length === 0;

    const items = BUILD_CATEGORIES.flatMap((c) => {
      const product = build.components[c];
      return product ? [toLine(product)] : [];
    });
    const services = complete ? (await this.requiredServices()).map(serviceLine) : [];

    const subtotalUsd = round2(items.reduce((sum, l) => sum + l.priceUsd, 0));
    const servicesUsd = round2(services.reduce((sum, l) => sum + l.priceUsd, 0));
    const totalUsd = round2(subtotalUsd + servicesUsd);

    return {
      purpose: build.purpose,
      budgetUsd: build.budgetUsd,
      items,
      services,
      subtotalUsd,
      servicesUsd,
      totalUsd,
      deliveryEta: this.deliveryEta,
      complete,
      missing,
      issues: evaluateBuild(build.components),
      budgetDeltaUsd: build.budgetUsd === null ? null : round2(totalUsd - build.budgetUsd),
    };
  }

  /** Vista del armado para paneles/demos. Devuelve null si la sesion aun no inicio ningun armado. */
  async view(build: PCBuildState): Promise<PCBuildView | null> {
    const started = build.purpose !== null || build.budgetUsd !== null || build.gpuSkipped;
    if (!started && Object.keys(build.components).length === 0) return null;

    const progress = this.progress(build);
    const summary = await this.summarize(build);
    return {
      ...progress,
      gpuSkipped: build.gpuSkipped,
      updatedAt: build.updatedAt,
      complete: summary.complete,
      services: summary.services,
      subtotalUsd: summary.subtotalUsd,
      servicesUsd: summary.servicesUsd,
      totalUsd: summary.totalUsd,
      deliveryEta: summary.deliveryEta,
      budgetDeltaUsd: summary.budgetDeltaUsd,
      issues: summary.issues,
    };
  }

  /** Cotizacion final lista para registrar en el lead. Exige armado completo y sin conflictos. */
  async buildQuote(build: PCBuildState): Promise<QuoteSnapshot> {
    const summary = await this.summarize(build);
    if (!summary.complete) {
      throw new AppError('BUILD_INCOMPLETE', 'El armado aun no esta completo', 409, { faltan: summary.missing });
    }
    const errors = summary.issues.filter((i) => i.severity === 'error');
    if (errors.length > 0) {
      throw new AppError('INCOMPATIBLE_COMPONENT', 'El armado tiene incompatibilidades', 409, {
        problemas: errors.map((i) => i.message),
      });
    }
    const { complete: _complete, missing: _missing, issues: _issues, budgetDeltaUsd: _delta, ...quote } = summary;
    return quote;
  }

  // ------------------------------------------------------------ privado

  private missingSteps(build: PCBuildState): BuildCategory[] {
    return BUILD_CATEGORIES.filter((c) => !(c === 'gpu' && build.gpuSkipped) && build.components[c] === undefined);
  }

  private touch(build: PCBuildState): void {
    build.updatedAt = new Date(this.now()).toISOString();
  }

  private specFilterFor(build: PCBuildState, category: BuildCategory): SpecFilter {
    // Filtros que el repositorio resuelve del lado de datos; el resto se valida con blockingIssuesFor.
    const c: BuildComponents = build.components;
    const spec: SpecFilter = {};
    if (category === 'cpu' && c.motherboard?.specs.socket) spec.socket = c.motherboard.specs.socket;
    if (category === 'motherboard') {
      if (c.cpu?.specs.socket) spec.socket = c.cpu.specs.socket;
      if (c.ram?.specs.memory_type) spec.memoryType = c.ram.specs.memory_type;
    }
    if (category === 'ram' && c.motherboard?.specs.memory_type) spec.memoryType = c.motherboard.specs.memory_type;
    if (category === 'case' && c.motherboard?.specs.form_factor) {
      spec.supportsFormFactor = c.motherboard.specs.form_factor;
    }
    return spec;
  }

  /** Presupuesto disponible para una categoria, redistribuyendo lo ya gastado. */
  private async categoryBudget(build: PCBuildState, category: BuildCategory): Promise<number> {
    const budget = build.budgetUsd ?? 0;
    const purpose = build.purpose ?? 'gaming';
    const ratios = BUDGET_RATIOS[purpose];
    const servicesUsd = await this.estimateServicesUsd();

    const spentElsewhere = BUILD_CATEGORIES.reduce(
      (sum, c) => sum + (c === category ? 0 : (build.components[c]?.priceUsd ?? 0)),
      0,
    );
    const pool = Math.max(budget - servicesUsd - spentElsewhere, 0);
    const pending = BUILD_CATEGORIES.filter(
      (c) => c === category || (build.components[c] === undefined && !(c === 'gpu' && build.gpuSkipped)),
    );
    const weight = pending.reduce((sum, c) => sum + ratios[c], 0);
    return round2(weight === 0 ? pool : (pool * ratios[category]) / weight);
  }

  private async requiredServices(): Promise<ServiceItem[]> {
    const now = this.now();
    if (this.servicesCache === null || now - this.servicesCache.at > SERVICES_CACHE_MS) {
      this.servicesCache = { at: now, items: await this.repo.listServices() };
    }
    const all = this.servicesCache.items;
    return REQUIRED_SERVICE_KINDS.flatMap((kind) => {
      const found = all.find((s) => s.kind === kind);
      return found ? [found] : [];
    });
  }

  private async estimateServicesUsd(): Promise<number> {
    return round2((await this.requiredServices()).reduce((sum, s) => sum + s.priceUsd, 0));
  }
}

function serviceLine(service: ServiceItem): QuoteLine {
  return {
    productId: service.id,
    sku: service.sku,
    name: service.name,
    category: 'service',
    priceUsd: service.priceUsd,
  };
}
`],
  ["tests/demo-simulator.test.ts", `import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import vm from 'node:vm';
import { GeminiService } from '../src/ai/GeminiService';
import { ToolExecutor } from '../src/ai/ToolExecutor';
import { TOOL_NAMES } from '../src/ai/tools';
import { loadConfig } from '../src/config/env';
import type { ChatDeps } from '../src/routes/chat.handlers';
import { getChatConfig, handleChat, handleReset } from '../src/routes/chat.handlers';
import { CatalogService } from '../src/services/CatalogService';
import { ConversationService } from '../src/services/ConversationService';
import { PCBuildEngine, createEmptyBuild } from '../src/services/PCBuildEngine';
import { SessionStore } from '../src/services/SessionStore';
import { BUILD_CATEGORIES } from '../src/types/domain';
import type { LlmMessage } from '../src/types/llm';
import { AppError, isAppError } from '../src/utils/errors';
import { silentLogger } from '../src/utils/logger';
import { makeMockRepo } from './helpers/fixtures';
import { ScriptedLlm, call, say } from './helpers/fakeLlm';

const STORE = { name: 'TECS', city: 'Acarigua, Portuguesa', address: 'Av. Principal, Local 5', hours: 'Lun-Sab 9am-6pm' };
const ETA = '24 a 48 horas hábiles';
const SETTINGS = { temperature: 0.4, maxToolRounds: 4, maxHistoryTurns: 14, deliveryEta: ETA };

// Armado completo y compatible (AM4 + DDR4, CPU con video integrado -> se omite la GPU).
const FULL_BUILD_SKUS = ['CPU-R5-5600G', 'MB-B550M-PRO-VDH', 'RAM-KF-16-D4', 'SSD-NV2-500', 'PSU-CV650', 'CASE-ANTEC-NX200M'];

const instances: { cleanup(): void }[] = [];
after(() => instances.forEach((i) => i.cleanup()));

function setup(script: (LlmMessage | Error)[], withEngine = true) {
  const temp = makeMockRepo();
  instances.push(temp);
  const sessions = new SessionStore({ ttlMs: 60_000, maxSessions: 100 });
  const engine = new PCBuildEngine(temp.repo, ETA);
  const tools = new ToolExecutor({ catalog: new CatalogService(temp.repo), engine, repo: temp.repo, store: STORE, log: silentLogger });
  const gemini = new GeminiService({ llm: new ScriptedLlm(script), tools, store: STORE, settings: SETTINGS, log: silentLogger });
  const conversation = new ConversationService({
    sessions,
    gemini,
    storeAddress: STORE.address,
    log: silentLogger,
    ...(withEngine ? { engine } : {}),
  });
  return { temp, sessions, engine, conversation };
}

function chatDeps(conversation: ConversationService, overrides: Partial<ChatDeps> = {}): ChatDeps {
  return {
    conversation,
    apiKey: null,
    exposeDebug: true,
    info: { storeName: 'TECS', mode: 'mock', geminiConfigured: true },
    ...overrides,
  };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(isAppError(error), \`se esperaba AppError y llego: \${String(error)}\`);
    return error;
  }
  throw new assert.AssertionError({ message: 'se esperaba un rechazo' });
}

describe('PCBuildEngine.view', () => {
  it('sin armado iniciado -> null', async () => {
    const { engine } = setup([]);
    assert.equal(await engine.view(createEmptyBuild()), null);
  });

  it('armado en curso: progreso, gasto y paso siguiente; sin servicios hasta completar', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
    await engine.select(build, 'CPU-R5-5600G');

    const view = await engine.view(build);
    assert.ok(view);
    assert.equal(view.purpose, 'gaming');
    assert.equal(view.budgetUsd, 800);
    assert.deepEqual(view.selected.map((s) => s.category), ['cpu']);
    assert.equal(view.nextStep, 'motherboard');
    assert.equal(view.complete, false);
    assert.deepEqual(view.services, []);
    assert.equal(view.servicesUsd, 0);
    assert.equal(view.totalUsd, view.subtotalUsd);
    assert.equal(view.spentUsd, view.subtotalUsd);
    assert.equal(view.gpuOptional, true);
  });

  it('armado completo: suma servicios obligatorios, ETA y diferencia contra el presupuesto', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'office', budgetUsd: 500 });
    for (const sku of FULL_BUILD_SKUS) await engine.select(build, sku);
    engine.skipGpu(build);

    const view = await engine.view(build);
    assert.ok(view);
    assert.equal(view.complete, true);
    assert.equal(view.gpuSkipped, true);
    assert.equal(view.nextStep, null);
    assert.equal(view.services.length, 3);
    assert.ok(view.servicesUsd > 0);
    assert.equal(Math.round((view.subtotalUsd + view.servicesUsd) * 100), Math.round(view.totalUsd * 100));
    assert.equal(view.deliveryEta, ETA);
    assert.equal(view.budgetDeltaUsd, Math.round((view.totalUsd - 500) * 100) / 100);
    assert.deepEqual(view.issues.filter((i) => i.severity === 'error'), []);
  });

  it('es serializable a JSON sin perder datos (lo consume el simulador)', async () => {
    const { engine } = setup([]);
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 700 });
    await engine.select(build, 'CPU-R5-5600G');
    const view = await engine.view(build);
    assert.deepEqual(JSON.parse(JSON.stringify(view)), view);
  });
});

describe('ConversationService: vista del armado y reinicio', () => {
  it('cada respuesta trae la vista del armado y se actualiza al elegir componentes', async () => {
    const env = setup([
      call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }),
      say('Empecemos con el procesador.'),
      call(TOOL_NAMES.selectComponent, { sku: 'CPU-R5-5600G' }),
      say('Procesador elegido.'),
    ]);
    const first = await env.conversation.handle({ channel: 'web', externalUserId: 'v1', text: 'Quiero armar una PC gamer de 800' });
    assert.equal(first.build?.purpose, 'gaming');
    assert.deepEqual(first.build?.selected, []);

    const second = await env.conversation.handle({ channel: 'web', externalUserId: 'v1', text: 'dale con el CPU' });
    assert.deepEqual(second.build?.selected.map((s) => s.sku), ['CPU-R5-5600G']);
    assert.equal(second.build?.nextStep, 'motherboard');
  });

  it('sin armado en curso -> build null; sin motor configurado -> build null', async () => {
    const withEngine = setup([say('Hola')]);
    assert.equal((await withEngine.conversation.handle({ channel: 'web', externalUserId: 'n1', text: 'hola' })).build, null);

    const withoutEngine = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('ok')], false);
    const result = await withoutEngine.conversation.handle({ channel: 'web', externalUserId: 'n2', text: 'armar' });
    assert.equal(result.build, null);
  });

  it('si la vista falla, la respuesta al cliente NO falla (solo build null)', async () => {
    const env = setup([say('Hola')]);
    const broken = new ConversationService({
      sessions: new SessionStore({ ttlMs: 60_000, maxSessions: 10 }),
      gemini: (env.conversation as unknown as { deps: { gemini: GeminiService } }).deps.gemini,
      storeAddress: STORE.address,
      log: silentLogger,
      engine: { view: async () => { throw new Error('repositorio caido'); } } as unknown as PCBuildEngine,
    });
    const result = await broken.handle({ channel: 'web', externalUserId: 'f1', text: 'hola' });
    assert.equal(result.reply, 'Hola');
    assert.equal(result.build, null);
  });

  it('reset elimina historial y armado de ESA sesion y canal, y no toca otras', async () => {
    const env = setup([
      call(TOOL_NAMES.startBuild, { proposito: 'office', presupuesto_usd: 400 }),
      say('ok'),
      say('hola'),
    ]);
    await env.conversation.handle({ channel: 'whatsapp', externalUserId: 'r1', text: 'armar' });
    await env.conversation.handle({ channel: 'instagram', externalUserId: 'r1', text: 'hola' });
    assert.ok(env.sessions.peek('whatsapp:r1'));

    assert.equal(await env.conversation.reset('whatsapp', 'r1'), true);
    assert.equal(env.sessions.peek('whatsapp:r1'), undefined);
    assert.ok(env.sessions.peek('instagram:r1'), 'otro canal con el mismo id no se toca');
    assert.equal(await env.conversation.reset('whatsapp', 'r1'), false);
    await assert.rejects(() => env.conversation.reset('whatsapp', '  '), /identificador/);
  });
});

describe('handlers de /api/chat (sin Express)', () => {
  it('con API key: falta o es incorrecta -> UNAUTHORIZED 401; correcta -> responde', async () => {
    const env = setup([say('Hola')]);
    const deps = chatDeps(env.conversation, { apiKey: 'secreto' });
    for (const key of [undefined, 'otra', 'secret', 'secreto-x']) {
      const error = await rejection(handleChat(deps, key, { message: 'hola' }));
      assert.equal(error.code, 'UNAUTHORIZED');
      assert.equal(error.httpStatus, 401);
    }
    const ok = await handleChat(deps, 'secreto', { message: 'hola' });
    assert.equal(ok.success, true);
    assert.equal(ok.data.reply, 'Hola');
  });

  it('la clave tambien protege el reinicio', async () => {
    const env = setup([]);
    const deps = chatDeps(env.conversation, { apiKey: 'secreto' });
    const error = await rejection(handleReset(deps, undefined, { sessionId: 's' }));
    assert.equal(error.code, 'UNAUTHORIZED');
  });

  it('valida el cuerpo: no-objeto, mensaje vacio, canal invalido -> 400', async () => {
    const env = setup([say('x')]);
    const deps = chatDeps(env.conversation);
    assert.equal((await rejection(handleChat(deps, undefined, 'texto'))).code, 'BAD_REQUEST');
    assert.equal((await rejection(handleChat(deps, undefined, null))).code, 'BAD_REQUEST');
    assert.equal((await rejection(handleChat(deps, undefined, { message: '   ' }))).code, 'VALIDATION_ERROR');
    const bad = await rejection(handleChat(deps, undefined, { message: 'hola', channel: 'telegram' }));
    assert.equal(bad.code, 'VALIDATION_ERROR');
    assert.equal(bad.httpStatus, 400);
  });

  it('respuesta: canal web por defecto, sessionId generado, build y debug segun exposeDebug', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('listo'), say('hola de nuevo')]);
    const first = await handleChat(chatDeps(env.conversation), undefined, { message: 'armar una PC' });
    assert.equal(first.data.channel, 'web');
    assert.match(first.data.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(first.data.build?.purpose, 'gaming');
    assert.deepEqual(first.data.debug, { toolsUsed: [TOOL_NAMES.startBuild] });

    const prod = await handleChat(chatDeps(env.conversation, { exposeDebug: false }), undefined, {
      message: 'hola',
      sessionId: first.data.sessionId,
    });
    assert.equal('debug' in prod.data, false);
    assert.equal(prod.data.sessionId, first.data.sessionId);
  });

  it('el estado de dos canales con el mismo sessionId es independiente', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('a'), say('b')]);
    const deps = chatDeps(env.conversation);
    const wa = await handleChat(deps, undefined, { message: 'armar', channel: 'whatsapp', sessionId: 'same' });
    const ig = await handleChat(deps, undefined, { message: 'hola', channel: 'instagram', sessionId: 'same' });
    assert.ok(wa.data.build);
    assert.equal(ig.data.build, null);
  });

  it('reset: devuelve reset=true una vez y false despues; el armado vuelve a null', async () => {
    const env = setup([call(TOOL_NAMES.startBuild, { proposito: 'gaming', presupuesto_usd: 800 }), say('a'), say('b')]);
    const deps = chatDeps(env.conversation);
    await handleChat(deps, undefined, { message: 'armar', channel: 'whatsapp', sessionId: 'demo-1' });

    const first = await handleReset(deps, undefined, { channel: 'whatsapp', sessionId: 'demo-1' });
    assert.deepEqual(first.data, { sessionId: 'demo-1', channel: 'whatsapp', reset: true });
    const second = await handleReset(deps, undefined, { channel: 'whatsapp', sessionId: 'demo-1' });
    assert.equal(second.data.reset, false);

    const after = await handleChat(deps, undefined, { message: 'hola', channel: 'whatsapp', sessionId: 'demo-1' });
    assert.equal(after.data.build, null);

    const missing = await rejection(handleReset(deps, undefined, {}));
    assert.equal(missing.code, 'VALIDATION_ERROR');
  });

  it('GET config: indica si hace falta clave y NUNCA la expone', () => {
    const env = setup([]);
    const withKey = getChatConfig(chatDeps(env.conversation, { apiKey: 'secreto-super-largo' }));
    assert.equal(withKey.data.requiresApiKey, true);
    assert.equal(JSON.stringify(withKey).includes('secreto-super-largo'), false);
    const open = getChatConfig(chatDeps(env.conversation, { info: { storeName: 'TECS', mode: 'live', geminiConfigured: false } }));
    assert.deepEqual(open.data, { requiresApiKey: false, storeName: 'TECS', mode: 'live', geminiConfigured: false, maxMessageChars: 1500 });
  });
});

describe('DEMO_ENABLED', () => {
  it('por defecto activo; acepta false; valor invalido -> CONFIG_ERROR', () => {
    assert.equal(loadConfig({}).demoEnabled, true);
    assert.equal(loadConfig({ DEMO_ENABLED: 'false' }).demoEnabled, false);
    assert.equal(loadConfig({ DEMO_ENABLED: '0' }).demoEnabled, false);
    assert.throws(() => loadConfig({ DEMO_ENABLED: 'quizas' }), (error: unknown) => isAppError(error) && error.code === 'CONFIG_ERROR');
  });
});

describe('public/demo/index.html (verificaciones estaticas)', () => {
  const file = path.resolve(__dirname, '../public/demo/index.html');
  const html = fs.readFileSync(file, 'utf8');
  const script = /<script>([\\s\\S]*?)<\\/script>/.exec(html)?.[1] ?? '';

  it('es autocontenido: sin frameworks, CDNs, <script src>, <link rel=stylesheet> ni URLs externas', () => {
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<link[^>]+rel=["']?stylesheet/i);
    assert.doesNotMatch(html, /@import|url\\(\\s*["']?https?:/i);
    const urls = (html.match(/https?:\\/\\/[^\\s"'<>)]+/g) ?? []).filter((u) => !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(urls, []);
  });

  it('el JS compila y no usa APIs peligrosas (eval, innerHTML, document.write)', () => {
    assert.ok(script.length > 1000, 'no se encontro el script integrado');
    assert.doesNotThrow(() => new vm.Script(script, { filename: 'demo-inline.js' }));
    assert.doesNotMatch(script, /\\beval\\s*\\(|new Function|innerHTML|outerHTML|insertAdjacentHTML|document\\.write/);
  });

  it('todos los ids que usa el JS existen y no hay ids duplicados', () => {
    const ids = [...html.matchAll(/\\sid="([^"]+)"/g)].map((m) => m[1] as string);
    assert.equal(new Set(ids).size, ids.length, 'ids duplicados');
    const used = [...script.matchAll(/\\$\\('([^']+)'\\)/g)].map((m) => m[1] as string);
    assert.ok(used.length > 15);
    for (const id of used) assert.ok(ids.includes(id), \`el JS usa #\${id} pero no existe en el HTML\`);
  });

  it('cumple los requisitos: canales, sessionId, reset, x-api-key en localStorage y endpoints', () => {
    for (const channel of ['whatsapp', 'instagram', 'mercadolibre']) {
      assert.match(html, new RegExp(\`name="channel" id="ch-\${channel}" value="\${channel}"\`));
    }
    assert.match(script, /channel: channel, sessionId: sessionId/);
    assert.match(script, /'x-api-key'/);
    assert.match(script, /localStorage/);
    assert.match(script, /'\\.\\.\\/api\\/chat'/);
    assert.match(script, /'\\/reset'/);
    assert.match(script, /'\\/config'/);
    assert.match(html, /id="newBtn"/);
    assert.match(html, /<meta name="viewport"/);
    assert.match(html, /@media \\(max-width: 959px\\)/);
    for (const text of ['Quiero armar una PC gamer de $800', '¿Qué cases tienen?', '¿Tienen Ryzen 5 5600G?']) {
      assert.ok(script.includes(text), \`falta la prueba rapida: \${text}\`);
    }
  });

  it('las categorias del visor coinciden con las del motor de armado', () => {
    const steps = [...script.matchAll(/\\['(cpu|motherboard|ram|storage|gpu|psu|case)',/g)].map((m) => m[1]);
    assert.deepEqual(steps, [...BUILD_CATEGORIES]);
  });
});
`],
  ["tests/helpers/fakeLlm.ts", `import type { LlmClient, LlmGenerateRequest, LlmMessage } from '../../src/types/llm';

export const call = (name: string, args: Record<string, unknown>, id = \`call-\${name}\`): LlmMessage => ({
  role: 'model',
  parts: [{ kind: 'tool_call', id, name, args }],
});

export const say = (text: string): LlmMessage => ({ role: 'model', parts: [{ kind: 'text', text }] });

/** LLM guionado: cada llamada consume el siguiente paso del guion. */
export class ScriptedLlm implements LlmClient {
  constructor(private readonly script: (LlmMessage | Error)[]) {}

  async generate(_request: LlmGenerateRequest): Promise<LlmMessage> {
    const step = this.script.shift();
    if (step === undefined) throw new Error('guion agotado');
    if (step instanceof Error) throw step;
    return step;
  }
}
`],
  ["README.md", `# Bot Ecommerce TECS Acarigua

Asistente comercial omnicanal con IA (Gemini + Node.js/TypeScript/Express) para la tienda TECS (Acarigua).
Atiende WhatsApp, Instagram DM y Mercado Libre, filtra consultas vagas, arma cotizaciones de PC paso a paso
en memoria y concreta visitas en la tienda fisica. Arquitectura dual: \`ODOO_MODE=mock | live\`.

## Inicio rapido (modo demo, sin Odoo)

\`\`\`bash
npm install
cp .env.example .env        # en Windows: copy .env.example .env
# edita .env y define GEMINI_API_KEY
npm run dev
\`\`\`

Prueba el asistente sin WhatsApp:

\`\`\`bash
curl -s localhost:3000/api/chat -H "content-type: application/json" \\
  -d '{"message":"Quiero armar una PC para jugar, tengo 800 dolares"}'
\`\`\`

La respuesta incluye un \`sessionId\`: reenvialo para continuar la conversacion. Con \`"channel":"mercadolibre"\` se
prueban las politicas de seguridad de ese canal. Si el armado de PC esta en curso, \`data.build\` trae su estado.

### Simulador web de demostracion

Abre **http://localhost:3000/demo/** para chatear desde el navegador: elige canal (WhatsApp, Instagram, Mercado Libre),
usa las pruebas rapidas y mira en vivo como la IA va llenando el armado de PC y calculando el montaje. Si defines
\`CHAT_API_KEY\`, la pagina pide la clave en un modal y la envia en \`x-api-key\`. Desactivalo con \`DEMO_ENABLED=false\`.

## Arquitectura

| Capa | Ubicacion | Responsabilidad |
| --- | --- | --- |
| Datos (patron adaptador) | \`src/repositories\` | \`IInventoryRepository\` + \`MockRepository\` (JSON local) + \`OdooRepository\` (XML-RPC) |
| Negocio | \`src/services\` | Curaduria (max. 3 opciones, desambiguacion), compatibilidad, motor de armado de PC, sesiones |
| IA | \`src/ai\` | Prompt del sistema, declaracion/ejecucion de herramientas, bucle de Function Calling con Gemini, filtro de salida por canal |
| Demo | \`public/demo\` | Simulador web (HTML/CSS/JS vanilla, sin dependencias) |
| Canales | \`src/channels\` | WhatsApp Cloud API, Instagram DM, Mercado Libre (webhooks + envio) |
| HTTP | \`src/app.ts\`, \`src/routes\` | Express: \`/health\`, \`/api/chat\` (+ \`/config\`, \`/reset\`), \`/webhooks/*\`, \`/demo\`; errores \`{ success:false, error:{ code, message, details } }\` |

## Pasar a Odoo real (\`ODOO_MODE=live\`)

1. Define \`ODOO_URL\`, \`ODOO_DB\`, \`ODOO_USERNAME\` y \`ODOO_PASSWORD\` (API key del usuario de integracion).
2. Apps instaladas en Odoo Community: Inventario, Ventas y CRM. Productos **almacenables** (con seguimiento de inventario).
3. Categorias de producto con los nombres de \`DEFAULT_CATEGORY_MAP\` (\`src/config/env.ts\`) o su equivalente en \`ODOO_CATEGORY_MAP\`.
4. Especificaciones tecnicas en \`description_sale\`, una por linea (\`clave: valor\`):

\`\`\`text
socket: AM4
memory_type: DDR4
form_factors: |ATX|mATX|ITX|
tdp_w: 65
igpu: si
tags: gaming, economico
summary: Frase corta para el cliente
\`\`\`

\`formatSpecText\` (\`src/repositories/odoo/specs.ts\`) genera este texto desde el catalogo mock para migrar los productos.

## Pruebas

\`\`\`bash
npm run typecheck
npm test
\`\`\`
`],
  ["CHANGELOG_SESSION.md", `# CHANGELOG_SESSION

Rama de trabajo: \`development\`. Cada sesión se aplica con \`node apply-update.js\` en la raíz del proyecto
(\`--dry-run\` muestra qué haría sin escribir). El \`apply-update.js\` de cada sesión contiene **solo** los archivos
creados o modificados en ella.

---

## Sesión 2 — Simulador web de chat para demostración (2026-11-17)

Página de demostración en \`http://localhost:3000/demo/\` (HTML + CSS + JS vanilla en un solo archivo, sin frameworks
ni CDNs) para mostrarle al dueño de TECS cómo atiende el asistente y cómo se arma una PC paso a paso.

### Qué incluye el simulador

1. **App de mensajería** con identidad TECS (barra azul marino, acento naranja, logotipo de texto), burbujas
   por canal (verde WhatsApp, degradado Instagram, amarillo Mercado Libre), indicador de escritura, errores con
   botón **Reintentar** y diseño adaptable: en escritorio el panel va al lado; en móvil es un cajón deslizable
   con insignia de progreso (\`3/7\`) en el botón.
2. **Selector de canal** (\`whatsapp | instagram | mercadolibre\`) en la barra superior; envía \`channel\` a
   \`POST /api/chat\`. Cada conversación genera un \`sessionId\` propio (\`demo-<16 hex>\`). **Nueva conversación**
   libera la sesión anterior en el servidor (\`POST /api/chat/reset\`) y abre otra. Cambiar de canal también abre
   una conversación nueva (el servidor guarda el estado por canal + sessionId; mezclar canales confundiría el historial).
3. **Pruebas rápidas** (plegables): armado (“Quiero armar una PC gamer de $800”, oficina, edición, “Muéstrame
   cómo va mi armado”), consultas (“¿Qué cases tienen?”, “Busco una laptop”, “¿Tienen Ryzen 5 5600G?”,
   “¿Tienen Ryzen 7 5700X?” — agotado a propósito) y seguridad de canal (dirección y teléfono, para probar el filtro
   de Mercado Libre). **Visor del armado en vivo**: propósito, presupuesto, barra de gasto, los 7 pasos
   (hecho / siguiente / omitido), compatibilidad (errores y avisos), servicios de ensamblaje, total, diferencia
   contra el presupuesto, tiempo de entrega y el JSON completo. Lo recién elegido se resalta.
4. **\`CHAT_API_KEY\`**: la página consulta \`GET /api/chat/config\`; si el servidor exige clave, abre un modal
   (\`<dialog>\`) para ingresarla, la guarda en \`localStorage\` y la envía en \`x-api-key\`. Ante un \`401\` reabre el
   modal y reenvía el mensaje pendiente al guardar. Un botón con candado permite cambiarla o quitarla.
5. Casilla **“Ver detalle técnico”**: muestra las herramientas que usó el modelo por mensaje y los SKU.

### Archivos

**Nuevos:** \`public/demo/index.html\`, \`src/routes/chat.handlers.ts\`, \`tests/demo-simulator.test.ts\`, \`tests/helpers/fakeLlm.ts\`

**Modificados:** \`src/app.ts\` (sirve \`/demo\` con \`express.static\`, CSP y \`nosniff\`), \`src/routes/chat.routes.ts\`
(ahora delgado: delega en \`chat.handlers.ts\`), \`src/services/ConversationService.ts\` (\`build\` en el resultado + \`reset\`),
\`src/services/PCBuildEngine.ts\` (\`view()\` y tipo \`PCBuildView\`), \`src/container.ts\` (inyecta el motor a la conversación),
\`src/config/env.ts\` (\`DEMO_ENABLED\`), \`src/server.ts\` (log con la URL del demo), \`.env.example\`, \`README.md\`, \`CHANGELOG_SESSION.md\`

### Contrato HTTP (cambios)

| Ruta | Auth | Descripción |
| --- | --- | --- |
| \`GET /demo/\` | no | Simulador (solo si \`DEMO_ENABLED=true\`) |
| \`GET /api/chat/config\` | no | \`{ requiresApiKey, storeName, mode, geminiConfigured, maxMessageChars }\`. Nunca devuelve la clave |
| \`POST /api/chat\` | \`x-api-key\` si hay clave | **Nuevo campo \`data.build\`**: \`PCBuildView\` o \`null\` si no hay armado en curso |
| \`POST /api/chat/reset\` | \`x-api-key\` si hay clave | Body \`{ sessionId, channel? }\` → \`{ sessionId, channel, reset }\` (\`reset:false\` si ya no existía) |

\`data.build\` (\`PCBuildView\`): \`purpose\`, \`budgetUsd\`, \`selected[{category,sku,name,priceUsd}]\`, \`nextStep\`, \`remainingSteps\`,
\`gpuOptional\`, \`gpuSkipped\`, \`spentUsd\`, \`complete\`, \`services[]\`, \`subtotalUsd\`, \`servicesUsd\`, \`totalUsd\`, \`deliveryEta\`,
\`budgetDeltaUsd\`, \`issues[{code,severity,message,categories}]\`, \`updatedAt\`. Los servicios solo se suman al completar el armado.
Los errores siguen el formato \`{ success:false, error:{ code, message, details } }\`.

### Variables de entorno nuevas

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| \`DEMO_ENABLED\` | no | \`true\` | \`false\` desactiva \`/demo\`. Valor inválido ⇒ \`CONFIG_ERROR\` al arrancar |

(\`CHAT_API_KEY\` ya existía y ahora también protege \`/api/chat/reset\`.)

### Decisiones de diseño

- **Lógica fuera de Express:** \`chat.handlers.ts\` contiene funciones puras (\`handleChat\`, \`handleReset\`, \`getChatConfig\`);
  las rutas solo adaptan \`req\`/\`res\`. Así la autenticación, validación y forma de respuesta se probaron sin depender de Express.
- **La vista del armado es informativa:** si \`engine.view()\` falla (p. ej. Odoo caído al listar servicios), la respuesta al
  cliente sigue su curso con \`build: null\` y se registra un aviso.
- **Seguridad de la página:** todo el texto (incluidas las respuestas del modelo) se inserta como nodos de texto, nunca como HTML;
  CSP restrictiva (\`default-src 'none'\`, solo scripts/estilos en línea, \`connect-src 'self'\`); sin recursos externos.
  La clave de API vive solo en \`localStorage\` del navegador de quien la escribe.
- **Colores e identidad:** no se dispone del manual de marca de TECS; los colores son provisionales y están en variables CSS al
  inicio del archivo (\`--navy\`, \`--blue\`, \`--orange\`), y el logotipo es texto. Basta cambiarlos ahí.
- **Seguridad en producción:** \`/demo\` es una página estática pública; lo sensible es \`/api/chat\`. Sin \`CHAT_API_KEY\` esa ruta
  queda abierta (el servidor ya lo advierte al arrancar en producción). Para una instalación en producción sin demo: \`DEMO_ENABLED=false\`.

### Verificación realizada

- \`tsc\` estricto: 0 errores. **131 pruebas** (21 nuevas) pasan: vista del armado (vacío / en curso / completo / sin GPU),
  reinicio por canal + sessionId, fallo de la vista sin tumbar la respuesta, autenticación (4 claves inválidas), validación del
  cuerpo, \`debug\` según entorno, \`config\` sin filtrar la clave, \`DEMO_ENABLED\`, y revisiones estáticas del HTML (sin URLs externas,
  JS que compila, sin \`eval\`/HTML dinámico, ids existentes y únicos, categorías del visor = categorías del motor).
- Pruebas de mutación: 5 regresiones introducidas a propósito (reset que no borra, auth omitida, vista sin filtro de “sin armado”,
  \`build\` descartado, cabecera \`x-api-key\` cambiada); las 5 fueron detectadas.
- **Prueba de punta a punta en Chrome headless** contra los handlers reales (\`ConversationService\`, motor, catálogo mock) con un LLM
  simulado: armado completo de 7 pasos con total y servicios, cambio a Mercado Libre (teléfono y enlace eliminados), error 502 con
  “Reintentar”, nueva conversación, y flujo de clave (modal automático, clave errónea ⇒ modal con mensaje, clave correcta ⇒ reenvío
  automático, persistencia tras recargar, quitar clave). Escritorio 1280×820 y móvil 390×844 sin desbordamiento horizontal.
  **Con la CSP real activa: 0 violaciones ni errores de consola.**

### Lo que NO se pudo verificar

- **\`express.static\` y las cabeceras en \`app.ts\` con Express real** (sin red para \`npm install\`): se comprobó con tipos de apoyo y,
  para la página, con un servidor \`node:http\` que aplica la misma CSP. Primer paso: \`npm install && npm run dev\` y abrir \`/demo/\`.
- **Gemini real:** la prueba usó un modelo simulado; la latencia y el texto reales pueden variar (tiempo de espera del navegador: 120 s).
- **Navegadores:** probado en Chrome (escritorio y emulación móvil). No se probó en Safari ni Firefox.

### Pendientes / siguientes pasos sugeridos

1. \`Dockerfile\`, \`docker-compose.yml\`, \`install.sh\`: la imagen **debe copiar \`public/\`** además de \`dist/\` y \`data/\` (el servidor lo busca en \`<raíz>/public\`).
2. Límite de tasa por IP en \`/api/chat\` (protege el costo de Gemini; el simulador lo hace más fácil de alcanzar).
3. Logotipo y colores oficiales de TECS en el simulador.
4. Pendientes de la sesión 1 (abajo).

---

## Sesión 1 — Estructura base del backend (2026-11-17)

Rama de trabajo: \`development\` (partía solo con \`README.md\` y \`.gitignore\`).
Aplicar con \`node apply-update.js\` en la raíz del proyecto (\`--dry-run\` para ver qué haría sin escribir).

### Resumen

Backend completo en Node.js + TypeScript + Express con patrón adaptador \`ODOO_MODE=mock | live\`:
catálogo mock (35 productos + 3 servicios), \`MockRepository\`, \`OdooRepository\` (XML-RPC propio, sin dependencias),
servicio de Gemini con Function Calling, motor de armado de PC en memoria, adaptadores de canal
(WhatsApp, Instagram, Mercado Libre) y suite de pruebas.

### Archivos

**Modificados (ya existían):** \`README.md\` (reemplazado por guía de inicio), \`.gitignore\` (mismas 4 reglas + \`coverage/\` y archivos de leads mock).

**Raíz:** \`package.json\`, \`tsconfig.json\`, \`tsconfig.build.json\`, \`.env.example\`, \`CHANGELOG_SESSION.md\`

**Datos:** \`data/catalog.mock.json\`

**\`src/\` — arranque y HTTP:** \`server.ts\`, \`app.ts\`, \`container.ts\` (composición de dependencias), \`routes/{health,chat,webhooks}.routes.ts\`, \`middleware/errorHandler.ts\`

**\`src/config\`, \`src/types\`, \`src/utils\`:** \`config/env.ts\`, \`types/{domain,api,llm}.ts\`, \`utils/{errors,logger,text,validators}.ts\`

**\`src/repositories\` (patrón adaptador):** \`IInventoryRepository.ts\`, \`matching.ts\`, \`MockRepository.ts\`, \`index.ts\` (fábrica según \`ODOO_MODE\`), \`odoo/{xmlrpc,OdooClient,specs,OdooRepository}.ts\`

**\`src/services\` (lógica de negocio):** \`compatibility.ts\`, \`curation.ts\`, \`CatalogService.ts\`, \`PCBuildEngine.ts\`, \`SessionStore.ts\`, \`ConversationService.ts\`

**\`src/ai\`:** \`prompt.ts\`, \`tools.ts\`, \`ToolExecutor.ts\`, \`GeminiService.ts\`, \`GoogleGenAiClient.ts\`, \`history.ts\`, \`replyGuard.ts\`

**\`src/channels\`:** \`types.ts\`, \`WhatsAppAdapter.ts\`, \`InstagramAdapter.ts\`, \`MercadoLibreAdapter.ts\`, \`ChannelDispatcher.ts\`, \`metaSignature.ts\`, \`SeenCache.ts\`, \`http.ts\`, \`payload.ts\`

**\`tests/\`:** 7 archivos \`*.test.ts\` + \`helpers/{fixtures,fakeOdoo}.ts\` (servidor Odoo XML-RPC simulado)

### Variables de entorno

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| \`ODOO_MODE\` | no | \`mock\` | \`mock\` o \`live\` |
| \`ODOO_URL\`, \`ODOO_DB\`, \`ODOO_USERNAME\`, \`ODOO_PASSWORD\` | solo \`live\` | — | Conexión XML-RPC (password = API key) |
| \`ODOO_TIMEOUT_MS\` | no | \`15000\` | Timeout por llamada |
| \`ODOO_SPECS_FIELD\` | no | \`description_sale\` | Campo con las especificaciones \`clave: valor\` |
| \`ODOO_CATEGORY_MAP\` | no | ver \`env.ts\` | JSON categoría-bot → categoría Odoo |
| \`ODOO_CREATE_QUOTATION\` | no | \`false\` | Crear además \`sale.order\` borrador |
| \`MOCK_CATALOG_PATH\`, \`MOCK_LEADS_PATH\` | no | \`./data/...\` | Catálogo y leads del modo mock |
| \`GEMINI_API_KEY\` | para atender | — | Sin ella el servidor arranca y responde \`LLM_NOT_CONFIGURED\` |
| \`GEMINI_MODEL\`, \`GEMINI_TEMPERATURE\`, \`GEMINI_MAX_TOOL_ROUNDS\` | no | \`gemini-flash-latest\`, \`0.4\`, \`6\` | Modelo y bucle de herramientas |
| \`SESSION_TTL_MINUTES\`, \`SESSION_MAX_COUNT\`, \`SESSION_MAX_HISTORY_TURNS\` | no | \`120\`, \`5000\`, \`14\` | Memoria de sesiones |
| \`STORE_NAME\`, \`STORE_CITY\`, \`STORE_ADDRESS\`, \`STORE_HOURS\` | no | \`TECS\`, \`Acarigua, Portuguesa\`, vacío | Datos de tienda (dirección/horario solo salen en WhatsApp/Instagram) |
| \`BUILD_DELIVERY_ETA\` | no | \`24 a 48 horas hábiles tras confirmar el pago\` | Tiempo de entrega en cotizaciones |
| \`WHATSAPP_PHONE_NUMBER_ID\`, \`WHATSAPP_ACCESS_TOKEN\`, \`WHATSAPP_VERIFY_TOKEN\` | para ese canal | — | WhatsApp Cloud API |
| \`INSTAGRAM_ACCESS_TOKEN\`, \`INSTAGRAM_VERIFY_TOKEN\` | para ese canal | — | Instagram DM |
| \`META_APP_SECRET\` | **sí en producción** | — | Valida \`X-Hub-Signature-256\` |
| \`META_GRAPH_VERSION\` | no | \`v23.0\` | Versión del Graph API (verificar la vigente) |
| \`MERCADOLIBRE_ACCESS_TOKEN\`, \`_REFRESH_TOKEN\`, \`_CLIENT_ID\`, \`_CLIENT_SECRET\`, \`_SELLER_ID\` | para ese canal | — | Mercado Libre |
| \`CHAT_API_KEY\` | recomendada en producción | — | Protege \`POST /api/chat\` y \`POST /api/chat/reset\` (header \`x-api-key\`) |
| \`DEMO_ENABLED\` | no | \`true\` | Sirve el simulador web en \`/demo\` (sesión 2) |
| \`PORT\`, \`NODE_ENV\`, \`LOG_LEVEL\` | no | \`3000\`, \`development\`, \`info\` | Servidor |

### Decisiones de diseño que conviene conocer

- **Reglas comerciales aplicadas en código, no solo en el prompt:** consulta vaga ⇒ la herramienta responde \`NEEDS_CLARIFICATION\` con las preguntas y no consulta inventario; tope de 3 productos por mensaje (\`DISPLAY_LIMIT_REACHED\`) aunque el modelo encadene búsquedas; los repositorios filtran \`stock > 0\` y recortan a \`limit 5\`.
- **Excepciones deliberadas al filtro de stock** (documentadas en la interfaz): \`lookupByName\`/\`getProductBySku\` devuelven también agotados para poder decir "agotado" con precio exacto, y \`listServices\` (los servicios no tienen stock). Todas conservan el tope de 5.
- **Mercado Libre, defensa en tres capas:** prompt del canal + herramienta \`registrar_visita\` bloqueada + filtro de salida (\`replyGuard\`) que elimina teléfonos, correos, \`@usuarios\`, enlaces/dominios, direcciones y la dirección configurada.
- **Odoo sin dependencias:** códec XML-RPC propio (\`xmlrpc.ts\`) sobre \`fetch\`. Las especificaciones técnicas se leen de líneas \`clave: valor\` en \`description_sale\` y los filtros técnicos (socket, DDR, formato de case) se traducen a dominios \`ilike\`, de modo que el \`limit: 5\` se aplica del lado de Odoo.
- **Aislamiento del SDK:** todo el sistema habla con \`LlmClient\`; solo \`GoogleGenAiClient.ts\` importa \`@google/genai\`. Conserva \`thoughtSignature\` e \`id\` de las llamadas, requisito de los modelos Gemini 3.
- **Compatibilidad:** socket CPU/placa, DDR RAM/placa, formato placa/case, largo de GPU/case y potencia de fuente (TDP + 120 W). Si falta una especificación se emite advertencia, no bloqueo.
- **Presupuesto por paso:** reparto por propósito (gaming/creación/oficina) descontando servicios y redistribuyendo lo ya gastado; si nada cabe, ofrece las 2 más económicas marcadas \`overBudget\`.

### Verificación realizada

- \`tsc\` en modo estricto (\`strict\`, \`noUnusedLocals\`, \`noUnusedParameters\`): 0 errores; \`build\` emite \`dist/server.js\` y el CJS compilado carga.
- 110 pruebas en 22 suites: todas pasan. Incluyen paridad Mock vs Odoo (13 consultas, mismo orden de SKUs) contra un servidor Odoo XML-RPC simulado con evaluador de dominios, y el flujo completo de armado.
- Pruebas de mutación: 12 regresiones introducidas a propósito (quitar filtro de stock, tope de 3, filtro de teléfonos, firma de Meta, etc.), las 12 fueron detectadas.
- Exploración de 42 escenarios (3 propósitos × 7 presupuestos × elección primera/última): 0 callejones sin salida, 0 incompatibilidades.
- Revisión estática: sin \`any\`, sin residuos de otros proyectos, sin secretos, capas de negocio sin dependencia de implementaciones de datos.

### Lo que NO se pudo verificar (sin red para \`npm install\`)

- **Capa Express** (\`app.ts\`, \`routes/\`, \`middleware/\`): comprobada con tipos de apoyo locales, **no ejecutada contra \`express\` real**. Primer paso al instalar: \`npm install && npm run typecheck && npm test && npm run dev\`.
- **\`@google/genai\`**: tipado modelado desde la API pública, no compilado contra el paquete real ni probado contra la API de Gemini. Verifica \`GEMINI_MODEL\` (el alias \`gemini-flash-latest\` cambia de modelo con el tiempo; conviene fijar uno).
- **Odoo, WhatsApp, Instagram y Mercado Libre reales:** probados solo contra simulaciones. Los payloads siguen la documentación de cada plataforma, pero requieren una prueba de punta a punta con credenciales.
- **Catálogo:** modelos reales, pero precios, stock y varias especificaciones (p. ej. largo máximo de GPU de algunos cases) son **valores de demostración** a validar con la tienda.

### Pendientes / siguientes pasos sugeridos

1. \`Dockerfile\`, \`docker-compose.yml\`, \`install.sh\` (entrega "llave en mano").
2. Límite de tasa por usuario/IP (protege el costo de Gemini en \`/api/chat\` y webhooks).
3. Persistir el \`refresh_token\` de Mercado Libre (hoy solo vive en memoria tras renovarse).
4. Sesiones en Redis si se necesita más de una instancia (hoy son en memoria por diseño).
5. Script de migración que cargue \`catalog.mock.json\` a Odoo usando \`formatSpecText\`.
`],
];

function writeOne(relativePath, content) {
  const target = path.join(ROOT, ...relativePath.split('/'));
  const inside = path.relative(ROOT, target);
  if (inside === '' || inside.startsWith('..') || path.isAbsolute(inside)) {
    throw new Error('ruta fuera del proyecto: ' + relativePath);
  }

  let status = 'CREADO';
  if (fs.existsSync(target)) {
    status = fs.readFileSync(target, 'utf8') === content ? 'SIN CAMBIOS' : 'ACTUALIZADO';
  }
  if (!DRY_RUN && status !== 'SIN CAMBIOS') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return status;
}

function main() {
  console.log((DRY_RUN ? '[SIMULACION] ' : '') + 'Proyecto: ' + ROOT);
  const counts = { 'CREADO': 0, 'ACTUALIZADO': 0, 'SIN CAMBIOS': 0 };
  const failures = [];

  for (const [relativePath, content] of FILES) {
    try {
      const status = writeOne(relativePath, content);
      counts[status] += 1;
      if (status !== 'SIN CAMBIOS') console.log('  ' + status.padEnd(11) + ' ' + relativePath);
    } catch (error) {
      failures.push(relativePath);
      console.error('  ERROR       ' + relativePath + ': ' + (error && error.message ? error.message : error));
    }
  }

  console.log('');
  console.log(
    'Resumen: ' + counts['CREADO'] + ' creados, ' + counts['ACTUALIZADO'] + ' actualizados, ' +
    counts['SIN CAMBIOS'] + ' sin cambios, ' + failures.length + ' con error (de ' + FILES.length + ').'
  );

  if (failures.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!DRY_RUN) {
    console.log('');
    console.log('Siguientes pasos:');
    console.log('  1. npm run typecheck && npm test');
    console.log('  2. npm run dev');
    console.log('  3. abre http://localhost:3000/demo/   (DEMO_ENABLED=false lo desactiva)');
    console.log('Detalle de lo entregado: CHANGELOG_SESSION.md');
  }
}

main();
