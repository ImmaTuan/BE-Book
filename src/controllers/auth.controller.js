import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import {
  accessTokenExpiresIn,
  accessTokenExpiresSeconds,
  refreshTokenExpiresIn,
  secret,
} from '../config/auth.js';
import { fail } from '../validation.js';

const registrationFields = ['full_name', 'email', 'password'];
function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createAccessToken(user) {
  return jwt.sign({}, secret(), {
    subject: String(user.id),
    algorithm: 'HS256',
    expiresIn: accessTokenExpiresIn,
    issuer: 'book-backend',
    audience: 'book-app',
  });
}

function createRefreshToken() {
  return randomBytes(48).toString('base64url');
}

function tokenResponse(user, refreshToken) {
  const accessToken = createAccessToken({ id: user.id ?? user.user_id });
  return {
    access_token: accessToken,
    token: accessToken,
    token_type: 'Bearer',
    expires_in: accessTokenExpiresSeconds,
    refresh_token: refreshToken,
    refresh_expires_in: refreshTokenExpiresIn,
    user: {
      id: user.id ?? user.user_id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
  };
}

export async function register(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body phải là JSON object');
  if (Object.keys(body).some((key) => !registrationFields.includes(key))) {
    fail('Chỉ nhận full_name, email và password');
  }

  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!fullName || fullName.length > 255) fail('full_name là bắt buộc và tối đa 255 ký tự');
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail('Email không hợp lệ');
  }
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) {
    fail('Mật khẩu phải có từ 8 đến 200 ký tự');
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.execute(
      "INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, 'customer', 1)",
      [fullName, email, passwordHash],
    );
    await connection.execute('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', [result.insertId, fullName]);
    await connection.commit();
    res.status(201).json({
      message: 'Đăng ký thành công',
      data: { user: { id: result.insertId, full_name: fullName, email, role: 'customer' } },
    });
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') fail('Email đã được sử dụng', 409);
    throw error;
  } finally {
    connection.release();
  }
}

const fallbackHash = await bcrypt.hash('not-a-real-account-password', 12);

export async function login(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Body phải là JSON object');
  if (Object.keys(body).some((key) => !['email', 'password'].includes(key))) fail('Chỉ nhận email và password');
  if (typeof body.email !== 'string' || body.email.length > 254
    || typeof body.password !== 'string' || !body.password || body.password.length > 200) {
    fail('Nhập email và mật khẩu hợp lệ');
  }

  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [body.email.trim().toLowerCase()]);
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(body.password, user?.password_hash || fallbackHash);
  if (!user || !user.is_active || !passwordMatches) fail('Email hoặc mật khẩu không đúng', 401);
  if (!['admin', 'customer'].includes(user.role)) fail('Role tài khoản không hợp lệ', 403);
  if (req.path === '/admin/login' && user.role !== 'admin') {
    fail('Bạn không có quyền truy cập trang Admin', 403);
  }

  const refreshToken = createRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000);
  await pool.execute(
    `INSERT INTO user_login (user_id, refresh_token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [user.id, hashRefreshToken(refreshToken), expiresAt, req.get('user-agent') || null, req.ip || null],
  );

  res.json({
    message: 'Đăng nhập thành công',
    data: tokenResponse(user, refreshToken),
  });
}

export async function refresh(req, res) {
  const refreshToken = req.body?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length < 32 || refreshToken.length > 200) {
    fail('refresh_token không hợp lệ', 401);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      `SELECT l.id AS login_id, l.user_id, u.full_name, u.email, u.role, u.is_active
       FROM user_login AS l
       JOIN users AS u ON u.id = l.user_id
       WHERE l.refresh_token_hash = ?
         AND l.revoked_at IS NULL
         AND l.expires_at > CURRENT_TIMESTAMP
       FOR UPDATE`,
      [hashRefreshToken(refreshToken)],
    );
    const session = rows[0];
    if (!session || !session.is_active) {
      fail('Refresh token không hợp lệ hoặc đã hết hạn', 401);
    }

    const nextRefreshToken = createRefreshToken();
    const expiresAt = new Date(Date.now() + refreshTokenExpiresIn * 1000);
    await connection.execute(
      `UPDATE user_login
       SET refresh_token_hash = ?, expires_at = ?, last_used_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [hashRefreshToken(nextRefreshToken), expiresAt, session.login_id],
    );
    await connection.commit();

    res.json({
      message: 'Làm mới token thành công',
      data: tokenResponse(session, nextRefreshToken),
    });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function logout(req, res) {
  const refreshToken = req.body?.refresh_token;
  if (typeof refreshToken !== 'string' || refreshToken.length < 32 || refreshToken.length > 200) {
    fail('refresh_token không hợp lệ', 400);
  }

  await pool.execute(
    `UPDATE user_login SET revoked_at = CURRENT_TIMESTAMP
     WHERE refresh_token_hash = ? AND revoked_at IS NULL`,
    [hashRefreshToken(refreshToken)],
  );
  res.status(204).end();
}

export function me(req, res) {
  res.json({ data: req.user });
}
