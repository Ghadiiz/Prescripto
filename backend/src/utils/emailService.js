import { Resend } from 'resend';
import validator from 'validator';

let resendClient = null;
const getResend = () => {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  resendClient = new Resend(apiKey);
  return resendClient;
};

const sendEmail = async ({ to, subject, html }) => {
  const client = getResend();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY not set — skipping email to ${to} ("${subject}")`);
    return { success: false, skipped: true };
  }
  try {
    const { data, error } = await client.emails.send({
      from: process.env.EMAIL_FROM || 'onboarding@resend.dev',
      to,
      subject,
      html,
    });
    if (error) {
      console.error('[email] Resend returned an error:', error);
      return { success: false, error };
    }
    return { success: true, id: data?.id };
  } catch (err) {
    console.error('[email] Failed to send email:', err.message);
    return { success: false, error: err };
  }
};

export const sendVerificationEmail = async (email, name, token) => {
  const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  const safeName = validator.escape(name || '');

  const subject = 'Verify Your Email - Prescripto';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #5f6fff; margin-bottom: 20px;">Welcome to Prescripto! 🏥</h2>
        <p style="font-size: 16px; color: #333;">Hi <strong>${safeName}</strong>,</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          Thank you for registering with Prescripto. Please verify your email address by clicking the button below:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${verificationUrl}"
             style="display: inline-block; padding: 14px 30px; background-color: #5f6fff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
            Verify Email Address
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">Or copy and paste this link in your browser:</p>
        <p style="color: #5f6fff; font-size: 14px; word-break: break-all;">${verificationUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          This link will expire in 24 hours. If you didn't create an account, please ignore this email.
        </p>
        <p style="color: #999; font-size: 12px;">
          © ${new Date().getFullYear()} Prescripto. All rights reserved.
        </p>
      </div>
    </div>
  `;

  return await sendEmail({ to: email, subject, html });
};

export const sendPasswordResetEmail = async (email, name, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  const safeName = validator.escape(name || '');

  const subject = 'Reset Your Password - Prescripto';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #5f6fff; margin-bottom: 20px;">Password Reset Request 🔐</h2>
        <p style="font-size: 16px; color: #333;">Hi <strong>${safeName}</strong>,</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          We received a request to reset your password. Click the button below to set a new password:
        </p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}"
             style="display: inline-block; padding: 14px 30px; background-color: #5f6fff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
            Reset Password
          </a>
        </div>
        <p style="font-size: 14px; color: #666;">Or copy and paste this link in your browser:</p>
        <p style="color: #5f6fff; font-size: 14px; word-break: break-all;">${resetUrl}</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          This link will expire in 30 minutes. If you didn't request a password reset, please ignore this email.
        </p>
        <p style="color: #999; font-size: 12px;">
          © ${new Date().getFullYear()} Prescripto. All rights reserved.
        </p>
      </div>
    </div>
  `;

  return await sendEmail({ to: email, subject, html });
};

export const sendAdminCreatedEmail = async (email, name, password) => {
  const loginUrl = `${process.env.ADMIN_PANEL_URL || 'http://localhost:5174'}`;
  const safeName = validator.escape(name || '');
  const safeEmail = validator.escape(email || '');

  const subject = 'Admin Account Created - Prescripto';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #5f6fff; margin-bottom: 20px;">Welcome to Prescripto Admin! 👨‍💼</h2>
        <p style="font-size: 16px; color: #333;">Hi <strong>${safeName}</strong>,</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          You have been added as an administrator for Prescripto. You can now manage doctors, appointments, and view analytics.
        </p>

        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin-top: 0;">Your Login Credentials:</h3>
          <p style="margin: 10px 0;"><strong>Email:</strong> ${safeEmail}</p>
          <p style="margin: 10px 0;"><strong>Temporary Password:</strong> <code style="background-color: #e0e0e0; padding: 4px 8px; border-radius: 4px; font-size: 14px;">${password}</code></p>
        </div>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${loginUrl}"
             style="display: inline-block; padding: 14px 30px; background-color: #5f6fff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
            Login to Admin Panel
          </a>
        </div>

        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #856404; font-size: 14px;">
            <strong>⚠️ Important:</strong> Please change your password immediately after logging in for security purposes.
          </p>
        </div>

        <p style="color: #666; font-size: 14px;">Admin Panel URL:</p>
        <p style="color: #5f6fff; font-size: 14px; word-break: break-all;">${loginUrl}</p>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          If you didn't expect this email, please contact the system administrator.
        </p>
        <p style="color: #999; font-size: 12px;">
          © ${new Date().getFullYear()} Prescripto. All rights reserved.
        </p>
      </div>
    </div>
  `;

  return await sendEmail({ to: email, subject, html });
};

export const sendDoctorSetPasswordEmail = async (email, name, token) => {
  const setPasswordUrl = `${process.env.ADMIN_PANEL_URL || 'http://localhost:5174'}/doctor/set-password?token=${token}`;
  const safeName = validator.escape(name || '');
  const safeEmail = validator.escape(email || '');

  const subject = 'Welcome to Prescripto - Set Your Password';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
      <div style="background-color: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
        <h2 style="color: #5f6fff; margin-bottom: 20px;">Welcome to Prescripto, Dr. ${safeName}! 👨‍⚕️</h2>
        <p style="font-size: 16px; color: #333;">Hi <strong>Dr. ${safeName}</strong>,</p>
        <p style="font-size: 16px; color: #333; line-height: 1.6;">
          You have been added to Prescripto as a doctor. To get started, please set your password by clicking the button below:
        </p>

        <div style="text-align: center; margin: 30px 0;">
          <a href="${setPasswordUrl}"
             style="display: inline-block; padding: 14px 30px; background-color: #5f6fff; color: white; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">
            Set Your Password
          </a>
        </div>

        <p style="font-size: 14px; color: #666;">Or copy and paste this link in your browser:</p>
        <p style="color: #5f6fff; font-size: 14px; word-break: break-all;">${setPasswordUrl}</p>

        <div style="background-color: #e8f5e9; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #2e7d32; font-size: 14px;">
            <strong>📧 Login Email:</strong> ${safeEmail}
          </p>
        </div>

        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        <p style="color: #999; font-size: 12px;">
          This link will expire in 7 days. If you didn't expect this email, please contact the administrator.
        </p>
        <p style="color: #999; font-size: 12px;">
          © ${new Date().getFullYear()} Prescripto. All rights reserved.
        </p>
      </div>
    </div>
  `;

  return await sendEmail({ to: email, subject, html });
};
