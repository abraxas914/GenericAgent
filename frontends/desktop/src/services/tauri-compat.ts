export function tauriErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isMissingTauriCommand(error: unknown, command: string): boolean {
  const message = tauriErrorText(error).toLowerCase();
  const commandName = command.toLowerCase();
  if (!message.includes(commandName)) return false;
  return [
    'not found',
    'unknown command',
    'does not exist',
    "doesn't exist",
    'not registered',
  ].some((marker) => message.includes(marker));
}
