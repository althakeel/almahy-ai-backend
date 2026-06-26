# Almahy AI Backend

Node.js API for the Almahy AI desktop app. Handles Firebase auth verification, MongoDB storage, and Gemini/OpenAI chat.

## Setup

```bash
cp .env.example .env
# Edit .env with MongoDB URI, GEMINI_API_KEY, etc.
npm install
npm run build
npm start
```

Development:

```bash
npm run dev
```

Health check: `GET /api/health`

## Environment variables

See `.env.example`.

## Deploy on AWS (EC2)

```bash
npm install
npm run build
pm2 start npm --name almahyai-api -- run start
pm2 save
```

Proxy `/api` through nginx to port `3847`. See `deploy/nginx.conf`.

## License

MIT
