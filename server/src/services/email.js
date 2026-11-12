import nodemailer from 'nodemailer';

export async function sendPasswordResetEmail({ to, token }) {
  if (!process.env.MAIL_FROM) return false;
  const origin = (process.env.PUBLIC_APP_URL || process.env.CLIENT_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
  const link = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
  const message = {
    from: process.env.MAIL_FROM,
    to,
    subject: 'Reset your DEVCOLLAB password',
    text: `Use this link to reset your DEVCOLLAB password. It expires in 30 minutes: ${link}`,
    html: `<p>Use the link below to reset your DEVCOLLAB password. It expires in 30 minutes.</p><p><a href="${link}">Reset password</a></p>`,
  };

  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
    return true;
  }

  if (!process.env.SMTP_URL) return false;
  const transporter = nodemailer.createTransport(process.env.SMTP_URL);
  await transporter.sendMail(message);
  return true;
}
