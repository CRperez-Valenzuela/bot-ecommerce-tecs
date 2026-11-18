import type { LlmClient, LlmGenerateRequest, LlmMessage } from '../../src/types/llm';

export const call = (name: string, args: Record<string, unknown>, id = `call-${name}`): LlmMessage => ({
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
