#!/usr/bin/env node
'use strict';
/**
 * probe-models.js - prueba que modelos de Gemini responden con TU clave (la del .env).
 * Uso, en la raiz del proyecto:   node probe-models.js gemini-3.8-flash gemini-3.6-flash gemini-flash-latest
 * Sin argumentos prueba GEMINI_MODEL del .env. No muestra la clave. Solo modulos nativos (Node >= 18).
 */
const fs = require('fs');
const path = require('path');

function readEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const buf = fs.readFileSync(file);
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  text = text.replace(/^﻿/, '');
  for (const line of text.split(/\r\n|\n|\r/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || m[0].trim().startsWith('#')) continue;
    let v = m[2];
    if (/^(["']).*\1$/.test(v)) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

async function probe(base, key, model) {
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Responde solo: ok' }] }] }),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - started;
    const body = await res.text();
    if (res.ok) {
      let reply = '';
      try { reply = JSON.parse(body).candidates[0].content.parts.map((p) => p.text || '').join('').trim(); } catch { /* sin texto */ }
      return `${model}: FUNCIONA (${ms} ms) -> "${reply.slice(0, 40)}"`;
    }
    let msg = body;
    try { const e = JSON.parse(body).error; msg = `${e.status}: ${e.message}`; } catch { /* no era JSON */ }
    const meaning = { 404: 'no existe para tu cuenta', 503: 'saturado ahora', 429: 'sin cuota/limite', 401: 'clave rechazada', 403: 'permiso denegado' }[res.status] || '';
    return `${model}: HTTP ${res.status}${meaning ? ' (' + meaning + ')' : ''} (${ms} ms) - ${msg.replace(/\s+/g, ' ').slice(0, 160)}`;
  } catch (error) {
    return `${model}: SIN RESPUESTA (${Date.now() - started} ms) - ${error && error.name === 'TimeoutError' ? 'timeout de 30 s' : error.message}`;
  }
}

async function main() {
  const env = { ...readEnvFile(path.join(process.cwd(), '.env')), ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v)) };
  const key = (env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '').trim();
  if (!key) {
    console.error('No hay GEMINI_API_KEY ni en .env (carpeta actual) ni en el entorno. Ejecuta este script en la raiz del proyecto.');
    process.exit(1);
  }
  console.log(`Clave detectada: ${key.slice(0, 3)}... (${key.length} caracteres)`);
  const models = process.argv.slice(2);
  if (models.length === 0 && env.GEMINI_MODEL) models.push(env.GEMINI_MODEL);
  if (models.length === 0) { console.error('Indica al menos un modelo.'); process.exit(1); }
  const base = process.env.GEMINI_PROBE_BASE_URL || 'https://generativelanguage.googleapis.com';
  for (const model of models) console.log(await probe(base, key, model));
}

main();
