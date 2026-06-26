import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDb, connectMongo } from './mongo';
import { isAdminEmail, ADMIN_EMAIL, DEFAULT_CHAT_PROVIDER, DEFAULT_CHAT_MODEL } from './config';

const PLATFORM_CONFIG_ID = 'main';

const ENCRYPTION_ALGO = 'aes-256-gcm';
const DATA_DIR = path.join(__dirname, '../data');

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  isAdmin: boolean;
}

export interface Workspace {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  workspaceId: string;
  title: string;
  provider: 'openai' | 'gemini';
  model: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  image?: MessageImage | null;
  createdAt: string;
}

export interface MessageImage {
  mimeType: string;
  data: string;
}

export interface ApiKeys {
  openaiKey: string | null;
  geminiKey: string | null;
}

function platformConfig() {
  return getDb().collection('platform_config');
}

function mapUser(row: {
  _id: string;
  email: string;
  displayName: string;
  createdAt: string;
}): User {
  return {
    id: row._id,
    email: row.email,
    displayName: row.displayName,
    createdAt: row.createdAt,
    isAdmin: isAdminEmail(row.email),
  };
}

function users() {
  return getDb().collection('users');
}

function apiKeys() {
  return getDb().collection('api_keys');
}

function workspaces() {
  return getDb().collection('workspaces');
}

function conversations() {
  return getDb().collection('conversations');
}

function messages() {
  return getDb().collection('messages');
}

function getEncryptionKey(): Buffer {
  const fromEnv = process.env.ENCRYPTION_SECRET;
  if (fromEnv) {
    return crypto.createHash('sha256').update(fromEnv).digest();
  }

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const keyPath = path.join(DATA_DIR, '.key');
  if (fs.existsSync(keyPath)) return fs.readFileSync(keyPath);
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key);
  return key;
}

function tryDecrypt(encryptedText: string): string | null {
  try {
    return decrypt(encryptedText);
  } catch {
    return null;
  }
}

function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function initDatabase(): Promise<void> {
  await connectMongo();

  await users().createIndex({ email: 1 }, { unique: true });
  await apiKeys().createIndex({ userId: 1 }, { unique: true });
  await workspaces().createIndex({ userId: 1 });
  await conversations().createIndex({ workspaceId: 1, updatedAt: -1 });
  await messages().createIndex({ conversationId: 1, createdAt: 1 });
}

export async function ensureFirebaseUser(
  firebaseUid: string,
  email: string,
  displayName: string
): Promise<User> {
  const now = new Date().toISOString();
  const normalizedEmail = email.toLowerCase();

  const existing = await users().findOne({ _id: firebaseUid });
  if (existing) {
    await users().updateOne(
      { _id: firebaseUid },
      { $set: { email: normalizedEmail, displayName, updatedAt: now } }
    );
    await ensureUserSetup(firebaseUid);
    if (isAdminEmail(normalizedEmail)) {
      await migrateAdminKeysToPlatform(firebaseUid);
    }
    return mapUser({
      _id: firebaseUid,
      email: normalizedEmail,
      displayName,
      createdAt: existing.createdAt as string,
    });
  }

  await users().deleteMany({ email: normalizedEmail, _id: { $ne: firebaseUid } });

  await users().insertOne({
    _id: firebaseUid,
    email: normalizedEmail,
    displayName,
    createdAt: now,
  });

  await ensureUserSetup(firebaseUid);

  if (isAdminEmail(normalizedEmail)) {
    await migrateAdminKeysToPlatform(firebaseUid);
  }

  return mapUser({ _id: firebaseUid, email: normalizedEmail, displayName, createdAt: now });
}

async function migrateAdminKeysToPlatform(adminUserId: string): Promise<void> {
  const platform = await platformConfig().findOne({ _id: PLATFORM_CONFIG_ID });
  if (platform?.openaiKey || platform?.geminiKey) return;

  const adminKeys = await getApiKeys(adminUserId);
  if (!adminKeys.openaiKey && !adminKeys.geminiKey) return;

  await savePlatformApiKeys(adminKeys);
}

async function ensureUserSetup(userId: string): Promise<void> {
  const keys = await apiKeys().findOne({ userId });
  if (!keys) {
    await apiKeys().insertOne({ userId, openaiKey: null, geminiKey: null });
  }

  const workspace = await workspaces().findOne({ userId });
  if (!workspace) {
    await workspaces().insertOne({
      _id: uuidv4(),
      userId,
      name: 'My Workspace',
      createdAt: new Date().toISOString(),
    });
  }
}

export async function getUserById(userId: string): Promise<User | null> {
  const row = await users().findOne({ _id: userId });
  if (!row) return null;
  return mapUser({
    _id: row._id as string,
    email: row.email as string,
    displayName: row.displayName as string,
    createdAt: row.createdAt as string,
  });
}

