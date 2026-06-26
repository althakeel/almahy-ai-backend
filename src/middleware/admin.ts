import { Request, Response, NextFunction } from 'express';
import { isAdminEmail } from '../config';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.authUser || !isAdminEmail(req.authUser.email)) {
    res.status(403).json({ success: false, error: 'Admin access only' });
    return;
  }
  next();
}
