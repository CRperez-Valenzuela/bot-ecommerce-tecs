import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { estimateRequiredPsuW, evaluateBuild } from '../src/services/compatibility';
import type { BuildProgress } from '../src/services/PCBuildEngine';
import { PCBuildEngine, createEmptyBuild } from '../src/services/PCBuildEngine';
import type { PCBuildState, Product } from '../src/types/domain';
import { isAppError } from '../src/utils/errors';
import { loadCatalog, makeMockRepo } from './helpers/fixtures';

const ETA = '24 a 48 horas hábiles tras confirmar el pago';

async function rejectsWith(promiseOrFn: Promise<unknown> | (() => unknown), code: string): Promise<void> {
  try {
    await (typeof promiseOrFn === 'function' ? promiseOrFn() : promiseOrFn);
  } catch (error) {
    assert.ok(isAppError(error), `se esperaba AppError, llego: ${String(error)}`);
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`se esperaba el error ${code}`);
}

describe('PCBuildEngine - flujo estrella', () => {
  const temp = makeMockRepo();
  after(() => temp.cleanup());
  const engine = new PCBuildEngine(temp.repo, ETA);

  const chooseFirst = async (build: PCBuildState): Promise<BuildProgress> => {
    const suggestion = await engine.suggest(build);
    const first = suggestion.options[0];
    assert.ok(first, `sin opciones para ${suggestion.category}`);
    return (await engine.select(build, first.product.sku)).progress;
  };

  it('exige proposito y presupuesto antes de sugerir', async () => {
    await rejectsWith(engine.suggest(createEmptyBuild()), 'BUILD_PROFILE_INCOMPLETE');
  });

  it('valida el rango del presupuesto', () => {
    const build = createEmptyBuild();
    assert.throws(() => engine.start(build, { purpose: 'gaming', budgetUsd: 10 }), /presupuesto/i);
    assert.throws(() => engine.start(build, { purpose: 'gaming', budgetUsd: Number.NaN }), /presupuesto/i);
  });

  it('guia paso a paso: max 3 opciones, compatibles y dentro del presupuesto, hasta completar', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 900 });
    const order: string[] = [];

    for (let guard = 0; guard < 10; guard += 1) {
      const suggestion = await engine.suggest(build);
      if (suggestion.category === null) break;
      order.push(suggestion.category);
      assert.ok(suggestion.options.length >= 1 && suggestion.options.length <= 3, `${suggestion.category}: ${suggestion.options.length}`);
      if (!suggestion.overBudget) {
        for (const o of suggestion.options) {
          assert.ok(o.product.priceUsd <= suggestion.budgetForCategoryUsd + 0.01, `${o.product.sku} excede el tope del paso`);
        }
      }
      await chooseFirst(build);
    }
    assert.deepEqual(order, ['cpu', 'motherboard', 'ram', 'storage', 'gpu', 'psu', 'case']);
    assert.equal(engine.isComplete(build), true);

    // Todo lo elegido es mutuamente compatible
    assert.deepEqual(evaluateBuild(build.components).filter((i) => i.severity === 'error'), []);
  });

  it('cotizacion: componentes + servicios desglosados + total + ETA', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
    for (const sku of ['CPU-R5-5600', 'MB-B550M-PRO-VDH', 'RAM-KF-16-D4', 'SSD-SN580-1T', 'GPU-RTX4060-8G', 'PSU-CV650', 'CASE-CM-Q300LV2']) {
      await engine.select(build, sku);
    }
    const summary = await engine.summarize(build);
    assert.equal(summary.complete, true);
    assert.deepEqual(summary.missing, []);
    assert.equal(summary.subtotalUsd, 108 + 108 + 44 + 68 + 305 + 68 + 52);
    assert.deepEqual(summary.services.map((s) => s.sku).sort(), ['SRV-CABLES', 'SRV-ENSAMBLAJE', 'SRV-OS-DRIVERS']);
    assert.equal(summary.servicesUsd, 50);
    assert.equal(summary.totalUsd, summary.subtotalUsd + 50);
    assert.equal(summary.budgetDeltaUsd, summary.totalUsd - 800);
    assert.equal(summary.deliveryEta, ETA);

    const quote = await engine.buildQuote(build);
    assert.equal(quote.totalUsd, summary.totalUsd);
    assert.ok(!('complete' in quote) && !('issues' in quote));
  });

  it('armado incompleto: no suma servicios y buildQuote falla con la lista de faltantes', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'office', budgetUsd: 500 });
    await engine.select(build, 'CPU-R5-5600G');
    const summary = await engine.summarize(build);
    assert.equal(summary.complete, false);
    assert.equal(summary.servicesUsd, 0);
    assert.deepEqual(summary.missing, ['motherboard', 'ram', 'storage', 'gpu', 'psu', 'case']);
    await rejectsWith(engine.buildQuote(build), 'BUILD_INCOMPLETE');
  });

  it('bloquea incompatibilidades con el motivo y sin modificar el estado', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
    await engine.select(build, 'MB-B550M-PRO-VDH'); // AM4 + DDR4 + mATX
    const before = JSON.stringify(build.components);

    await rejectsWith(engine.select(build, 'CPU-R5-7600'), 'INCOMPATIBLE_COMPONENT'); // AM5
    await rejectsWith(engine.select(build, 'RAM-KF-16-D5'), 'INCOMPATIBLE_COMPONENT'); // DDR5
    assert.equal(JSON.stringify(build.components), before);

    // Sugerencias respetan la plataforma elegida
    for (const o of (await engine.suggest(build, 'cpu')).options) assert.equal(o.product.specs.socket, 'AM4');
    for (const o of (await engine.suggest(build, 'ram')).options) assert.equal(o.product.specs.memory_type, 'DDR4');
    for (const o of (await engine.suggest(build, 'case')).options) assert.ok(o.product.specs.form_factors?.includes('mATX'));
  });

  it('fuente insuficiente para la GPU elegida se bloquea; una suficiente pasa', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 1500 });
    await engine.select(build, 'CPU-R7-5700X3D');
    await engine.select(build, 'GPU-RTX4070S-12G'); // recomienda 650 W
    await rejectsWith(engine.select(build, 'PSU-CM-MWE550'), 'INCOMPATIBLE_COMPONENT'); // 550 W
    const ok = await engine.select(build, 'PSU-RM750E');
    assert.equal(ok.progress.selected.some((s) => s.category === 'psu'), true);
    for (const o of (await engine.suggest(build, 'psu')).options) assert.ok((o.product.specs.wattage_w ?? 0) >= 650);
  });

  it('agotados y SKUs inexistentes se rechazan; laptops no entran al armado', async () => {
    const build = createEmptyBuild();
    await rejectsWith(engine.select(build, 'CPU-R7-5700X'), 'OUT_OF_STOCK');
    await rejectsWith(engine.select(build, 'NO-EXISTE'), 'COMPONENT_NOT_FOUND');
    await rejectsWith(engine.select(build, 'LAP-HP-15-FD'), 'VALIDATION_ERROR');
  });

  it('GPU opcional: solo se puede omitir con procesador de video integrado', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'office', budgetUsd: 500 });
    assert.throws(() => engine.skipGpu(build), /procesador/i);
    await engine.select(build, 'CPU-R5-5600'); // sin iGPU
    assert.throws(() => engine.skipGpu(build), /no tiene graficos integrados/);
    await engine.select(build, 'CPU-R5-5600G'); // con iGPU
    const progress = engine.skipGpu(build);
    assert.equal(progress.gpuOptional, true);
    assert.ok(!progress.remainingSteps.includes('gpu'));
    // elegir una GPU despues revierte la omision
    await engine.select(build, 'GPU-RTX3050-6G');
    assert.ok(engine.progress(build).selected.some((s) => s.category === 'gpu'));
  });

  it('cambiar y quitar piezas actualiza el estado', async () => {
    const build = createEmptyBuild();
    await engine.select(build, 'CPU-R5-5600');
    await engine.select(build, 'CPU-R5-5600G'); // reemplaza
    assert.equal(build.components.cpu?.sku, 'CPU-R5-5600G');
    const progress = engine.remove(build, 'cpu');
    assert.equal(progress.selected.length, 0);
    assert.equal(progress.nextStep, 'cpu');
  });

  it('presupuesto insuficiente: marca overBudget y muestra solo las mas economicas', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 60 });
    const suggestion = await engine.suggest(build, 'gpu');
    assert.equal(suggestion.overBudget, true);
    assert.ok(suggestion.options.length > 0 && suggestion.options.length <= 2);
  });

  it('el presupuesto restante se redistribuye segun lo ya gastado', async () => {
    const build = createEmptyBuild();
    engine.start(build, { purpose: 'gaming', budgetUsd: 800 });
    const first = (await engine.suggest(build, 'gpu')).budgetForCategoryUsd;
    await engine.select(build, 'CPU-R5-5600G'); // gasta menos que el tope de CPU
    const afterCheap = (await engine.suggest(build, 'gpu')).budgetForCategoryUsd;
    assert.ok(afterCheap > first, `${afterCheap} deberia superar ${first}`);
  });
});

