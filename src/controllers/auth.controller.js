import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
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
import { sendRegistrationOtp } from '../services/email.service.js';

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

  const [[existingUser]] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existingUser) fail('Email đã được sử dụng', 409);

  const [[pendingRegistration]] = await pool.execute(
    `SELECT sent_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND) AS cooldown
     FROM registration_otps WHERE email = ?`, [email],
  );
  if (pendingRegistration?.cooldown) fail('Vui lòng chờ 60 giây trước khi yêu cầu gửi mã mới', 429);

  const passwordHash = await bcrypt.hash(body.password, 12);
  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const otpHash = createHmac('sha256', secret()).update(`${email}:${otp}`).digest('hex');
  await pool.execute(
    `INSERT INTO registration_otps (email, full_name, password_hash, otp_hash, attempts, expires_at, sent_at)
     VALUES (?, ?, ?, ?, 0, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE), CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash),
       otp_hash = VALUES(otp_hash), attempts = 0,
       expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE), sent_at = CURRENT_TIMESTAMP`,
    [email, fullName, passwordHash, otpHash],
  );
  try {
    await sendRegistrationOtp({ email, fullName, otp });
  } catch (error) {
    await pool.execute('DELETE FROM registration_otps WHERE email = ? AND otp_hash = ?', [email, otpHash]);
    console.error('Registration OTP email delivery failed:', error.message);
    fail('Không gửi được email xác minh. Kiểm tra cấu hình SMTP rồi thử lại.', 503);
  }
  res.status(202).json({ message: 'Mã xác minh đã được gửi đến email của bạn. Mã có hiệu lực trong 10 phút.' });
}

export async function resendRegistrationOtp(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'email')) fail('Chỉ nhận email');
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email không hợp lệ');
  const [[pending]] = await pool.execute(
    `SELECT full_name, sent_at > DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 60 SECOND) AS cooldown
     FROM registration_otps WHERE email = ?`, [email],
  );
  if (!pending) fail('Không tìm thấy đăng ký đang chờ xác minh. Hãy nhập lại thông tin đăng ký.', 404);
  if (pending.cooldown) fail('Vui lòng chờ 60 giây trước khi yêu cầu gửi mã mới', 429);

  const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const otpHash = createHmac('sha256', secret()).update(`${email}:${otp}`).digest('hex');
  await pool.execute(
    `UPDATE registration_otps SET otp_hash = ?, attempts = 0,
       expires_at = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 10 MINUTE), sent_at = CURRENT_TIMESTAMP
     WHERE email = ?`, [otpHash, email],
  );
  try {
    await sendRegistrationOtp({ email, fullName: pending.full_name, otp });
  } catch (error) {
    await pool.execute('DELETE FROM registration_otps WHERE email = ? AND otp_hash = ?', [email, otpHash]);
    console.error('Registration OTP email delivery failed:', error.message);
    fail('Không gửi được email xác minh. Kiểm tra cấu hình SMTP rồi thử lại.', 503);
  }
  res.status(202).json({ message: 'Mã xác minh đã được gửi đến email của bạn. Mã có hiệu lực trong 10 phút.' });
}

export async function verifyRegistration(req, res) {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !['email', 'otp'].includes(key))) {
    fail('Chỉ nhận email và mã xác minh');
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const otp = typeof body.otp === 'string' ? body.otp.trim() : '';
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email không hợp lệ');
  if (!/^\d{6}$/.test(otp)) fail('Mã xác minh phải gồm 6 chữ số');

  const [[pending]] = await pool.execute(
    `SELECT full_name, password_hash, otp_hash, attempts,
            expires_at <= CURRENT_TIMESTAMP AS expired
     FROM registration_otps WHERE email = ?`, [email],
  );
  if (!pending) fail('Mã xác minh không tồn tại hoặc đã được sử dụng', 400);
  if (pending.expired) {
    await pool.execute('DELETE FROM registration_otps WHERE email = ?', [email]);
    fail('Mã xác minh đã hết hạn. Hãy yêu cầu gửi mã mới.', 400);
  }
  if (Number(pending.attempts) >= 5) fail('Bạn đã nhập sai mã quá nhiều lần. Hãy yêu cầu gửi mã mới.', 429);
  const expectedHash = createHmac('sha256', secret()).update(`${email}:${otp}`).digest();
  const savedHash = Buffer.from(pending.otp_hash, 'hex');
  if (savedHash.length !== expectedHash.length || !timingSafeEqual(savedHash, expectedHash)) {
    await pool.execute(
      'UPDATE registration_otps SET attempts = attempts + 1 WHERE email = ? AND attempts < 5', [email],
    );
    fail('Mã xác minh không đúng', 400);
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[locked]] = await connection.execute(
      `SELECT full_name, password_hash, otp_hash, attempts,
              expires_at <= CURRENT_TIMESTAMP AS expired
       FROM registration_otps WHERE email = ? FOR UPDATE`, [email],
    );
    if (!locked || locked.expired || Number(locked.attempts) >= 5
      || !timingSafeEqual(Buffer.from(locked.otp_hash, 'hex'), expectedHash)) {
      await connection.rollback();
      fail('Mã xác minh không còn hợp lệ. Hãy yêu cầu gửi mã mới.', 400);
    }
    const [created] = await connection.execute(
      "INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES (?, ?, ?, 'customer', 1)",
      [locked.full_name, email, locked.password_hash],
    );
    await connection.execute('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', [created.insertId, locked.full_name]);
    await connection.execute('DELETE FROM registration_otps WHERE email = ?', [email]);
    await connection.commit();
    res.status(201).json({
      message: 'Xác minh email và đăng ký thành công. Bạn có thể đăng nhập.',
      data: { user: { id: created.insertId, full_name: locked.full_name, email, role: 'customer' } },
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
