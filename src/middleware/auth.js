import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { secret } from '../config/auth.js';

const ALLOWED_ROLES = new Set(['customer', 'admin']);

export async function authenticate(req, res, next) {
  const authorization = req.headers.authorization ?? '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Bạn cần đăng nhập trước' });
  }

  let payload;
  try {
    payload = jwt.verify(authorization.slice(7), secret(), {
      algorithms: ['HS256'],
      issuer: 'book-backend',
      audience: 'book-app',
    });
  } catch {
    return res.status(401).json({ message: 'Token không hợp lệ hoặc đã hết hạn. Hãy đăng nhập lại.' });
  }

  if (typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub)) {
    return res.status(401).json({ message: 'Token không hợp lệ' });
  }

  const [rows] = await pool.execute(
    'SELECT id, full_name, email, role, is_active FROM users WHERE id = ?',
    [Number(payload.sub)],
  );
  const user = rows[0];

  if (!user || !user.is_active) {
    return res.status(401).json({ message: 'Tài khoản không tồn tại hoặc đã bị khóa' });
  }
  if (!ALLOWED_ROLES.has(user.role)) {
    return res.status(403).json({ message: 'Role tài khoản không hợp lệ' });
  }

  req.user = user;
  return next();
}

export function requireRole(...roles) {
  const permittedRoles = new Set(roles);
  if ([...permittedRoles].some((role) => !ALLOWED_ROLES.has(role))) {
    throw new Error('requireRole chỉ nhận role customer hoặc admin');
  }

  return function authorizeRole(req, res, next) {
    if (!req.user || !permittedRoles.has(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền truy cập tài nguyên này' });
    }
    return next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireCustomer = requireRole('customer');
