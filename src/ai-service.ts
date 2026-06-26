import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getPlatformApiKeys, getMessages, addMessage } from './database';

export interface ChatRequest {
  userId: string;
  conversationId: string;
  message: string;
  provider: 'openai' | 'gemini';
  model: string;
}

export async function sendChatMessage(req: ChatRequest) {
  const keys = await getPlatformApiKeys();
  await addMessage(req.conversationId, 'user', req.message);

  const history = (await getMessages(req.conversationId)).filter((m) => m.role !== 'system');
  let responseContent: string;

  if (req.provider === 'openai') {
    if (!keys.openaiKey) {
      throw new Error('Almahy AI is not ready yet. The administrator needs to add an OpenAI API key.');
    }
    responseContent = await chatOpenAI(keys.openaiKey, req.model, history);
  } else {
    if (!keys.geminiKey) {
      throw new Error('Almahy AI is not ready yet. The administrator needs to add a Gemini API key.');
    }
    responseContent = await chatGemini(keys.geminiKey, req.model, history);
  }

  const saved = await addMessage(req.conversationId, 'assistant', responseContent);
  return { content: responseContent, messageId: saved.id };
}

async function chatOpenAI(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model,
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    })),
  });
  return response.choices[0]?.message?.content ?? 'No response received.';
}

async function chatGemini(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const response = await ai.models.generateContent({ model, contents });
  return response.text ?? 'No response received.';
}

export async function testOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const client = new OpenAI({ apiKey });
    await client.models.list();
    return { valid: true };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid OpenAI key' };
  }
}

export async function testGeminiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'Say hi',
    });
    if (!response.text) return { valid: false, error: 'Empty response from Gemini' };
    return { valid: true };
  } catch (err: unknown) {
    return { valid: false, error: formatGeminiError(err) };
  }
}

function formatGeminiError(err: unknown): string {
  if (err instanceof Error) {
    try {
      const parsed = JSON.parse(err.message);
      return parsed?.error?.message ?? err.message;
    } catch {
      return err.message;
    }
  }
  return 'Invalid Gemini key';
}

export const OPENAI_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-mini'];
export const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-2.5-pro',
];