describe('compatibility', () => {
  const find = (sku: string): Product => {
    const product = loadCatalog().products.find((p) => p.sku === sku);
    assert.ok(product, sku);
    return product;
  };

  it('detecta GPU demasiado larga para el case', () => {
    const longGpu: Product = { ...find('GPU-RTX4060-8G'), specs: { ...find('GPU-RTX4060-8G').specs, gpu_length_mm: 400 } };
    const issues = evaluateBuild({ gpu: longGpu, case: find('CASE-ANTEC-NX200M') });
    assert.equal(issues[0]?.code, 'GPU_TOO_LONG');
  });

  it('detecta formato de placa que no cabe', () => {
    const atxBoard = find('MB-B550-AORUS-ELITE-V2');
    const issues = evaluateBuild({ motherboard: atxBoard, case: find('CASE-CM-Q300LV2') });
    assert.equal(issues[0]?.code, 'FORM_FACTOR_MISMATCH');
  });

  it('avisa (sin bloquear) cuando faltan especificaciones para verificar', () => {
    const noSpecs: Product = { ...find('CPU-R5-5600'), specs: {} };
    const issues = evaluateBuild({ cpu: noSpecs, motherboard: find('MB-B450M-HDV') });
    assert.equal(issues[0]?.code, 'COMPAT_UNVERIFIED');
    assert.equal(issues[0]?.severity, 'warning');
  });

  it('estima la fuente: TDP + 120 W redondeado a 50 y respeta la recomendacion del fabricante', () => {
    assert.equal(estimateRequiredPsuW({ cpu: find('CPU-R5-5600') }), 200);
    assert.equal(estimateRequiredPsuW({ cpu: find('CPU-R5-5600'), gpu: find('GPU-RTX4070S-12G') }), 650);
  });
});
