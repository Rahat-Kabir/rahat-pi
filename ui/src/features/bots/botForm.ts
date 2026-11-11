import type { CreateBotRequest } from '@api';

// Builds the create-bot request from the form fields, or an error line when the
// values cannot make a valid bot. The brain validates again; this keeps the form honest.
export type BotFormResult = { request: CreateBotRequest } | { error: string };

export function buildCreateBotRequest(name: string, persona: string, model: string): BotFormResult {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { error: 'Name the bot first.' };
  }
  const trimmedPersona = persona.trim();
  if (trimmedPersona.length > 2000) {
    return { error: 'The persona must be at most 2000 characters.' };
  }
  if (model !== 'main' && model !== 'helper') {
    return { error: 'Pick the main or the helper model.' };
  }
  return {
    request: {
      name: trimmedName,
      ...(trimmedPersona ? { persona: trimmedPersona } : {}),
      model,
    },
  };
}
