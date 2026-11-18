import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { MAX_REPO_RESULTS } from '../src/repositories/IInventoryRepository';
import { parseCatalog } from '../src/repositories/MockRepository';
import { CatalogService } from '../src/services/CatalogService';
import { pickSpread } from '../src/services/curation';
import { isAppError } from '../src/utils/errors';
import { loadCatalog, makeMockRepo } from './helpers/fixtures';

describe('catalog.mock.json', () => {
  const catalog = loadCatalog();

  it('tiene ~35 productos reales, 8 cases y los 3 servicios de ensamblaje', () => {
    assert.ok(catalog.products.length >= 33 && catalog.products.length <= 40, `productos: ${catalog.products.length}`);
    assert.equal(catalog.products.filter((p) => p.category === 'case').length, 8);
    assert.deepEqual(catalog.services.map((s) => s.kind).sort(), ['assembly', 'cable_management', 'os_setup']);
    assert.equal(new Set(catalog.products.map((p) => p.sku)).size, catalog.products.length, 'SKUs unicos');
  });

  it('cubre todas las categorias y incluye el caso agotado Ryzen 7 5700X', () => {
    const categories = new Set(catalog.products.map((p) => p.category));
    for (const c of ['cpu', 'motherboard', 'ram', 'storage', 'gpu', 'psu', 'case', 'laptop']) {
      assert.ok(categories.has(c as never), `falta categoria ${c}`);
    }
    assert.equal(catalog.products.find((p) => p.sku === 'CPU-R7-5700X')?.stock, 0);
  });

  it('todas las piezas de armado declaran las specs que exige la compatibilidad', () => {
    for (const p of catalog.products) {
      if (p.category === 'cpu') assert.ok(p.specs.socket && p.specs.tdp_w !== undefined && p.specs.igpu !== undefined, p.sku);
      if (p.category === 'motherboard') assert.ok(p.specs.socket && p.specs.memory_type && p.specs.form_factor, p.sku);
      if (p.category === 'ram') assert.ok(p.specs.memory_type, p.sku);
      if (p.category === 'gpu') assert.ok(p.specs.tdp_w && p.specs.gpu_length_mm && p.specs.recommended_psu_w, p.sku);
      if (p.category === 'psu') assert.ok(p.specs.wattage_w, p.sku);
      if (p.category === 'case') assert.ok(p.specs.form_factors && p.specs.max_gpu_length_mm, p.sku);
    }
  });

  it('parseCatalog reporta todos los problemas juntos', () => {
    assert.throws(
      () => parseCatalog({ products: [{ sku: 'X' }, { sku: 'Y', name: 'y', category: 'zzz' }], services: [] }),
      (error: unknown) => isAppError(error) && error.code === 'CONFIG_ERROR' && Array.isArray(error.details) && error.details.length === 2,
    );
  });
});

describe('MockRepository', () => {
  const temp = makeMockRepo();
  after(() => temp.cleanup());
  const { repo } = temp;

  it('NUNCA devuelve mas de 5 registros ni productos sin stock', async () => {
    const all = await repo.searchProducts({});
    assert.ok(all.length <= MAX_REPO_RESULTS);
    const huge = await repo.searchProducts({ category: 'case', limit: 999 });
    assert.equal(huge.length, MAX_REPO_RESULTS);
    assert.ok(huge.every((p) => p.stock > 0));
    const anyOutOfStock = (await repo.searchProducts({ text: '5700x' })).some((p) => p.sku === 'CPU-R7-5700X');
    assert.equal(anyOutOfStock, false, 'el agotado no aparece en busquedas');
  });

  it('filtra por precio, socket, formato y preferencia', async () => {
    const cheap = await repo.searchProducts({ category: 'case', maxPriceUsd: 50 });
    assert.ok(cheap.length > 0 && cheap.every((p) => p.priceUsd <= 50));
    const am4 = await repo.searchProducts({ category: 'cpu', spec: { socket: 'AM4' }, sort: 'price_desc' });
    assert.ok(am4.every((p) => p.specs.socket === 'AM4'));
    assert.deepEqual(am4.map((p) => p.priceUsd), [...am4.map((p) => p.priceUsd)].sort((a, b) => b - a));
    const atx = await repo.searchProducts({ category: 'case', spec: { supportsFormFactor: 'ATX' } });
    assert.ok(atx.every((p) => p.specs.form_factors?.includes('ATX')));
    const gamer = await repo.searchProducts({ category: 'case', keywords: ['gamer'] });
    assert.ok(gamer.length > 0 && gamer.every((p) => p.tags.includes('gamer')));
  });

  it('lookupByName encuentra el modelo exacto aunque este agotado y rankea por relevancia', async () => {
    const [best] = await repo.lookupByName('Ryzen 7 5700X');
    assert.equal(best?.sku, 'CPU-R7-5700X');
    assert.equal(best?.stock, 0);
    const [accent] = await repo.lookupByName('procesador i5-12400f');
    assert.equal(accent, undefined, 'palabra "procesador" no esta en el nombre: sin falsos positivos');
    const [i5] = await repo.lookupByName('i5-12400F');
    assert.equal(i5?.sku, 'CPU-I5-12400F');
    assert.deepEqual(await repo.lookupByName('   '), []);
  });

  it('devuelve copias: mutar un resultado no altera el catalogo', async () => {
    const [first] = await repo.searchProducts({ category: 'cpu' });
    assert.ok(first);
    first.priceUsd = 1;
    first.specs.socket = 'XXX';
    const [again] = await repo.searchProducts({ category: 'cpu' });
    assert.notEqual(again?.priceUsd, 1);
    assert.notEqual(again?.specs.socket, 'XXX');
  });

  it('guarda leads en archivo de forma atomica y concurrente', async () => {
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        repo.createLead({ customerName: `Cliente ${n}`, phone: '0414-1234567', channel: 'whatsapp' }),
      ),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 5);
    const stored = JSON.parse(fs.readFileSync(temp.leadsPath, 'utf8')) as unknown[];
    assert.equal(stored.length, 5);
    assert.equal(fs.existsSync(`${temp.leadsPath}.tmp`), false);
  });
});

