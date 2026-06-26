import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import {
  initDatabase,
  ensureFirebaseUser,
  getUserById,
  savePlatformApiKeys,
  getPlatformApiKeysStatus,
  getWorkspaces,
  createWorkspace,
  getConversations,
  createConversation,
  updateConversationTitle,
  deleteConversation,
  getMessages,
} from './database';
import { sendChatMessage, testOpenAIKey, testGeminiKey, OPENAI_MODELS, GEMINI_MODELS } from './ai-service';
import { requireAuth } from './middleware/auth';
import { requireAdmin } from './middleware/admin';
import { isAdminEmail, DEFAULT_CHAT_PROVIDER, DEFAULT_CHAT_MODEL } from './config';

const PORT = Number(process.env.PORT) || 3847;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'almahy-ai-backend', database: 'mongodb' });
});

app.post('/api/auth/sync', requireAuth, async (req, res) => {
  try {
    const displayName = (req.body.displayName as string) || req.authUser!.displayName;
    const user = await ensureFirebaseUser(req.authUser!.uid, req.authUser!.email, displayName);
    res.json({ success: true, user });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    res.status(500).json({ success: false, error: message });
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await getUserById(req.authUser!.uid);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found' });
    return;
  }
  res.json({ success: true, user });
});

app.get('/api/config/chat', (_req, res) => {
  res.json({
    provider: DEFAULT_CHAT_PROVIDER,
    model: DEFAULT_CHAT_MODEL,
    brandName: 'Almahy AI',
  });
});

app.get('/api/models', requireAuth, requireAdmin, (_req, res) => {
  res.json({ openai: OPENAI_MODELS, gemini: GEMINI_MODELS });
});

app.get('/api/keys/status', requireAuth, requireAdmin, async (_req, res) => {
  res.json(await getPlatformApiKeysStatus());
});

app.post('/api/keys', requireAuth, requireAdmin, async (req, res) => {
  const openaiKey = (req.body.openaiKey as string | null) ?? null;
  const geminiKey = (req.body.geminiKey as string | null) ?? null;
  await savePlatformApiKeys({ openaiKey, geminiKey });
  res.json({ success: true });
});

app.post('/api/keys/test/openai', requireAuth, requireAdmin, async (req, res) => {
  res.json(await testOpenAIKey(req.body.apiKey as string));
});

app.post('/api/keys/test/gemini', requireAuth, requireAdmin, async (req, res) => {
  res.json(await testGeminiKey(req.body.apiKey as string));
});

app.get('/api/workspaces', requireAuth, async (req, res) => {
  res.json(await getWorkspaces(req.authUser!.uid));
});

app.post('/api/workspaces', requireAuth, async (req, res) => {
  const name = (req.body.name as string) || 'My Workspace';
  res.json(await createWorkspace(req.authUser!.uid, name));
});

app.get('/api/workspaces/:id/conversations', requireAuth, async (req, res) => {
  res.json(await getConversations(req.params.id));
});

app.post('/api/workspaces/:id/conversations', requireAuth, async (req, res) => {
  const isAdmin = isAdminEmail(req.authUser!.email);
  const { title, provider, model } = req.body;
  res.json(
    await createConversation(
      req.params.id,
      title ?? 'New Chat',
      isAdmin ? (provider ?? DEFAULT_CHAT_PROVIDER) : DEFAULT_CHAT_PROVIDER,
      isAdmin ? (model ?? DEFAULT_CHAT_MODEL) : DEFAULT_CHAT_MODEL
    )
  );
});

app.patch('/api/conversations/:id', requireAuth, async (req, res) => {
  await updateConversationTitle(req.params.id, req.body.title as string);
  res.json({ success: true });
});

app.delete('/api/conversations/:id', requireAuth, async (req, res) => {
  await deleteConversation(req.params.id);
  res.json({ success: true });
});

app.get('/api/conversations/:id/messages', requireAuth, async (req, res) => {
  res.json(await getMessages(req.params.id));
});

app.post('/api/conversations/:id/chat', requireAuth, async (req, res) => {
  try {
    const isAdmin = isAdminEmail(req.authUser!.email);
    const { message, provider, model, image } = req.body;
    const result = await sendChatMessage({
      userId: req.authUser!.uid,
      conversationId: req.params.id,
      message: (message as string) ?? '',
      provider: isAdmin ? provider : DEFAULT_CHAT_PROVIDER,
      model: isAdmin ? model : DEFAULT_CHAT_MODEL,
      image: image ?? null,
    });
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Chat failed';
    res.status(400).json({ success: false, error });
  }
});

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Almahy AI backend running on port ${PORT}`);
      console.log(`Admin email: ${process.env.ADMIN_EMAIL || 'althakeel.com@gmail.com'}`);
    });
  } catch (err) {
    console.error('Failed to start backend:', err);
    process.exit(1);
  }
}

start();
