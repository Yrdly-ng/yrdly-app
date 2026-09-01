import { readFileSync, writeFileSync } from 'node:fs';
import { Resend } from 'resend';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const APP_URL = env.NEXT_PUBLIC_APP_URL || 'https://app.yrdly.ng';
const FROM_EMAIL = env.RESEND_FROM_EMAIL || 'noreply@yrdly.ng';
const SUBJECT = 'Yrdly Daily Security Report — 4 Account Takeovers Detected';
const PREVIEW = process.argv.includes('--preview');
const argRecipients = process.argv.slice(2).filter((a) => a.includes('@'));
const RECIPIENTS = argRecipients.length ? argRecipients : [
  'feranmioyelowo@gmail.com',
  'vickysalami04@gmail.com',
  'Grimmjow2333@gmail.com',
];

const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const stats = [
  { icon: '🎯', count: '47', label: 'Attacks Detected', sub: 'Total attempts observed today', color: '#111827' },
  { icon: '🛡️', count: '43', label: 'Attacks Blocked', sub: 'Neutralized by active defenses', color: '#166534' },
  { icon: '🚨', count: '4', label: 'Takeovers Not Prevented', sub: 'Account takeover attempts noticed but not blocked', color: '#DC2626' },
];

const geo = [
  { flag: '🇩🇰', country: 'Denmark', count: 16, pct: 34, color: '#DC2626' },
  { flag: '🇿🇦', country: 'South Africa', count: 13, pct: 28, color: '#F59E0B' },
  { flag: '🇺🇸', country: 'United States', count: 6, pct: 13, color: '#388E3C' },
  { flag: '🇳🇬', country: 'Nigeria', count: 5, pct: 11, color: '#388E3C' },
  { flag: '🇩🇪', country: 'Germany', count: 4, pct: 8, color: '#388E3C' },
  { flag: '🌍', country: 'Other', count: 3, pct: 6, color: '#9CA3AF' },
];

const renderStats = () => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:24px;"><tr>
  ${stats.map(c => `
  <td width="33.33%" valign="top" style="padding-right:10px;" class="stack">
    <div style="background-color:#F9FAFB;border:1px solid #E5E7EB;border-top:3px solid ${c.color === '#DC2626' ? '#DC2626' : c.color === '#166534' ? '#388E3C' : '#0F172A'};border-radius:10px;padding:18px 14px;">
      <div style="font-size:20px;margin-bottom:8px;">${c.icon}</div>
      <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:30px;font-weight:800;color:${c.color};line-height:1;">${c.count}</div>
      <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:12px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:0.5px;margin:8px 0 6px;">${c.label}</div>
      <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:11.5px;color:#6B7280;line-height:1.5;">${c.sub}</div>
    </div>
  </td>`).join('')}
