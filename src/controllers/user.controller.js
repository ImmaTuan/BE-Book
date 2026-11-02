import { pool } from '../config/db.js';
import { id, fail } from '../validation.js';

const fields = [
  'full_name',
  'phone',
  'gender',
  'date_of_birth',
  'shipping_address',
  'shipping_province_id',
  'shipping_province_name',
  'shipping_ward_code',
  'shipping_ward_name',
  'shipping_district_name',
  'shipping_is_new_to_address',
  'loyalty_points',
  'membership_tier',
];
const customerFields = fields.filter(
  (key) => !['loyalty_points', 'membership_tier'].includes(key),
);
const nullable = [
  'phone', 'date_of_birth', 'shipping_address', 'shipping_province_id',
  'shipping_province_name', 'shipping_ward_code', 'shipping_ward_name',
  'shipping_district_name',
];

function validateProfile(body, allowedFields = fields) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    fail('Body phải là JSON object');
  }

  for (const key of Object.keys(body)) {
    if (!allowedFields.includes(key)) {
      fail('Trường không được phép: ' + key);
    }
  }

  if (!Object.keys(body).length) {
    fail('Không có dữ liệu để cập nhật');
  }

  const out = {};
  for (const [key, value] of Object.entries(body)) {
    if (value === null) {
      if (!nullable.includes(key)) fail(key + ' không được null');
      out[key] = null;
      continue;
    }

    if (key === 'full_name') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 255) {
        fail('full_name là bắt buộc và tối đa 255 ký tự');
      }
      out[key] = value.trim();
    } else if (key === 'phone') {
      if (
        typeof value !== 'string' ||
        value.length > 20 ||
        !/^\+?[0-9().\s-]{7,20}$/.test(value)
      ) {
        fail('phone không hợp lệ');
      }
      out[key] = value.trim();
    } else if (key === 'gender') {
      if (!['male', 'female', 'other', 'undisclosed'].includes(value)) {
        fail('gender không hợp lệ');
      }
      out[key] = value;
    } else if (key === 'date_of_birth') {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        fail('date_of_birth phải theo định dạng YYYY-MM-DD');
      }
      const date = new Date(value + 'T00:00:00Z');
      if (
        Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value ||
        value > new Date().toISOString().slice(0, 10)
      ) {
        fail('date_of_birth không hợp lệ hoặc ở tương lai');
      }
      out[key] = value;
    } else if (key === 'shipping_address') {
      if (typeof value !== 'string' || value.length > 1000) {
        fail('shipping_address tối đa 1000 ký tự');
      }
      out[key] = value.trim() || null;
    } else if (key === 'shipping_province_id') {
      if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
        fail('shipping_province_id không hợp lệ');
      }
      out[key] = value;
    } else if (key === 'shipping_is_new_to_address') {
      if (typeof value !== 'boolean') fail('shipping_is_new_to_address phải là boolean');
      out[key] = value ? 1 : 0;
    } else if ([
      'shipping_province_name', 'shipping_ward_code', 'shipping_ward_name',
      'shipping_district_name',
    ].includes(key)) {
      const maxLength = key === 'shipping_ward_code' ? 20 : 255;
      if (typeof value !== 'string' || value.length > maxLength) {
        fail(key + ' tối đa ' + maxLength + ' ký tự');
      }
      out[key] = value.trim() || null;
    } else if (key === 'loyalty_points') {
      if (!Number.isInteger(value) || value < 0 || value > 2147483647) {
        fail('loyalty_points phải là số nguyên không âm');
      }
      out[key] = value;
    } else if (key === 'membership_tier') {
      if (!['bronze', 'silver', 'gold', 'platinum'].includes(value)) {
        fail('membership_tier không hợp lệ');
      }
      out[key] = value;
    }
  }

  return out;
}

async function saveCustomerProfile(userId, data) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      'SELECT id,role,full_name FROM users WHERE id = ? FOR UPDATE',
      [userId],
    );
    const user = rows[0];
    if (!user) fail('Không tìm thấy user', 404);
    if (user.role !== 'customer') {
      fail('Chỉ được thay đổi profile của user có role customer', 403);
    }

    const profileData = { ...data, full_name: data.full_name ?? user.full_name };
    if (data.full_name !== undefined) {
      await connection.execute('UPDATE users SET full_name = ? WHERE id = ?', [
        data.full_name,
        userId,
      ]);
    }

    const [profiles] = await connection.execute(
      'SELECT user_id FROM profiles WHERE user_id = ? FOR UPDATE',
      [userId],
    );
    if (profiles.length) {
      await connection.execute(
        'UPDATE profiles SET ' +
          Object.keys(profileData)
            .map((key) => '`' + key + '` = ?')
            .join(', ') +
          ' WHERE user_id = ?',
        [...Object.values(profileData), userId],
      );
    } else {
      await connection.execute(
        'INSERT INTO profiles (user_id,' +
          Object.keys(profileData)
            .map((key) => '`' + key + '`')
            .join(',') +
          ') VALUES (' +
          Object.keys(profileData)
            .map(() => '?')
            .concat('?')
            .join(',') +
          ')',
        [userId, ...Object.values(profileData)],
      );
    }

    const [updated] = await connection.execute(
      'SELECT * FROM profiles WHERE user_id = ?',
      [userId],
    );
    await connection.commit();
    return updated[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function readCustomerProfile(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM profiles WHERE user_id = ?',
    [userId],
  );
  if (!rows.length) fail('Chưa tìm thấy profile cho user này', 404);
  return rows[0];
}

export async function getCustomerProfile(req, res) {
  const userId = id(req.params.id);
  const [users] = await pool.execute(
    'SELECT id,role FROM users WHERE id = ?',
    [userId],
  );
  if (!users.length) fail('Không tìm thấy user', 404);
  if (users[0].role !== 'customer') {
    fail('Chỉ được xem profile của user có role customer', 403);
  }
  res.json({ data: { profile: await readCustomerProfile(userId) } });
}

export async function getOwnProfile(req, res) {
  res.json({ data: { profile: await readCustomerProfile(req.user.id) } });
}

export async function updateCustomerProfile(req, res) {
  const userId = id(req.params.id);
  const data = validateProfile(req.body);
  const profile = await saveCustomerProfile(userId, data);
  res.json({ message: 'Đã cập nhật profile user', data: { profile } });
}

export async function updateOwnProfile(req, res) {
  const data = validateProfile(req.body, customerFields);
  const profile = await saveCustomerProfile(req.user.id, data);
  res.json({ message: 'Đã cập nhật profile của bạn', data: { profile } });
}
