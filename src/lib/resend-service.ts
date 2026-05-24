import { Resend } from 'resend';
import { emailTemplates } from './email-templates';

// Ensure RESEND_API_KEY is present
if (!process.env.RESEND_API_KEY && process.env.NODE_ENV === 'production') {
  console.error('CRITICAL: Missing RESEND_API_KEY in production');
}

// Initialize Resend client
const resend = new Resend(process.env.RESEND_API_KEY || 'dummy-key');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'noreply@yrdly.ng';
const REPLY_TO  = 'support@yrdly.ng';

export class ResendEmailService {
  /**
   * Check if Resend is properly configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.RESEND_API_KEY &&
      process.env.RESEND_FROM_EMAIL
    );
  }

  /**
   * Generic email sending method
   */
  static async sendEmail(
    to: string,
    subject: string,
    html: string,
    category?: string
  ) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { error } = await resend.emails.send({
      from: `Yrdly <${FROM_EMAIL}>`,
      to: [to],
      replyTo: REPLY_TO,
      subject,
      html,
    });

    if (error) {
      console.error(`[ResendEmailService] Error sending ${category || 'email'} to ${to}:`, error);
      throw new Error(`Failed to send ${category || 'email'}`);
    }
  }

  /**
   * Get configuration status for debugging
   */
  static getConfigurationStatus() {
    return {
      hasApiKey:         !!(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY !== 'your_resend_api_key_here'),
      hasFromEmail:      !!process.env.RESEND_FROM_EMAIL,
      isFullyConfigured: this.isConfigured(),
    };
  }

  /**
   * Generate a manual verification link as fallback
   */
  static generateManualVerificationLink(userId: string, email: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://yrdly-app.vercel.app';
    return `${baseUrl}/onboarding/verify-email?token=${userId}&email=${encodeURIComponent(email)}`;
  }

  /**
   * Send email verification email using Resend with premium template
   */
  static async sendVerificationEmail(email: string, verificationLink: string, userName?: string) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { subject, html } = emailTemplates.verification(email, verificationLink, userName);

    const { error } = await resend.emails.send({
      from:     `Yrdly <${FROM_EMAIL}>`,
      to:       [email],
      replyTo:  REPLY_TO,
      subject,
      html,
      text: `Welcome to Yrdly! Please verify your email here: ${verificationLink}`,
    });

    if (error) {
      console.error('Error sending verification email via Resend:', error);
      throw new Error('RESEND_SEND_FAILED');
    }
  }

  /**
   * Send welcome email using Resend with premium template
   */
  static async sendWelcomeEmail(
    email: string,
    userName: string,
    data: { username: string; location: string }
  ) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { subject, html } = emailTemplates.welcome(userName, data.location);

    const { error } = await resend.emails.send({
      from:    `Yrdly <${FROM_EMAIL}>`,
      to:      [email],
      replyTo: REPLY_TO,
      subject,
      html,
      text: `Welcome to Yrdly, ${userName}! Your account is confirmed.`,
    });

    if (error) {
      console.error('Error sending welcome email via Resend:', error);
      throw new Error('Failed to send welcome email.');
    }
  }

  /**
   * Send password reset email using Resend with premium template
   */
  static async sendPasswordResetEmail(email: string, resetLink: string, userName?: string) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { subject, html } = emailTemplates.passwordReset(email, resetLink, userName);

    const { error } = await resend.emails.send({
      from:    `Yrdly Security <${FROM_EMAIL}>`,
      to:      [email],
      subject,
      html,
      text: `Reset your Yrdly password. Link: ${resetLink}`,
    });

    if (error) {
      console.error('Error sending password reset email via Resend:', error);
      throw new Error('Failed to send password reset email.');
    }
  }

  /**
   * Send event confirmation email using Resend
   */
  static async sendEventConfirmationEmail(data: {
    attendeeEmail:    string;
    attendeeName:     string;
    eventName:        string;
    eventDate?:       string;
    eventTime?:       string;
    eventLocation?:   string;
    eventDescription?: string;
    eventLink?:       string;
  }) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { error } = await resend.emails.send({
      from:    `Yrdly Events <${FROM_EMAIL}>`,
      to:      [data.attendeeEmail],
      subject: `🎉 You're attending: ${data.eventName}!`,
      html: `
        <div style="font-family: sans-serif; padding: 20px;">
          <h2>You're Attending: ${data.eventName}</h2>
          <p>Hi ${data.attendeeName}, you've successfully RSVP'd!</p>
          <p><strong>Date:</strong> ${data.eventDate || 'TBD'}</p>
          <p><strong>Location:</strong> ${data.eventLocation || 'TBD'}</p>
          <a href="${data.eventLink || '#'}" style="background: #388E3C; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Event Details</a>
        </div>
      `,
    });

    if (error) {
      console.error('Error sending event confirmation email via Resend:', error);
      throw new Error('Failed to send event confirmation.');
    }
  }

  /**
   * Send ticket confirmation email using Resend (with QR code)
   */
  static async sendTicketConfirmationEmail(
    attendeeName:  string,
    email:         string,
    eventName:     string,
    tierName:      string,
    ticketId:      string,
    qrUrl:         string,
    dateStr:       string,
    timeStr:       string,
    locationStr:   string,
    orderId:       string
  ) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { subject, html } = emailTemplates.ticketConfirmation(
      attendeeName, email, eventName, tierName,
      ticketId, qrUrl, dateStr, timeStr, locationStr, orderId
    );

    const { error } = await resend.emails.send({
      from:    `Yrdly Events <${FROM_EMAIL}>`,
      to:      [email],
      subject,
      html,
    });

    if (error) {
      console.error('Error sending ticket confirmation email via Resend:', error);
      throw new Error('Failed to send ticket confirmation.');
    }
  }

  /**
   * Send ticket sale notification email to organizer with event stats
   */
  static async sendTicketSaleNotificationEmail(
    organizerEmail: string,
    organizerName:  string,
    eventName:      string,
    attendeeName:   string,
    attendeeEmail:  string,
    tierName:       string,
    amount:         number,
    ticketId:       string,
    eventId?:       string,
    totalSold?:     number,
    grossRevenue?:  number,
    netPayout?:     number
  ) {
    if (!this.isConfigured()) {
      throw new Error('RESEND_NOT_CONFIGURED');
    }

    const { subject, html } = emailTemplates.ticketSaleNotification(
      organizerName, eventName, attendeeName, attendeeEmail, tierName, amount, ticketId,
      eventId, totalSold, grossRevenue, netPayout
    );

    const { error } = await resend.emails.send({
      from:    `Yrdly Events <${FROM_EMAIL}>`,
      to:      [organizerEmail],
      subject,
      html,
    });

    if (error) {
      console.error('Error sending organizer ticket sale notification via Resend:', error);
      throw new Error('Failed to send organizer notification.');
    }
  }
}
