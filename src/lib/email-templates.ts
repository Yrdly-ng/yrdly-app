// Custom email templates for better deliverability and branding
export const emailTemplates = {
  verification: (email: string, verificationLink: string, appName: string = 'Yrdly') => ({
    subject: `Welcome to ${appName}! Please verify your email`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verify Your Email - ${appName}</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 20px; text-align: center; }
          .logo { color: white; font-size: 28px; font-weight: bold; margin-bottom: 10px; }
          .tagline { color: rgba(255,255,255,0.9); font-size: 16px; }
          .content { padding: 40px 30px; }
          .title { font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 20px; }
          .message { font-size: 16px; color: #4b5563; line-height: 1.6; margin-bottom: 30px; }
          .button { display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; padding: 15px 30px; border-radius: 8px; font-weight: bold; font-size: 16px; }
          .button:hover { opacity: 0.9; }
          .footer { background-color: #f8fafc; padding: 30px; text-align: center; color: #6b7280; font-size: 14px; }
          .security-note { background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0; color: #92400e; }
          .link-fallback { background-color: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0; font-family: monospace; word-break: break-all; color: #374151; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">${appName}</div>
            <div class="tagline">Your Neighborhood Network</div>
          </div>
          
          <div class="content">
            <h1 class="title">Welcome to ${appName}! 🎉</h1>
            
            <p class="message">
              Hi there!<br><br>
              Thank you for joining ${appName} - your local neighborhood network where neighbors become friends and communities become stronger.
            </p>
            
            <p class="message">
              To get started and access all features, please verify your email address by clicking the button below:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationLink}" class="button">Verify My Email Address</a>
            </div>
            
            <div class="security-note">
              <strong>Security Note:</strong> This verification link will expire in 24 hours for your security. If you didn't create an account with ${appName}, please ignore this email.
            </div>
            
            <p class="message">
              If the button doesn't work, you can also copy and paste this link into your browser:
            </p>
            
            <div class="link-fallback">
              ${verificationLink}
            </div>
            
            <p class="message">
              Once verified, you'll be able to:<br>
              • Connect with your neighbors<br>
              • Buy and sell items locally<br>
              • Discover local events and businesses<br>
              • Build a stronger community
            </p>
            
            <p class="message">
              Welcome to the neighborhood!<br>
              The ${appName} Team
            </p>
          </div>
          
          <div class="footer">
            <p>This email was sent to ${email}</p>
            <p>If you have any questions, please contact our support team.</p>
            <p>&copy; 2024 ${appName}. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `,
    text: `
Welcome to ${appName}!

Thank you for joining ${appName} - your local neighborhood network.

To verify your email address, please click the link below:
${verificationLink}

This verification link will expire in 24 hours for your security.

If you didn't create an account with ${appName}, please ignore this email.

Once verified, you'll be able to:
• Connect with your neighbors
• Buy and sell items locally  
• Discover local events and businesses
• Build a stronger community

Welcome to the neighborhood!
The ${appName} Team

---
This email was sent to ${email}
If you have any questions, please contact our support team.
© 2026 ${appName}. All rights reserved.
    `
  })
};
