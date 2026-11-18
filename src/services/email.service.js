import nodemailer from 'nodemailer';

let cachedTransport;
let cachedConfigKey;

function mailConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const from = process.env.SMTP_FROM_EMAIL?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from || (user && !pass)) {
    throw new Error('Email chưa được cấu hình. Hãy thiết lập SMTP_HOST, SMTP_PORT, SMTP_FROM_EMAIL và thông tin SMTP_USER/SMTP_PASSWORD.');
  }
  return { host, port, from, user, pass, secure: process.env.SMTP_SECURE === 'true' || port === 465 };
}

function getTransport(config) {
  const key = JSON.stringify(config);
  if (!cachedTransport || cachedConfigKey !== key) {
    cachedTransport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    });
    cachedConfigKey = key;
  }
  return cachedTransport;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function money(value) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Number(value) || 0) + ' ₫';
}

async function send({ to, subject, text, html }) {
  const config = mailConfig();
  const fromName = process.env.SMTP_FROM_NAME?.trim() || 'Nhà sách Mộc';
  return getTransport(config).sendMail({
    from: { name: fromName, address: config.from }, to, subject, text, html,
  });
}

export async function sendRegistrationOtp({ email, fullName, otp }) {
  const safeName = escapeHtml(fullName);
  await send({
    to: email,
    subject: 'Mã xác minh đăng ký Nhà sách Mộc',
    text: `Xin chào ${fullName}, mã xác minh đăng ký của bạn là ${otp}. Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#302b36"><p>Nhà sách Mộc</p><h2>Xác minh địa chỉ email</h2><p>Xin chào ${safeName},</p><p>Nhập mã sau để hoàn tất đăng ký:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#704bc0">${otp}</p><p>Mã có hiệu lực trong <b>10 phút</b>. Không chia sẻ mã này với người khác.</p><p>Nếu bạn không yêu cầu đăng ký, hãy bỏ qua email này.</p></div>`,
  });
}

export async function sendOrderConfirmation({ email, order }) {
  const rows = Array.isArray(order.items) ? order.items : [];
  const itemLines = rows.map((item) => `${item.book_title} × ${item.quantity}: ${money(Number(item.unit_price) * Number(item.quantity))}`);
  const itemHtml = rows.map((item) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(item.book_title)} × ${Number(item.quantity) || 0}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${money(Number(item.unit_price) * Number(item.quantity))}</td></tr>`).join('');
  const paymentMethod = order.payment_method === 'vnpay' ? 'VNPAY' : 'Thanh toán khi nhận hàng (COD)';
  const paymentStatus = order.payment_method === 'vnpay' && order.payment_status !== 'paid'
    ? 'Đang chờ thanh toán. Bạn có thể tiếp tục thanh toán trong mục Đơn hàng của tôi.'
    : order.payment_method === 'vnpay' ? 'Đã thanh toán qua VNPAY.' : 'Thanh toán khi nhận hàng.';
  const shippingFee = order.ghn_status === 'not_configured' || order.ghn_status === 'create_failed'
    || (!order.ghn_order_code && Number(order.shipping_fee) === 0)
    ? 'Cửa hàng sẽ xác nhận phí giao hàng.' : money(order.shipping_fee);
  const subject = `Mộc xác nhận đơn hàng ${order.order_code}`;
  const text = [
    `Xin chào ${order.recipient_name},`,
    `Nhà sách Mộc đã ghi nhận đơn hàng ${order.order_code}.`,
    '', ...itemLines,
    '', `Phí giao hàng: ${shippingFee}`,
    `Tổng thanh toán: ${money(order.total_amount)}`,
    `Phương thức: ${paymentMethod}. ${paymentStatus}`,
    `Người nhận: ${order.recipient_name} · ${order.recipient_phone}`,
    `Địa chỉ: ${order.shipping_address}`,
    '', 'Cảm ơn bạn đã mua sách tại Mộc.',
  ].join('\n');
  await send({
    to: email,
    subject,
    text,
    html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#302b36"><p>Nhà sách Mộc</p><h2>Đơn hàng đã được ghi nhận</h2><p>Xin chào ${escapeHtml(order.recipient_name)}, đơn hàng <b>${escapeHtml(order.order_code)}</b> đã được tạo.</p><table style="width:100%;border-collapse:collapse"><tbody>${itemHtml}</tbody></table><p>Phí giao hàng: <b>${escapeHtml(shippingFee)}</b></p><p>Tổng thanh toán: <b style="color:#704bc0">${money(order.total_amount)}</b></p><p>Thanh toán: ${escapeHtml(paymentMethod)}. ${escapeHtml(paymentStatus)}</p><p>Người nhận: ${escapeHtml(order.recipient_name)} · ${escapeHtml(order.recipient_phone)}<br>Địa chỉ: ${escapeHtml(order.shipping_address)}</p><p>Cảm ơn bạn đã mua sách tại Mộc.</p></div>`,
  });
}

