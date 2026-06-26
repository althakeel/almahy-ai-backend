export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'althakeel.com@gmail.com').toLowerCase();

export const DEFAULT_CHAT_PROVIDER = 'gemini' as const;
export const DEFAULT_CHAT_MODEL = process.env.DEFAULT_CHAT_MODEL || 'gemini-2.5-flash';

export function isAdminEmail(email: string): boolean {
  return email.toLowerCase() === ADMIN_EMAIL;
}
