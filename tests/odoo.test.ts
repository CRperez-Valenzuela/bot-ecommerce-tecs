import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_CATEGORY_MAP } from '../src/config/env';
import { MAX_REPO_RESULTS } from '../src/repositories/IInventoryRepository';
import { OdooClient } from '../src/repositories/odoo/OdooClient';
import { OdooRepository } from '../src/repositories/odoo/OdooRepository';
import { CatalogService } from '../src/services/CatalogService';
import { PCBuildEngine, createEmptyBuild } from '../src/services/PCBuildEngine';
import type { ProductSearchQuery } from '../src/types/domain';
import { isAppError } from '../src/utils/errors';
import { silentLogger } from '../src/utils/logger';
import type { FakeOdoo } from './helpers/fakeOdoo';
import { FAKE_DB, FAKE_PASSWORD, FAKE_USER, startFakeOdoo } from './helpers/fakeOdoo';
import { loadCatalog, makeMockRepo } from './helpers/fixtures';

describe('OdooRepository (contra un Odoo XML-RPC simulado)', () => {
  let odoo: FakeOdoo;
  let repo: OdooRepository;
  const temp = makeMockRepo();

  const makeRepo = (url: string, extra: Partial<{ createQuotation: boolean; password: string }> = {}): OdooRepository =>
    new OdooRepository(
      new OdooClient({ url, db: FAKE_DB, username: FAKE_USER, password: extra.password ?? FAKE_PASSWORD, timeoutMs: 3000 }),
      { categoryMap: DEFAULT_CATEGORY_MAP, specsField: 'description_sale', createQuotation: extra.createQuotation ?? false },
      silentLogger,
    );

  before(async () => {
    odoo = await startFakeOdoo(loadCatalog());
    repo = makeRepo(odoo.url);
  });
  after(async () => {
    await odoo.close();
    temp.cleanup();
  });

  it('healthCheck autentica y reporta la version', async () => {
    const health = await repo.healthCheck();
    assert.equal(health.ok, true);
    assert.match(health.detail, /17\.0-fake/);
  });

  it('siempre envia qty_available > 0, sale_ok y limit <= 5', async () => {
    odoo.calls.length = 0;
    await repo.searchProducts({ category: 'case', limit: 500 });
    const call = odoo.calls.find((c) => c.method === 'search_read');
    assert.ok(call);
    const domain = JSON.stringify(call.args[0]);
    assert.ok(domain.includes('["qty_available",">",0]'), domain);
    assert.ok(domain.includes('["sale_ok","=",true]'), domain);
    assert.equal(call.kwargs.limit, MAX_REPO_RESULTS);
  });

  it('PARIDAD: Mock y Odoo devuelven lo mismo para las mismas consultas', async () => {
    const queries: ProductSearchQuery[] = [
      { category: 'case', maxPriceUsd: 60, sort: 'price_desc' },
      { category: 'case', maxPriceUsd: 200, keywords: ['gamer'], sort: 'price_desc' },
      { category: 'case', keywords: ['sobrio', 'compacto'], sort: 'price_asc' },
      { category: 'case', spec: { supportsFormFactor: 'ATX' }, sort: 'price_asc' },
      { category: 'cpu', spec: { socket: 'AM4' }, maxPriceUsd: 150, sort: 'price_desc' },
      { category: 'cpu', spec: { socket: 'AM5' }, sort: 'price_asc' },
      { category: 'motherboard', spec: { socket: 'AM4', memoryType: 'DDR4' }, sort: 'price_asc' },
      { category: 'motherboard', spec: { formFactor: 'ATX' }, sort: 'price_asc' },
      { category: 'ram', spec: { memoryType: 'DDR5' }, sort: 'price_asc' },
      { category: 'gpu', minPriceUsd: 200, maxPriceUsd: 400, sort: 'price_asc' },
      { category: 'storage', text: 'kingston', sort: 'price_asc' },
      { category: 'laptop', keywords: ['gaming'], sort: 'price_asc' },
      { text: 'ryzen 5', sort: 'price_asc' },
    ];
    for (const query of queries) {
      const fromMock = (await temp.repo.searchProducts(query)).map((p) => p.sku);
      const fromOdoo = (await repo.searchProducts(query)).map((p) => p.sku);
      assert.deepEqual(fromOdoo, fromMock, `consulta: ${JSON.stringify(query)}`);
      assert.ok(fromOdoo.length <= MAX_REPO_RESULTS);
    }
  });

  it('mapea producto completo: specs, tags, precio y stock', async () => {
    const product = await repo.getProductBySku('CPU-R5-5600G');
    assert.ok(product);
    assert.equal(product.category, 'cpu');
    assert.equal(product.priceUsd, 128);
    assert.equal(product.stock, 6);
    assert.equal(product.specs.socket, 'AM4');
    assert.equal(product.specs.igpu, true);
    assert.equal(product.specs.tdp_w, 65);
    assert.ok(product.tags.includes('oficina'));
    assert.equal(product.brand, 'AMD');
  });

  it('lookupByName devuelve el agotado (stock 0) y getProductBySku null si no existe', async () => {
    const [best] = await repo.lookupByName('Ryzen 7 5700X');
    assert.equal(best?.sku, 'CPU-R7-5700X');
    assert.equal(best?.stock, 0);
    assert.equal(await repo.getProductBySku('NO-EXISTE'), null);
  });

  it('listServices clasifica ensamblaje, cables y sistema operativo', async () => {
    const services = await repo.listServices();
    assert.deepEqual(services.map((s) => s.kind).sort(), ['assembly', 'cable_management', 'os_setup']);
    assert.equal(services.reduce((sum, s) => sum + s.priceUsd, 0), 50);
  });

  it('el motor de armado produce la misma cotizacion con Odoo y con Mock', async () => {
    const run = async (repository: OdooRepository | typeof temp.repo): Promise<number> => {
      const engine = new PCBuildEngine(repository, '24 a 48 horas');
      const build = createEmptyBuild();
      engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
      for (const sku of ['CPU-R5-5600', 'MB-B550M-PRO-VDH', 'RAM-KF-16-D4', 'SSD-SN580-1T', 'GPU-RTX4060-8G', 'PSU-CV650', 'CASE-CM-Q300LV2']) {
        await engine.select(build, sku);
      }
      return (await engine.summarize(build)).totalUsd;
    };
    assert.equal(await run(repo), await run(temp.repo));
  });

  it('la desambiguacion tambien aplica sobre Odoo (no consulta si es vaga)', async () => {
    odoo.calls.length = 0;
    await assert.rejects(() => new CatalogService(repo).search({ category: 'case' }), /amplia/);
    assert.equal(odoo.calls.length, 0);
  });

  it('createLead crea crm.lead con datos, HTML escapado y fecha ISO', async () => {
    odoo.created.length = 0;
    const record = await repo.createLead({
      customerName: 'Ana <script>',
      phone: '0414-1234567',
      channel: 'whatsapp',
      preferredVisit: '2026-12-01',
      notes: 'Quiere "RGB" & silencio',
    });
    assert.equal(record.mode, 'live');
    assert.equal(record.quotationId, null);
    const lead = odoo.created.find((c) => c.model === 'crm.lead');
    assert.ok(lead);
    assert.equal(lead.values.type, 'opportunity');
    assert.equal(lead.values.date_deadline, '2026-12-01');
    assert.equal(lead.values.phone, '0414-1234567');
    const html = String(lead.values.description);
    assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
  });

  it('createLead con cotizacion crea ademas sale.order con lineas y partner', async () => {
    const quoted = makeRepo(odoo.url, { createQuotation: true });
    const engine = new PCBuildEngine(quoted, '24 a 48 horas');
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'office', budgetUsd: 500 });
    for (const sku of ['CPU-R5-5600G', 'MB-B450M-HDV', 'RAM-KF-16-D4', 'SSD-NV2-500', 'PSU-CM-MWE550', 'CASE-TT-VERSA-H18']) {
      if (sku === 'PSU-CM-MWE550') engine.skipGpu(build);
      await engine.select(build, sku);
    }
    odoo.created.length = 0;
    const quote = await engine.buildQuote(build);
    const record = await quoted.createLead({
      customerName: 'Luis',
      phone: '0412-5550000',
      channel: 'instagram',
      quote,
    });
    assert.ok(record.quotationId);
    const order = odoo.created.find((c) => c.model === 'sale.order');
    assert.ok(order, 'se creo sale.order');
    assert.equal((order.values.order_line as unknown[]).length, quote.items.length + quote.services.length);
    assert.ok(odoo.created.some((c) => c.model === 'res.partner'));
    const lead = odoo.created.find((c) => c.model === 'crm.lead');
    assert.equal(lead?.values.expected_revenue, quote.totalUsd);
  });

  it('credenciales invalidas -> ODOO_AUTH_FAILED (sin filtrar la contrasena)', async () => {
    const bad = makeRepo(odoo.url, { password: 'incorrecta' });
    await assert.rejects(
      () => bad.searchProducts({ category: 'cpu' }),
      (error: unknown) => isAppError(error) && error.code === 'ODOO_AUTH_FAILED' && !JSON.stringify(error.details).includes('incorrecta'),
    );
    assert.equal((await bad.healthCheck()).ok, false);
  });

  it('Odoo caido -> ODOO_UNREACHABLE', async () => {
    const down = makeRepo('http://127.0.0.1:1');
    await assert.rejects(
      () => down.searchProducts({ category: 'cpu' }),
      (error: unknown) => isAppError(error) && error.code === 'ODOO_UNREACHABLE',
    );
  });
});
