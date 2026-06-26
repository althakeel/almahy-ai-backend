import { Request, Response, NextFunction } from 'express';

const FIREBASE_API_KEY = 'AIzaSyCNilmWe6KWaWeF1Myk5qCe5838Mn8Dzmg';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing auth token' });
    return;
  }

  const idToken = header.slice(7);

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      }
    );

    const data = (await response.json()) as {
      users?: Array<{ localId: string; email?: string; displayName?: string }>;
      error?: { message: string };
    };

    if (!data.users?.[0]) {
      res.status(401).json({
        success: false,
        error: data.error?.message ?? 'Invalid auth token',
      });
      return;
    }

    const fbUser = data.users[0];
    req.authUser = {
      uid: fbUser.localId,
      email: fbUser.email ?? '',
      displayName: fbUser.displayName ?? fbUser.email?.split('@')[0] ?? 'User',
    };
    next();
  } catch {
    res.status(500).json({ success: false, error: 'Auth verification failed' });
  }
}
