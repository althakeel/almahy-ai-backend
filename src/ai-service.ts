import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { getPlatformApiKeys, getMessages, addMessage, type MessageImage } from './database';

export interface ChatRequest {
  userId: string;
  conversationId: string;
  message: string;
  provider: 'openai' | 'gemini';
  model: string;
  image?: MessageImage | null;
}

type HistoryMessage = {
  role: string;
  content: string;
  image?: MessageImage | null;
};

export async function sendChatMessage(req: ChatRequest) {
  const keys = await getPlatformApiKeys();
  await addMessage(req.conversationId, 'user', req.message, req.image);

  const history = (await getMessages(req.conversationId)).filter((m) => m.role !== 'system');
  let responseContent: string;

  if (req.provider === 'openai') {
    if (req.image) {
      throw new Error('Image messages are only supported with Gemini.');
    }
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
  messages: HistoryMessage[]
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

function geminiParts(message: HistoryMessage) {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (message.image) {
    parts.push({
      inlineData: {
        mimeType: message.image.mimeType,
        data: message.image.data,
      },
    });
  }
  if (message.content.trim()) {
    parts.push({ text: message.content });
  }
  if (parts.length === 0) {
    parts.push({ text: 'Describe this image.' });
  }
  return parts;
}

async function chatGemini(
  apiKey: string,
  model: string,
  messages: HistoryMessage[]
): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: geminiParts(m),
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