</tr></table>`;

const renderGeo = () => geo.map(g => `
  <tr>
    <td style="padding:9px 0;border-bottom:1px solid #F3F4F6;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td width="150" style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:13px;font-weight:700;color:#111827;white-space:nowrap;">${g.flag} ${g.country}</td>
        <td>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F3F4F6;border-radius:999px;height:18px;"><tr>
            <td width="${g.pct}%" bgcolor="${g.color}" style="background-color:${g.color};border-radius:999px;height:18px;font-size:0;line-height:0;">&nbsp;</td>
            <td>&nbsp;</td>
          </tr></table>
        </td>
        <td width="70" align="right" style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:13px;font-weight:800;color:#374151;white-space:nowrap;">${g.count} <span style="font-weight:600;color:#9CA3AF;">(${g.pct}%)</span></td>
      </tr></table>
    </td>
  </tr>`).join('');

const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${SUBJECT}</title>
<style>@media only screen and (max-width:620px){.container{width:100%!important;border-radius:0!important}.px{padding-left:20px!important;padding-right:20px!important}.stack{display:block!important;width:100%!important;padding-right:0!important;padding-bottom:12px}.h1{font-size:22px!important}.bar-label{width:100%!important;display:block!important;padding-bottom:6px}}</style>
</head><body style="margin:0;padding:0;background-color:#F3F4F6;-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Daily report: 47 attacks detected, 43 blocked. 4 account takeovers were noticed but could not be prevented. Most attacks originated from Denmark and South Africa.</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F3F4F6;padding:32px 12px;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="container" style="max-width:600px;width:100%;background-color:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

<tr><td align="center" class="px" style="background-color:#0F172A;padding:28px 40px;">
  <img src="${APP_URL}/logo.png" alt="Yrdly" width="120" style="display:block;margin:0 auto 14px;"/>
  <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:2.5px;color:#94A3B8;text-transform:uppercase;">Daily Security Report — ${dateStr}</div>
</td></tr>
<tr><td style="background-color:#F59E0B;padding:12px 40px;" class="px">
  <span style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:14px;font-weight:800;color:#FFFFFF;letter-spacing:1px;">📋 DAILY REPORT — ATTENTION ADVISED</span>
</td></tr>

<tr><td class="px" style="padding:36px 40px 8px;">
  <h1 class="h1" style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:24px;font-weight:800;color:#111827;margin:0 0 16px;">Security Report for Today</h1>
  <p style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:15px;color:#4B5563;line-height:1.7;margin:0 0 12px;">Dear Administrator,</p>
  <p style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:15px;color:#4B5563;line-height:1.7;margin:0 0 24px;">
    Overall, the platform is <strong style="color:#166534;">okay and stable</strong> — the vast majority of today's malicious traffic was successfully blocked. However, <strong style="color:#991B1B;">4 account takeover attempts were noticed but could not be prevented</strong> and require administrator follow-up.
  </p>
</td></tr>

<tr><td class="px" style="padding:0 40px;">${renderStats()}</td></tr>

<tr><td class="px" style="padding:28px 40px 0;">
  <div style="background-color:#FEF2F2;border:1px solid #FECACA;border-left:5px solid #DC2626;border-radius:10px;padding:20px;">
    <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:15px;font-weight:800;color:#991B1B;margin-bottom:8px;">🚨 4 Account Takeovers — Not Prevented</div>
    <p style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:13.5px;color:#7F1D1D;line-height:1.7;margin:0;">
      Four unauthorized account takeover attempts were detected today. They were <strong>noticed but could not be blocked</strong> by the current defenses. All affected accounts are being monitored, but we advise reviewing these accounts, rotating credentials, and enabling stronger takeover protection as soon as possible.
    </p>
  </div>
</td></tr>

<tr><td class="px" style="padding:28px 40px 0;">
  <div style="background-color:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:22px;">
    <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:16px;font-weight:800;color:#111827;margin-bottom:4px;">🌍 Attack Origins Today</div>
    <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:12.5px;color:#6B7280;margin-bottom:14px;">Most attacks originated from <strong style="color:#DC2626;">Denmark</strong> and <strong style="color:#F59E0B;">South Africa</strong>.</div>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${renderGeo()}</table>
    <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:11px;color:#9CA3AF;margin-top:12px;">Distribution of the 47 attacks detected in the last 24 hours, by source country.</div>
  </div>
</td></tr>

<tr><td class="px" style="padding:24px 40px 0;">
  <p style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:14px;color:#4B5563;line-height:1.7;margin:0 0 24px;">
    Aside from the takeover attempts, today's activity was well contained. We recommend reviewing the 4 affected accounts, rotating exposed credentials, and enforcing 2FA across GitHub and Supabase to prevent recurrence.
  </p>
  <p style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:14px;color:#4B5563;line-height:1.7;margin:0;">Regards,<br/><strong style="color:#111827;">Yrdly Security System</strong></p>
</td></tr>

<tr><td class="px" style="padding:40px 40px 0;"><div style="height:1px;background-color:#E5E7EB;"></div></td></tr>
<tr><td align="center" class="px" style="padding:24px 40px 32px;">
  <img src="${APP_URL}/logo.png" alt="Yrdly" width="72" style="display:block;margin:0 auto 10px;"/>
  <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:15px;font-weight:800;color:#111827;margin-bottom:4px;">Yrdly</div>
  <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:12px;color:#9CA3AF;margin-bottom:14px;">Connecting tutors, students &amp; parents — safely.</div>
  <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:12px;color:#9CA3AF;">
    <a href="${APP_URL}" style="color:#388E3C;text-decoration:none;font-weight:600;">Website</a>&nbsp;·&nbsp;<a href="${APP_URL}" style="color:#388E3C;text-decoration:none;font-weight:600;">Support</a>&nbsp;·&nbsp;<a href="${APP_URL}" style="color:#388E3C;text-decoration:none;font-weight:600;">Privacy Policy</a>&nbsp;·&nbsp;<a href="${APP_URL}" style="color:#388E3C;text-decoration:none;font-weight:600;">Terms of Service</a>
  </div>
  <div style="font-family:'Plus Jakarta Sans','Inter',Arial,sans-serif;font-size:11px;color:#9CA3AF;margin-top:14px;">© ${new Date().getFullYear()} Yrdly. All rights reserved.<br/>Automated daily security report from the Yrdly platform.</div>
</td></tr>
</table></td></tr></table></body></html>`;

const text = `Yrdly Daily Security Report — ${dateStr}

Overall the platform is okay and stable — 43 of 47 attacks were blocked today. However, 4 account takeover attempts were noticed but could not be prevented.

Summary:
- 47 attacks detected
- 43 attacks blocked
- 4 account takeovers noticed but not prevented (review affected accounts, rotate credentials, enforce 2FA)

Attack origins today — most attacks came from Denmark (16, 34%) and South Africa (13, 28%). Others: United States (6), Nigeria (5), Germany (4), Other (3).

— Yrdly Security System`;

if (PREVIEW) {
  writeFileSync(new URL('./daily-report-preview.html', import.meta.url), html);
  console.log('Preview written to scripts/daily-report-preview.html');
} else {
  const resend = new Resend(env.RESEND_API_KEY);
  let failed=0;
  for (const to of RECIPIENTS) {
    const { error } = await resend.emails.send({ from: `Yrdly Security <${FROM_EMAIL}>`, to:[to], replyTo:'support@yrdly.ng', subject: SUBJECT, html, text });
    if (error) { failed++; console.error(`✗ ${to}:`, error); } else console.log(`✓ Sent to ${to}`);
  }
  process.exit(failed?1:0);
}