export async function savePlatformApiKeys(keys: ApiKeys): Promise<void> {
  const current = await getPlatformApiKeys();
  const openai = keys.openaiKey ?? current.openaiKey;
  const gemini = keys.geminiKey ?? current.geminiKey;

  await platformConfig().updateOne(
    { _id: PLATFORM_CONFIG_ID },
    {
      $set: {
        openaiKey: openai ? encrypt(openai) : null,
        geminiKey: gemini ? encrypt(gemini) : null,
        defaultProvider: DEFAULT_CHAT_PROVIDER,
        defaultModel: DEFAULT_CHAT_MODEL,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );
}

export async function getPlatformApiKeys(): Promise<ApiKeys> {
  let keys: ApiKeys = { openaiKey: null, geminiKey: null };

  const row = await platformConfig().findOne({ _id: PLATFORM_CONFIG_ID });
  if (row?.openaiKey || row?.geminiKey) {
    keys = {
      openaiKey: row.openaiKey ? tryDecrypt(row.openaiKey as string) : null,
      geminiKey: row.geminiKey ? tryDecrypt(row.geminiKey as string) : null,
    };
  } else {
    const adminUser = await users().findOne({ email: ADMIN_EMAIL });
    if (adminUser) {
      keys = await getApiKeys(adminUser._id as string);
    }
  }

  return {
    openaiKey: keys.openaiKey ?? process.env.OPENAI_API_KEY ?? null,
    geminiKey: keys.geminiKey ?? process.env.GEMINI_API_KEY ?? null,
  };
}

export async function getPlatformApiKeysStatus(): Promise<{ hasOpenai: boolean; hasGemini: boolean }> {
  const keys = await getPlatformApiKeys();
  return { hasOpenai: !!keys.openaiKey, hasGemini: !!keys.geminiKey };
}

export async function saveApiKeys(userId: string, keys: ApiKeys): Promise<void> {
  const current = await getApiKeys(userId);
  const openai = keys.openaiKey ?? current.openaiKey;
  const gemini = keys.geminiKey ?? current.geminiKey;

  await apiKeys().updateOne(
    { userId },
    {
      $set: {
        openaiKey: openai ? encrypt(openai) : null,
        geminiKey: gemini ? encrypt(gemini) : null,
      },
    },
    { upsert: true }
  );
}

export async function getApiKeys(userId: string): Promise<ApiKeys> {
  const row = await apiKeys().findOne({ userId });
  if (!row) return { openaiKey: null, geminiKey: null };
  return {
    openaiKey: row.openaiKey ? tryDecrypt(row.openaiKey as string) : null,
    geminiKey: row.geminiKey ? tryDecrypt(row.geminiKey as string) : null,
  };
}

export async function getApiKeysStatus(userId: string): Promise<{ hasOpenai: boolean; hasGemini: boolean }> {
  const row = await apiKeys().findOne({ userId });
  return { hasOpenai: !!row?.openaiKey, hasGemini: !!row?.geminiKey };
}

export async function getWorkspaces(userId: string): Promise<Workspace[]> {
  const rows = await workspaces().find({ userId }).sort({ createdAt: 1 }).toArray();
  return rows.map((r) => ({
    id: r._id as string,
    userId: r.userId as string,
    name: r.name as string,
    createdAt: r.createdAt as string,
  }));
}

export async function createWorkspace(userId: string, name: string): Promise<Workspace> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await workspaces().insertOne({ _id: id, userId, name, createdAt: now });
  return { id, userId, name, createdAt: now };
}

export async function getConversations(workspaceId: string): Promise<Conversation[]> {
  const rows = await conversations().find({ workspaceId }).sort({ updatedAt: -1 }).toArray();
  return rows.map((r) => ({
    id: r._id as string,
    workspaceId: r.workspaceId as string,
    title: r.title as string,
    provider: r.provider as 'openai' | 'gemini',
    model: r.model as string,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  }));
}

export async function createConversation(
  workspaceId: string,
  title: string,
  provider: 'openai' | 'gemini',
  model: string
): Promise<Conversation> {
  const id = uuidv4();
  const now = new Date().toISOString();
  await conversations().insertOne({
    _id: id,
    workspaceId,
    title,
    provider,
    model,
    createdAt: now,
    updatedAt: now,
  });
  return { id, workspaceId, title, provider, model, createdAt: now, updatedAt: now };
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<void> {
  const now = new Date().toISOString();
  await conversations().updateOne({ _id: conversationId }, { $set: { title, updatedAt: now } });
}

export async function deleteConversation(conversationId: string): Promise<void> {
  await messages().deleteMany({ conversationId });
  await conversations().deleteOne({ _id: conversationId });
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const rows = await messages().find({ conversationId }).sort({ createdAt: 1 }).toArray();
  return rows.map((r) => ({
    id: r._id as string,
    conversationId: r.conversationId as string,
    role: r.role as 'user' | 'assistant' | 'system',
    content: r.content as string,
    image: (r.image as MessageImage | undefined) ?? null,
    createdAt: r.createdAt as string,
  }));
}

export async function addMessage(
  conversationId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  image?: MessageImage | null
): Promise<Message> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const doc: Record<string, unknown> = { _id: id, conversationId, role, content, createdAt: now };
  if (image) doc.image = image;
  await messages().insertOne(doc);
  await conversations().updateOne({ _id: conversationId }, { $set: { updatedAt: now } });
  return { id, conversationId, role, content, image: image ?? null, createdAt: now };
}
