const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a password reset email via Resend.
 * @param {string} to - User's email address
 * @param {string} resetLink - Full URL to password reset page with token
 */
async function sendPasswordResetEmail(to, resetLink) {
  try {
    await resend.emails.send({
      from: "SolPulse <onboarding@resend.dev>",
      to,
      subject: 'Reset your password',
      html: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#333">
          <h2 style="color:#10b981;">Reset your password</h2>
          <p>We've received a request to reset your password. Click the button below to set a new password:</p>
          <a href="${resetLink}" 
             style="display:inline-block;margin:20px 0;padding:12px 24px;
                    background:#10b981;color:white;border-radius:6px;
                    text-decoration:none;font-weight:bold;">
            Reset Password
          </a>
          <p>If you did not request this, you can safely ignore this email.</p>
          <p style="font-size:12px;color:#666;">This link will expire in 30 minutes.</p>
        </div>
      `
    });
    console.log(`✅ Reset email sent to ${to}`);
    return true;
  } catch (err) {
    console.error("❌ Failed to send reset email:", err);
    return false;
  }
}


module.exports = { sendPasswordResetEmail }