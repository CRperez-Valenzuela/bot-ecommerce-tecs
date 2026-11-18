import { GoogleGenAI, Type } from '@google/genai';
import type { Content, FunctionDeclaration, GenerateContentResponse, Part, Schema } from '@google/genai';
import type { LlmClient, LlmGenerateRequest, LlmMessage, LlmPart, ToolDeclaration, ToolParamSchema } from '../types/llm';
import { AppError } from '../utils/errors';
import { truncate } from '../utils/text';

export interface GoogleGenAiOptions {
  apiKey: string;
  model: string;
}

const TYPE_MAP: Record<ToolParamSchema['type'], Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
};

function toSchema(param: ToolParamSchema): Schema {
  const schema: Schema = { type: TYPE_MAP[param.type], description: param.description };
  if (param.enum !== undefined) schema.enum = [...param.enum];
  return schema;
}

function toDeclaration(tool: ToolDeclaration): FunctionDeclaration {
  if (tool.parameters === undefined) return { name: tool.name, description: tool.description };
  const properties: Record<string, Schema> = {};
  for (const [name, param] of Object.entries(tool.parameters.properties)) properties[name] = toSchema(param);
  return {
    name: tool.name,
    description: tool.description,
    parameters: {
      type: Type.OBJECT,
      properties,
      required: tool.parameters.required ? [...tool.parameters.required] : [],
    },
  };
}

function toPart(part: LlmPart): Part {
  switch (part.kind) {
    case 'text':
      return part.thoughtSignature ? { text: part.text, thoughtSignature: part.thoughtSignature } : { text: part.text };
    case 'tool_call':
      return {
        functionCall: { id: part.id, name: part.name, args: part.args },
        ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
      };
    case 'tool_result':
      return { functionResponse: { id: part.id, name: part.name, response: part.response } };
  }
}

function toContent(message: LlmMessage): Content {
  return { role: message.role, parts: message.parts.map(toPart) };
}

function fromResponse(response: GenerateContentResponse): LlmMessage {
  const parts: LlmPart[] = [];
  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.functionCall?.name) {
      parts.push({
        kind: 'tool_call',
        id: part.functionCall.id,
        name: part.functionCall.name,
        args: part.functionCall.args ?? {},
        thoughtSignature: part.thoughtSignature,
      });
    } else if (typeof part.text === 'string' && part.text !== '' && part.thought !== true) {
      parts.push({ kind: 'text', text: part.text, thoughtSignature: part.thoughtSignature });
    }
  }
  return { role: 'model', parts };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
    return error.status;
  }
  return undefined;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Adaptador de LlmClient sobre el SDK oficial @google/genai (Gemini API). */
export class GoogleGenAiClient implements LlmClient {
  private readonly ai: GoogleGenAI;

  constructor(private readonly options: GoogleGenAiOptions) {
    this.ai = new GoogleGenAI({ apiKey: options.apiKey });
  }

  async generate(request: LlmGenerateRequest): Promise<LlmMessage> {
    const contents = request.messages.map(toContent);
    const functionDeclarations = request.tools.map(toDeclaration);

    const send = (): Promise<GenerateContentResponse> =>
      this.ai.models.generateContent({
        model: this.options.model,
        contents,
        config: {
          systemInstruction: request.systemInstruction,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          tools: functionDeclarations.length > 0 ? [{ functionDeclarations }] : undefined,
          // El bucle de herramientas lo controla GeminiService (validaciones y tope de productos).
          automaticFunctionCalling: { disable: true },
        },
      });

    try {
      let response: GenerateContentResponse;
      try {
        response = await send();
      } catch (error) {
        const status = statusOf(error);
        if (status === undefined || !RETRYABLE.has(status)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 800));
        response = await send();
      }
      return fromResponse(response);
    } catch (error) {
      const status = statusOf(error);
      if (status === 429) {
        throw new AppError('RATE_LIMITED', 'El servicio de IA esta saturado; intenta de nuevo en un momento', 429);
      }
      throw new AppError('LLM_ERROR', 'Fallo la consulta al modelo de IA', 502, {
        status: status ?? null,
        cause: truncate(error instanceof Error ? error.message : String(error), 300),
      });
    }
  }
}
