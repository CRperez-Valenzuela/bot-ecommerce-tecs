import type { ToolDeclaration } from '../types/llm';
import { BUILD_CATEGORIES, PRODUCT_CATEGORIES } from '../types/domain';

export const TOOL_NAMES = {
  searchProducts: 'buscar_productos',
  lookupProduct: 'consultar_producto',
  startBuild: 'iniciar_armado_pc',
  suggestComponents: 'sugerir_componentes',
  selectComponent: 'elegir_componente',
  removeComponent: 'quitar_componente',
  skipGpu: 'omitir_gpu',
  viewBuild: 'ver_armado',
  registerVisit: 'registrar_visita',
} as const;

const CATEGORY_HELP =
  'cpu=procesador, motherboard=placa madre, ram=memoria, storage=almacenamiento, gpu=tarjeta de video, psu=fuente, case=case/gabinete, laptop=laptop';

/** Declaraciones de funciones expuestas a Gemini (Function Calling). */
export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: TOOL_NAMES.searchProducts,
    description:
      'Busca productos EN STOCK de una categoria para recomendar al cliente (devuelve como maximo 3). ' +
      'Llamala solo cuando ya tengas al menos un criterio: presupuesto, preferencia/uso o texto. ' +
      'Si la consulta del cliente es vaga ("que cases tienen", "busco una laptop"), NO la llames: haz primero 1 o 2 preguntas cerradas.',
    parameters: {
      properties: {
        categoria: { type: 'string', description: `Categoria. ${CATEGORY_HELP}`, enum: PRODUCT_CATEGORIES },
        presupuesto_max_usd: { type: 'number', description: 'Presupuesto maximo en USD para este producto.' },
        preferencia: {
          type: 'string',
          description: 'Uso o estilo que pidio el cliente. Ej: "gamer", "sobrio", "compacto", "oficina", "blanco".',
        },
        texto: { type: 'string', description: 'Marca o modelo parcial. Ej: "Kingston", "B550".' },
      },
      required: ['categoria'],
    },
  },
  {
    name: TOOL_NAMES.lookupProduct,
    description:
      'Consulta un producto puntual por nombre/modelo (ej. "Ryzen 7 5700X", "RTX 4060"): devuelve precio exacto y disponibilidad. ' +
      'Si esta agotado devuelve hasta 2 alternativas disponibles.',
    parameters: {
      properties: { texto: { type: 'string', description: 'Nombre o modelo tal como lo dijo el cliente.' } },
      required: ['texto'],
    },
  },
  {
    name: TOOL_NAMES.startBuild,
    description:
      'Inicia o actualiza el armado de una PC a medida. Llamala cuando el cliente ya dijo el proposito y el presupuesto aproximado.',
    parameters: {
      properties: {
        proposito: {
          type: 'string',
          description: 'gaming = juegos, creation = edicion de video/diseno, office = oficina/estudio.',
          enum: ['gaming', 'creation', 'office'],
        },
        presupuesto_usd: { type: 'number', description: 'Presupuesto total aproximado en USD.' },
        reiniciar: { type: 'boolean', description: 'true para descartar los componentes ya elegidos.' },
      },
      required: ['proposito', 'presupuesto_usd'],
    },
  },
  {
    name: TOOL_NAMES.suggestComponents,
    description:
      'Sugiere 2 o 3 componentes compatibles y dentro del presupuesto para el siguiente paso del armado (o para la categoria indicada).',
    parameters: {
      properties: {
        categoria: {
          type: 'string',
          description: 'Opcional. Si se omite se usa el siguiente paso pendiente.',
          enum: BUILD_CATEGORIES,
        },
      },
    },
  },
  {
    name: TOOL_NAMES.selectComponent,
    description:
      'Guarda en el armado el componente que eligio el cliente. Valida stock y compatibilidad; si es incompatible devuelve el motivo.',
    parameters: {
      properties: { sku: { type: 'string', description: 'SKU exacto devuelto por una herramienta anterior.' } },
      required: ['sku'],
    },
  },
  {
    name: TOOL_NAMES.removeComponent,
    description: 'Quita un componente del armado (por ejemplo, si el cliente quiere cambiarlo).',
    parameters: {
      properties: { categoria: { type: 'string', description: 'Categoria a quitar.', enum: BUILD_CATEGORIES } },
      required: ['categoria'],
    },
  },
  {
    name: TOOL_NAMES.skipGpu,
    description:
      'Continua el armado SIN tarjeta de video dedicada. Solo aplica si el procesador elegido tiene graficos integrados.',
  },
  {
    name: TOOL_NAMES.viewBuild,
    description:
      'Devuelve el resumen del armado actual: componentes, subtotal y, si esta completo, servicios de ensamblaje, total y tiempo de entrega.',
  },
  {
    name: TOOL_NAMES.registerVisit,
    description:
      'Registra el lead del cliente para visitar la tienda fisica (con la cotizacion si el armado esta completo). ' +
      'Requiere nombre y telefono que el cliente haya dado. NO disponible en Mercado Libre.',
    parameters: {
      properties: {
        nombre_cliente: { type: 'string', description: 'Nombre del cliente.' },
        telefono: { type: 'string', description: 'Telefono de contacto del cliente.' },
        fecha_preferida: { type: 'string', description: 'Dia/hora preferida para la visita, en texto libre.' },
        notas: { type: 'string', description: 'Notas utiles para el vendedor.' },
      },
      required: ['nombre_cliente', 'telefono'],
    },
  },
];
