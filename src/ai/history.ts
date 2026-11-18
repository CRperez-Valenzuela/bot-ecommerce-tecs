import type { LlmMessage } from '../types/llm';

/** Un "turno" empieza en un mensaje de usuario con texto (no en un resultado de herramienta). */
function isTurnStart(message: LlmMessage): boolean {
  return message.role === 'user' && message.parts.some((part) => part.kind === 'text');
}

/**
 * Conserva los ultimos `maxTurns` turnos completos. Siempre corta en el inicio de un turno
 * para no dejar llamadas a herramientas sin su resultado (el LLM rechazaria el historial).
 */
export function trimHistory(messages: LlmMessage[], maxTurns: number): LlmMessage[] {
  const starts: number[] = [];
  messages.forEach((message, index) => {
    if (isTurnStart(message)) starts.push(index);
  });
  if (starts.length <= maxTurns) return messages;
  const cutAt = starts[starts.length - maxTurns] ?? 0;
  return messages.slice(cutAt);
}
