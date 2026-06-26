import { MongoClient, ServerApiVersion, Db } from 'mongodb';

let client: MongoClient;
let db: Db;

export async function connectMongo(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is missing. Copy backend/.env.example to backend/.env');
  }

  client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });

  await client.connect();
  await client.db('admin').command({ ping: 1 });

  const dbName = process.env.MONGODB_DB || 'almahy-ai';
  db = client.db(dbName);
  console.log(`MongoDB connected: ${dbName}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export async function closeMongo(): Promise<void> {
  if (client) await client.close();
}