describe('CatalogService (curaduria comercial)', () => {
  const temp = makeMockRepo();
  after(() => temp.cleanup());
  const catalog = new CatalogService(temp.repo);

  it('consulta vaga: exige desambiguar y NO consulta el repositorio', async () => {
    await assert.rejects(
      () => catalog.search({ category: 'case' }),
      (error: unknown) =>
        isAppError(error) &&
        error.code === 'NEEDS_CLARIFICATION' &&
        Array.isArray((error.details as { preguntas_sugeridas?: unknown }).preguntas_sugeridas),
    );
  });

  it('con presupuesto devuelve como maximo 3 opciones repartidas por precio', async () => {
    const { products } = await catalog.search({ category: 'case', maxPriceUsd: 200 });
    assert.ok(products.length >= 2 && products.length <= 3);
    const prices = products.map((p) => p.priceUsd);
    assert.deepEqual(prices, [...prices].sort((a, b) => b - a));
  });

  it('si la preferencia no coincide, la ignora y lo avisa', async () => {
    const outcome = await catalog.search({ category: 'case', maxPriceUsd: 200, preference: 'zzzinexistente' });
    assert.equal(outcome.preferenceIgnored, true);
    assert.ok(outcome.products.length > 0);
  });

  it('producto agotado: ofrece como maximo 2 alternativas compatibles y disponibles', async () => {
    const outcome = await catalog.lookup('Ryzen 7 5700X');
    assert.equal(outcome.found, true);
    assert.equal(outcome.available, false);
    assert.ok(outcome.alternatives.length > 0 && outcome.alternatives.length <= 2);
    for (const alt of outcome.alternatives) {
      assert.equal(alt.specs.socket, 'AM4');
      assert.ok(alt.stock > 0);
      assert.notEqual(alt.sku, 'CPU-R7-5700X');
    }
  });

  it('producto disponible: precio exacto y sin alternativas', async () => {
    const outcome = await catalog.lookup('RTX 4060');
    assert.equal(outcome.available, true);
    assert.equal(outcome.match?.priceUsd, 305);
    assert.deepEqual(outcome.alternatives, []);
  });

  it('producto inexistente: found=false', async () => {
    assert.equal((await catalog.lookup('Pentium 4 prescott')).found, false);
  });
});

describe('pickSpread', () => {
  it('reparte alto / medio / bajo y respeta el maximo', () => {
    const items = [10, 20, 30, 40, 50].map((priceUsd) => ({ priceUsd }));
    assert.deepEqual(pickSpread(items).map((i) => i.priceUsd), [50, 30, 10]);
    assert.deepEqual(pickSpread(items, 2).map((i) => i.priceUsd), [50, 10]);
    assert.deepEqual(pickSpread(items.slice(0, 2)).map((i) => i.priceUsd), [20, 10]);
    assert.deepEqual(pickSpread([]), []);
  });
});
