import * as brevo from '@getbrevo/brevo';

// Initialize Brevo API
const apiInstance = new brevo.TransactionalEmailsApi();
apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY!);

export class BrevoEmailService {
  /**
   * Check if Brevo is properly configured
   */
  static isConfigured(): boolean {
    return !!(
      process.env.BREVO_API_KEY && 
      process.env.BREVO_API_KEY !== 'your_brevo_api_key_here' &&
      process.env.BREVO_FROM_EMAIL
    );
  }

  /**
   * Get configuration status for debugging
   */
  static getConfigurationStatus() {
    return {
      hasApiKey: !!(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== 'your_brevo_api_key_here'),
      hasFromEmail: !!process.env.BREVO_FROM_EMAIL,
      isFullyConfigured: this.isConfigured()
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
   * Send email verification email using Brevo with better error handling
   */
  static async sendVerificationEmail(email: string, verificationLink: string, userName?: string) {
    // Check if Brevo is properly configured
    if (!this.isConfigured()) {
      const configStatus = this.getConfigurationStatus();
      console.warn('Brevo not properly configured:', configStatus);
      throw new Error('BREVO_NOT_CONFIGURED');
    }

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = 'Welcome to Yrdly! Please verify your email';
    sendSmtpEmail.htmlContent = this.getVerificationEmailHTML(email, verificationLink, userName);
    sendSmtpEmail.textContent = this.getVerificationEmailText(email, verificationLink, userName);
    
    // Set sender information
    sendSmtpEmail.sender = { 
      name: 'Yrdly', 
      email: process.env.BREVO_FROM_EMAIL || 'noreply@yrdly.ng' 
    };
    
    // Set recipient
    sendSmtpEmail.to = [{ 
      email: email, 
      name: userName || 'User' 
    }];
    
    // Set reply-to (optional)
    sendSmtpEmail.replyTo = { 
      email: 'support@yrdly.ng', 
      name: 'Yrdly Support' 
    };
    
    try {
      const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
      return result;
    } catch (error: any) {
      console.error('Error sending verification email via Brevo:', error);
      
      // Provide more specific error messages based on the error type
      if (error.status === 401) {
        throw new Error('BREVO_AUTH_FAILED');
      } else if (error.status === 400) {
        throw new Error('BREVO_INVALID_REQUEST');
      } else if (error.status === 429) {
        throw new Error('BREVO_RATE_LIMITED');
      } else if (error.status >= 500) {
        throw new Error('BREVO_SERVER_ERROR');
      } else {
        throw new Error('BREVO_SEND_FAILED');
      }
    }
  }

  /**
   * Send welcome email using Brevo
   */
  static async sendWelcomeEmail(email: string, userName: string, data: {
    username: string;
    location: string;
  }) {
    // Check if Brevo API key is configured
    if (!process.env.BREVO_API_KEY || process.env.BREVO_API_KEY === 'your_brevo_api_key_here') {
      console.warn('Brevo API key not configured, cannot send welcome email');
      throw new Error('BREVO_NOT_CONFIGURED');
    }

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = '🎉 Welcome to Yrdly! Your neighborhood network awaits';
    sendSmtpEmail.htmlContent = this.getWelcomeEmailHTML(data);
    sendSmtpEmail.textContent = this.getWelcomeEmailText(data);
    
    sendSmtpEmail.sender = { 
      name: 'Yrdly', 
      email: process.env.BREVO_FROM_EMAIL || 'noreply@yrdly.ng' 
    };
    
    sendSmtpEmail.to = [{ 
      email: email, 
      name: userName 
    }];
    
    sendSmtpEmail.replyTo = { 
      email: 'support@yrdly.ng', 
      name: 'Yrdly Support' 
    };
    
    try {
      const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
      return result;
    } catch (error) {
      console.error('Error sending welcome email via Brevo:', error);
      throw new Error('Failed to send welcome email. Please try again.');
    }
  }

  /**
   * Send event confirmation email using Brevo
   */
  static async sendEventConfirmationEmail(data: {
    attendeeEmail: string;
    attendeeName: string;
    eventName: string;
    eventDate?: string;
    eventTime?: string;
    eventLocation?: string;
    eventDescription?: string;
    eventLink?: string;
  }) {
    // Check if Brevo API key is configured
    if (!process.env.BREVO_API_KEY || process.env.BREVO_API_KEY === 'your_brevo_api_key_here') {
      console.warn('Brevo API key not configured, cannot send event confirmation email');
      throw new Error('BREVO_NOT_CONFIGURED');
    }

    const sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = `🎉 You're attending: ${data.eventName}!`;
    sendSmtpEmail.htmlContent = this.getEventConfirmationEmailHTML(data);
    sendSmtpEmail.textContent = this.getEventConfirmationEmailText(data);
    
    sendSmtpEmail.sender = { 
      name: 'Yrdly', 
      email: process.env.BREVO_FROM_EMAIL || 'noreply@yrdly.ng' 
    };
    
    sendSmtpEmail.to = [{ 
      email: data.attendeeEmail, 
      name: data.attendeeName 
    }];
    
    sendSmtpEmail.replyTo = { 
      email: 'support@yrdly.ng', 
      name: 'Yrdly Support' 
    };
    
    try {
      const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
      return result;
    } catch (error) {
      console.error('Error sending event confirmation email via Brevo:', error);
      throw new Error('Failed to send event confirmation email. Please try again.');
    }
  }

  /**
   * Send password reset email using Brevo
   */
  static async sendPasswordResetEmail(email: string, resetLink: string, userName?: string) {
    const sendSmtpEmail = new brevo.SendSmtpEmail();
    
    sendSmtpEmail.subject = 'Reset your Yrdly password';
    sendSmtpEmail.htmlContent = this.getPasswordResetEmailHTML(email, resetLink, userName);
    sendSmtpEmail.textContent = this.getPasswordResetEmailText(email, resetLink, userName);
    
    sendSmtpEmail.sender = { 
      name: 'Yrdly', 
      email: process.env.BREVO_FROM_EMAIL || 'noreply@yrdly.ng' 
    };
    
    sendSmtpEmail.to = [{ 
      email: email, 
      name: userName || 'User' 
    }];
    
    try {
      const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
      return result;
    } catch (error) {
      console.error('Error sending password reset email via Brevo:', error);
      throw new Error('Failed to send password reset email. Please try again.');
    }
  }

  /**
   * Get HTML content for verification email
   */
  private static getVerificationEmailHTML(email: string, verificationLink: string, userName?: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - Yrdly</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
            margin: 0; padding: 0; background-color: #f8fafc; 
            line-height: 1.6;
          }
          .container { 
            max-width: 600px; margin: 0 auto; background-color: #ffffff; 
            border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            padding: 50px 30px; text-align: center; 
          }
          .logo { 
            color: white; font-size: 32px; font-weight: bold; margin-bottom: 10px; 
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          }
          .tagline { 
            color: rgba(255,255,255,0.95); font-size: 18px; font-weight: 300; 
          }
          .content { padding: 50px 40px; }
          .title { 
            font-size: 28px; font-weight: bold; color: #1f2937; margin-bottom: 20px; 
            text-align: center;
          }
          .message { 
            font-size: 16px; color: #4b5563; line-height: 1.7; margin-bottom: 30px; 
          }
          .button { 
            display: inline-block; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; text-decoration: none; padding: 18px 36px; 
            border-radius: 10px; font-weight: bold; font-size: 16px; 
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
            transition: all 0.3s ease;
          }
          .button:hover { 
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
          }
          .security-note { 
            background-color: #fef3c7; border-left: 4px solid #f59e0b; 
            border-radius: 8px; padding: 20px; margin: 30px 0; 
            color: #92400e; font-size: 14px;
          }
          .link-fallback { 
            background-color: #f3f4f6; padding: 20px; border-radius: 8px; 
            margin: 25px 0; font-family: 'Monaco', 'Menlo', monospace; 
            word-break: break-all; color: #374151; font-size: 13px;
            border: 1px solid #e5e7eb;
          }
          .footer { 
            background-color: #f8fafc; padding: 40px 30px; text-align: center; 
            color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;
          }
          .features { 
            background-color: #f9fafb; padding: 30px; border-radius: 8px; 
            margin: 30px 0; border: 1px solid #e5e7eb;
          }
          .features h3 { 
            color: #1f2937; margin-bottom: 15px; font-size: 18px; 
          }
          .features ul { 
            margin: 0; padding-left: 20px; color: #4b5563; 
          }
          .features li { 
            margin-bottom: 8px; 
          }
          .button-container { 
            text-align: center; margin: 40px 0; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏘️ Yrdly</div>
            <div class="tagline">Your Neighborhood Network</div>
          </div>
          
          <div class="content">
            <h1 class="title">Welcome to Yrdly! 🎉</h1>
            
            <p class="message">
              Hi${userName ? ` ${userName}` : ''}!<br><br>
              Thank you for joining Yrdly - your local neighborhood network where neighbors become friends and communities become stronger.
            </p>
            
            <p class="message">
              To complete your registration and start connecting with your neighbors, please verify your email address by clicking the button below:
            </p>
            
            <div class="button-container">
              <a href="${verificationLink}" class="button">Verify My Email Address</a>
            </div>
            
            <div class="security-note">
              <strong>🔒 Security Note:</strong> This verification link will expire in 24 hours for your security. If you didn't create an account with Yrdly, please ignore this email.
            </div>
            
            <div class="features">
              <h3>Once verified, you'll be able to:</h3>
              <ul>
                <li>🤝 Connect with your neighbors</li>
                <li>🛒 Buy and sell items locally</li>
                <li>📅 Discover local events and businesses</li>
                <li>💬 Chat with community members</li>
                <li>🏠 Build a stronger neighborhood</li>
              </ul>
            </div>
            
            <p class="message">
              If the button doesn't work, you can also copy and paste this link into your browser:
            </p>
            
            <div class="link-fallback">
              ${verificationLink}
            </div>
            
            <p class="message" style="text-align: center; font-style: italic; color: #6b7280;">
              Welcome to the neighborhood!<br>
              <strong>The Yrdly Team</strong>
            </p>
          </div>
          
          <div class="footer">
            <p>This email was sent to <strong>${email}</strong></p>
            <p>If you have any questions, please contact our support team at support@yrdly.ng</p>
            <p>&copy; 2024 Yrdly. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get text content for verification email
   */
  private static getVerificationEmailText(email: string, verificationLink: string, userName?: string): string {
    return `
Welcome to Yrdly! 🎉

Hi${userName ? ` ${userName}` : ''}!

Thank you for joining Yrdly - your local neighborhood network where neighbors become friends and communities become stronger.

To complete your registration and start connecting with your neighbors, please verify your email address by clicking the link below:

${verificationLink}

🔒 Security Note: This verification link will expire in 24 hours for your security. If you didn't create an account with Yrdly, please ignore this email.

Once verified, you'll be able to:
• Connect with your neighbors
• Buy and sell items locally
• Discover local events and businesses
• Chat with community members
• Build a stronger neighborhood

Welcome to the neighborhood!
The Yrdly Team

---
This email was sent to ${email}
If you have any questions, please contact our support team at support@yrdly.ng
© ${new Date().getFullYear()} Yrdly. All rights reserved.
    `;
  }

  /**
   * Get HTML content for password reset email
   */
  private static getPasswordResetEmailHTML(email: string, resetLink: string, userName?: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Your Password - Yrdly</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
            margin: 0; padding: 0; background-color: #f8fafc; 
          }
          .container { 
            max-width: 600px; margin: 0 auto; background-color: #ffffff; 
            border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            padding: 50px 30px; text-align: center; 
          }
          .logo { 
            color: white; font-size: 32px; font-weight: bold; margin-bottom: 10px; 
          }
          .content { padding: 50px 40px; }
          .title { 
            font-size: 28px; font-weight: bold; color: #1f2937; margin-bottom: 20px; 
            text-align: center;
          }
          .button { 
            display: inline-block; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
            color: white; text-decoration: none; padding: 18px 36px; 
            border-radius: 10px; font-weight: bold; font-size: 16px; 
          }
          .security-note { 
            background-color: #fef3c7; border-left: 4px solid #f59e0b; 
            border-radius: 8px; padding: 20px; margin: 30px 0; 
            color: #92400e; font-size: 14px;
          }
          .footer { 
            background-color: #f8fafc; padding: 40px 30px; text-align: center; 
            color: #6b7280; font-size: 14px; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🏘️ Yrdly</div>
            <div style="color: rgba(255,255,255,0.95); font-size: 18px;">Your Neighborhood Network</div>
          </div>
          
          <div class="content">
            <h1 class="title">Reset Your Password</h1>
            
            <p style="font-size: 16px; color: #4b5563; line-height: 1.7; margin-bottom: 30px;">
              Hi${userName ? ` ${userName}` : ''}!<br><br>
              We received a request to reset your password for your Yrdly account.
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${resetLink}" class="button">Reset My Password</a>
            </div>
            
            <div class="security-note">
              <strong>🔒 Security Note:</strong> This password reset link will expire in 1 hour for your security. If you didn't request this reset, please ignore this email.
            </div>
            
            <p style="font-size: 16px; color: #4b5563; line-height: 1.7; margin-top: 30px;">
              If the button doesn't work, copy and paste this link into your browser:<br>
              <span style="word-break: break-all; color: #374151; font-family: monospace; background: #f3f4f6; padding: 10px; border-radius: 4px; display: inline-block; margin-top: 10px;">${resetLink}</span>
            </p>
          </div>
          
          <div class="footer">
            <p>This email was sent to <strong>${email}</strong></p>
            <p>If you have any questions, please contact our support team at support@yrdly.ng</p>
            <p>&copy; 2024 Yrdly. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get text content for password reset email
   */
  private static getPasswordResetEmailText(email: string, resetLink: string, userName?: string): string {
    return `
Reset Your Password - Yrdly

Hi${userName ? ` ${userName}` : ''}!

We received a request to reset your password for your Yrdly account.

To reset your password, please click the link below:

${resetLink}

🔒 Security Note: This password reset link will expire in 1 hour for your security. If you didn't request this reset, please ignore this email.

If you have any questions, please contact our support team at support@yrdly.ng

© ${new Date().getFullYear()} Yrdly. All rights reserved.
    `;
  }

  /**
   * Get HTML content for event confirmation email
   */
  private static getEventConfirmationEmailHTML(data: {
    attendeeName: string;
    eventName: string;
    eventDate?: string;
    eventTime?: string;
    eventLocation?: string;
    eventDescription?: string;
    eventLink?: string;
  }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Event Confirmation - Yrdly</title>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; 
            margin: 0; padding: 0; background-color: #f8fafc; 
            line-height: 1.6;
          }
          .container { 
            max-width: 600px; margin: 0 auto; background-color: #ffffff; 
            border-radius: 12px; overflow: hidden; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1); 
          }
          .header { 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
            padding: 50px 30px; text-align: center; 
          }
          .logo { 
            color: white; font-size: 32px; font-weight: bold; margin-bottom: 10px; 
            text-shadow: 0 2px 4px rgba(0,0,0,0.3);
          }
          .tagline { 
            color: rgba(255,255,255,0.95); font-size: 18px; font-weight: 300; 
          }
          .content { padding: 50px 40px; }
          .title { 
            font-size: 28px; font-weight: bold; color: #1f2937; margin-bottom: 20px; 
            text-align: center;
          }
          .message { 
            font-size: 16px; color: #4b5563; line-height: 1.7; margin-bottom: 30px; 
          }
          .event-details { 
            background-color: #f0fdf4; border: 2px solid #bbf7d0; 
            border-radius: 12px; padding: 30px; margin: 30px 0; 
          }
          .event-details h3 { 
            color: #065f46; margin-bottom: 20px; font-size: 20px; 
            text-align: center;
          }
          .detail-row { 
            display: flex; margin-bottom: 15px; align-items: center; 
          }
          .detail-label { 
            font-weight: bold; color: #065f46; min-width: 100px; 
          }
          .detail-value { 
            color: #374151; flex: 1; 
          }
          .calendar-button { 
            display: inline-block; 
            background: linear-gradient(135deg, #10b981 0%, #059669 100%); 
            color: white; text-decoration: none; padding: 18px 36px; 
            border-radius: 10px; font-weight: bold; font-size: 16px; 
            box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4);
            transition: all 0.3s ease;
            margin: 20px 10px;
          }
          .calendar-button:hover { 
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(16, 185, 129, 0.6);
          }
          .footer { 
            background-color: #f8fafc; padding: 40px 30px; text-align: center; 
            color: #6b7280; font-size: 14px; border-top: 1px solid #e5e7eb;
          }
          .button-container { 
            text-align: center; margin: 40px 0; 
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">🎉 Event Confirmed!</div>
            <div class="tagline">You're all set for this event</div>
          </div>
          
          <div class="content">
            <h1 class="title">You're Attending: ${data.eventName}</h1>
            
            <p class="message">
              Hi ${data.attendeeName}!<br><br>
              Great news! You've successfully RSVP'd to <strong>${data.eventName}</strong>. We're excited to see you there!
            </p>
            
            <div class="event-details">
              <h3>📅 Event Details</h3>
              ${data.eventDate ? `<div class="detail-row"><span class="detail-label">📅 Date:</span><span class="detail-value">${data.eventDate}</span></div>` : ''}
              ${data.eventTime ? `<div class="detail-row"><span class="detail-label">🕐 Time:</span><span class="detail-value">${data.eventTime}</span></div>` : ''}
              ${data.eventLocation ? `<div class="detail-row"><span class="detail-label">📍 Location:</span><span class="detail-value">${data.eventLocation}</span></div>` : ''}
              ${data.eventDescription ? `<div class="detail-row"><span class="detail-label">📝 Description:</span><span class="detail-value">${data.eventDescription}</span></div>` : ''}
            </div>
            
            <div class="button-container">
              ${data.eventLink ? `<a href="${data.eventLink}" class="calendar-button">View Event Details</a>` : ''}
              <a href="https://yrdly-app.vercel.app/events" class="calendar-button">Browse More Events</a>
            </div>
            
            <p class="message" style="text-align: center; font-style: italic; color: #6b7280;">
              Can't wait to see you there!<br>
              <strong>The Yrdly Team</strong>
            </p>
          </div>
          
          <div class="footer">
            <p>This confirmation was sent to <strong>${data.attendeeName}</strong></p>
            <p>If you have any questions about this event, please contact the event organizer or our support team at support@yrdly.ng</p>
            <p>&copy; 2024 Yrdly. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get text content for event confirmation email
   */
  private static getEventConfirmationEmailText(data: {
    attendeeName: string;
    eventName: string;
    eventDate?: string;
    eventTime?: string;
    eventLocation?: string;
    eventDescription?: string;
    eventLink?: string;
  }): string {
    return `
🎉 Event Confirmation - You're Attending: ${data.eventName}

Hi ${data.attendeeName}!

Great news! You've successfully RSVP'd to ${data.eventName}. We're excited to see you there!

📅 Event Details:
${data.eventDate ? `📅 Date: ${data.eventDate}` : ''}
${data.eventTime ? `🕐 Time: ${data.eventTime}` : ''}
${data.eventLocation ? `📍 Location: ${data.eventLocation}` : ''}
${data.eventDescription ? `📝 Description: ${data.eventDescription}` : ''}

${data.eventLink ? `View Event Details: ${data.eventLink}` : ''}

Can't wait to see you there!
The Yrdly Team

---
This confirmation was sent to ${data.attendeeName}
If you have any questions about this event, please contact the event organizer or our support team at support@yrdly.ng
© ${new Date().getFullYear()} Yrdly. All rights reserved.
    `;
  }

  /**
   * Get welcome email HTML template
   */
  private static getWelcomeEmailHTML(data: { username: string; location: string }): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Yrdly!</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
          .header h1 { color: #ffffff; margin: 0; font-size: 28px; font-weight: 700; }
          .header p { color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px; }
          .content { padding: 40px 20px; }
          .welcome-message { text-align: center; margin-bottom: 30px; }
          .welcome-message h2 { color: #1a202c; font-size: 24px; margin: 0 0 15px 0; }
          .welcome-message p { color: #4a5568; font-size: 16px; line-height: 1.6; margin: 0; }
          .features { display: grid; grid-template-columns: 1fr; gap: 20px; margin: 30px 0; }
          .feature { text-align: center; padding: 20px; background-color: #f7fafc; border-radius: 8px; }
          .feature-icon { font-size: 32px; margin-bottom: 10px; }
          .feature h3 { color: #2d3748; font-size: 18px; margin: 0 0 10px 0; }
          .feature p { color: #4a5568; font-size: 14px; margin: 0; line-height: 1.5; }
          .button-container { text-align: center; margin: 30px 0; }
          .cta-button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 15px 30px; border-radius: 8px; font-weight: 600; font-size: 16px; }
          .cta-button:hover { opacity: 0.9; }
          .footer { background-color: #f7fafc; padding: 30px 20px; text-align: center; border-top: 1px solid #e2e8f0; }
          .footer p { color: #4a5568; font-size: 14px; margin: 5px 0; }
          .footer a { color: #667eea; text-decoration: none; }
          @media (min-width: 600px) {
            .features { grid-template-columns: repeat(2, 1fr); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 Welcome to Yrdly!</h1>
            <p>Your neighborhood network awaits</p>
          </div>
          
          <div class="content">
            <div class="welcome-message">
              <h2>Hello ${data.username}!</h2>
              <p>Welcome to Yrdly, your local community platform. We're excited to have you join the neighborhood network in ${data.location}!</p>
            </div>
            
            <div class="features">
              <div class="feature">
                <div class="feature-icon">🏠</div>
                <h3>Discover Your Feed</h3>
                <p>See what's happening in your neighborhood - events, posts, and updates from your neighbors.</p>
              </div>
              
              <div class="feature">
                <div class="feature-icon">🛍️</div>
                <h3>Local Marketplace</h3>
                <p>Buy and sell items with people in your area. Safe, local, and convenient.</p>
              </div>
              
              <div class="feature">
                <div class="feature-icon">📅</div>
                <h3>Community Events</h3>
                <p>Find and create events happening in your neighborhood. Never miss out on local activities.</p>
              </div>
              
              <div class="feature">
                <div class="feature-icon">👥</div>
                <h3>Connect with Neighbors</h3>
                <p>Build relationships with the people who live around you. A stronger community starts here.</p>
              </div>
            </div>
            
            <div class="button-container">
              <a href="https://yrdly-app.vercel.app/home" class="cta-button">Start Exploring Yrdly</a>
            </div>
            
            <p style="text-align: center; font-style: italic; color: #6b7280;">
              Ready to connect with your neighbors?<br>
              <strong>The Yrdly Team</strong>
            </p>
          </div>
          
          <div class="footer">
            <p>This welcome message was sent to <strong>${data.username}</strong></p>
            <p>If you have any questions, please contact our support team at <a href="mailto:support@yrdly.ng">support@yrdly.ng</a></p>
            <p>&copy; 2024 Yrdly. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  /**
   * Get welcome email text template
   */
  private static getWelcomeEmailText(data: { username: string; location: string }): string {
    return `
🎉 Welcome to Yrdly!

Hello ${data.username}!

Welcome to Yrdly, your local community platform. We're excited to have you join the neighborhood network in ${data.location}!

What you can do on Yrdly:

🏠 Discover Your Feed
   See what's happening in your neighborhood - events, posts, and updates from your neighbors.

🛍️ Local Marketplace
   Buy and sell items with people in your area. Safe, local, and convenient.

📅 Community Events
   Find and create events happening in your neighborhood. Never miss out on local activities.

👥 Connect with Neighbors
   Build relationships with the people who live around you. A stronger community starts here.

Ready to get started? Visit: https://yrdly-app.vercel.app/home

Ready to connect with your neighbors?
The Yrdly Team

---
This welcome message was sent to ${data.username}
If you have any questions, please contact our support team at support@yrdly.ng
© ${new Date().getFullYear()} Yrdly. All rights reserved.
    `;
  }
}
