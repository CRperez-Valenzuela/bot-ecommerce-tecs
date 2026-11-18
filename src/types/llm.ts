/**
 * Transcripcion neutral de la conversacion con el LLM.
 * Aisla al resto del sistema del SDK concreto (@google/genai).
 */
export type LlmPart =
  | { kind: 'text'; text: string; thoughtSignature?: string }
  | {
      kind: 'tool_call';
      id?: string;
      name: string;
      args: Record<string, unknown>;
      thoughtSignature?: string;
    }
  | { kind: 'tool_result'; id?: string; name: string; response: Record<string, unknown> };

export interface LlmMessage {
  role: 'user' | 'model';
  parts: LlmPart[];
}

export interface ToolParamSchema {
  type: 'string' | 'number' | 'boolean';
  description: string;
  enum?: readonly string[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters?: {
    properties: Record<string, ToolParamSchema>;
    required?: readonly string[];
  };
}

export interface LlmGenerateRequest {
  systemInstruction: string;
  messages: LlmMessage[];
  tools: ToolDeclaration[];
  temperature?: number;
  maxOutputTokens?: number;
}

export interface LlmClient {
  generate(request: LlmGenerateRequest): Promise<LlmMessage>;
}
