"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, ShieldCheck, Database, Lock, Eye, Bell, Trash2, Smartphone, FileText, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';

const FONT_RALEWAY = "var(--font-raleway)";
const FONT_WORK_SANS = "var(--font-work-sans)";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="container max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Yrdly Logo" width={40} height={40} className="object-contain" />
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block text-foreground" style={{ fontFamily: FONT_WORK_SANS }}>
              Yrdly
            </span>
          </Link>
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              Back to Home
            </Button>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="container max-w-4xl mx-auto px-4 py-12 md:py-16">
        <div className="mb-12 text-center md:text-left">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-6">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground mb-4" style={{ fontFamily: FONT_WORK_SANS }}>
            Privacy Policy
          </h1>
          <p className="text-muted-foreground font-medium" style={{ fontFamily: FONT_RALEWAY }}>
            Last updated: <span className="text-foreground">September 20, 2026</span>
          </p>
        </div>

        <article className="prose prose-neutral dark:prose-invert max-w-none space-y-10 text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
          <section className="bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm">
            <p className="text-[1.0625rem] leading-relaxed mb-0">
              Yrdly Technologies Limited (&quot;Yrdly&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;) operates the Yrdly mobile application and web applications (including yrdly.ng and app.yrdly.ng). This Privacy Policy provides detailed information regarding how we collect, process, store, share, and protect your personal data when you use our neighborhood marketplace, event management, and escrow payment services.
            </p>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">1</span>
              Information We Collect
            </h2>
            <p className="mb-4 text-[0.9375rem] leading-relaxed">We collect several types of information from and about users of our Services, including:</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary" /> Profile & Account Data
                </h3>
                <p className="text-xs">Full name, email address, mobile phone number, username, profile photo, and secure password hashes.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" /> Identity Verification
                </h3>
                <p className="text-xs">Government ID, NIN/BVN, or verification selfies required for verified sellers and anti-fraud compliance.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <Lock className="w-4 h-4 text-primary" /> Financial & Escrow Data
                </h3>
                <p className="text-xs">Bank payout account details, escrow transaction history, and payment status via PCI-DSS compliant payment partners (e.g. Payluk).</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <Eye className="w-4 h-4 text-primary" /> User Content & Messages
                </h3>
                <p className="text-xs">Listing titles, photos, descriptions, event listings, ratings, and buyer-seller chat messages.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-primary" /> Device & Technical Info
                </h3>
                <p className="text-xs">IP address, mobile device model, OS version, unique device IDs, push notification tokens, and crash reports.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> Geolocation Data
                </h3>
                <p className="text-xs">GPS location (with consent) or IP-based city/neighborhood locations used for local listing recommendations and distance sorting.</p>
              </div>
            </div>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">2</span>
              How We Use Your Information
            </h2>
            <p className="mb-4 text-[0.9375rem] leading-relaxed">We process your personal information strictly for legitimate operational purposes:</p>
            <ul className="space-y-3 pl-4 list-none text-[0.9375rem]">
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Platform Operation:</strong> Facilitating buying, selling, event organization, and buyer-seller communications.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Escrow & Payment Processing:</strong> Securing transaction funds in escrow until buyer confirmation, processing disbursements, and resolving payment disputes.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Neighborhood Discovery:</strong> Sorting search results by distance, detecting local hubs, and displaying relevant community content.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Security & Fraud Protection:</strong> Verifying identities, monitoring suspicious activities, preventing scam listings, and keeping your account secure.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Transactional Notifications:</strong> Sending automated order updates, escrow releases, chat notifications, and security alerts.
              </li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">3</span>
              Mobile Device Permissions
            </h2>
            <p className="mb-4 text-[0.9375rem] leading-relaxed">Our mobile application requests specific device permissions to deliver core functionality:</p>
            <div className="bg-card border border-border p-5 rounded-xl space-y-3 text-[0.9375rem]">
              <div>
                <strong className="text-foreground">Location Services:</strong> Required for displaying nearby listings, sorting search results by distance, and identifying your neighborhood.
              </div>
              <div>
                <strong className="text-foreground">Camera & Photo Gallery:</strong> Required to snap photographs of items for listing creation, event graphics, and profile avatars.
              </div>
              <div>
                <strong className="text-foreground">Push Notifications:</strong> Required to alert you instantly about buyer inquiries, escrow status updates, and order confirmations.
              </div>
            </div>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">4</span>
              Sharing & Third-Party Service Providers
            </h2>
            <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl mb-4">
              <p className="font-semibold text-primary m-0">We never sell, rent, or trade your personal data to third parties for marketing purposes.</p>
            </div>
            <p className="mb-3 text-[0.9375rem] leading-relaxed">Data is shared only with carefully vetted partners:</p>
            <ul className="space-y-3 pl-4 list-none text-[0.9375rem]">
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                <strong className="text-foreground">Payment & Escrow Processors:</strong> Licensed financial partners (e.g. Payluk at api.payluk.ng) for handling payments, holding escrow funds, and disbursing payouts.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                <strong className="text-foreground">Cloud Infrastructure:</strong> Supabase (data storage & auth), Vercel (web hosting), and Resend (transactional email & SMS).
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                <strong className="text-foreground">Legal & Regulatory Mandates:</strong> Disclosure to law enforcement or regulators when strictly required under statutory legal obligation or valid court order.
              </li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">5</span>
              Data Retention, Security & Deletion Rights
            </h2>
            <div className="space-y-4 text-[0.9375rem]">
              <p>
                <strong className="text-foreground">Security:</strong> We implement SSL/TLS encryption in transit and AES-256 encryption at rest, combined with strict role-based access control.
              </p>
              <p>
                <strong className="text-foreground">Retention:</strong> Account data is retained for the lifetime of your active account. Transaction and financial records are retained for up to 7 years to meet statutory tax and anti-money laundering requirements.
              </p>
              <div className="bg-card border border-border p-5 rounded-xl">
                <h3 className="font-semibold text-foreground mb-2 flex items-center gap-2 text-base">
                  <Trash2 className="w-5 h-5 text-destructive" /> Account Deletion & Data Erasure
                </h3>
                <p className="text-sm mb-3">You have the right to permanently delete your account and erase all associated personal data at any time:</p>
                <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
                  <li>In-App: Go to <strong>Settings &gt; Profile &gt; Delete Account</strong> and confirm deletion.</li>
                  <li>Via Email: Send an explicit deletion request from your registered email address to <a href="mailto:support@yrdly.ng" className="text-primary underline">support@yrdly.ng</a>.</li>
                </ol>
                <p className="text-xs text-muted-foreground mt-3">Account deletion requests are processed within 30 days of identity verification.</p>
              </div>
            </div>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-semibold">6</span>
              Children’s Privacy & Age Restrictions
            </h2>
            <p className="text-[0.9375rem] leading-relaxed">
              Yrdly is strictly intended for individuals aged 18 and older (or 13+ under adult supervision for browsing only; financial transactions require age 18+). We do not knowingly collect or solicit personal data from children under 13. If we discover minor data has been collected, it is deleted immediately.
            </p>
          </section>

          {/* Section 7 */}
          <section className="bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm mt-12 text-center">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 text-primary mb-3">
              <Mail className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">Have Privacy Questions?</h2>
            <p className="text-sm mb-6">If you have any questions or data privacy requests, please reach out to our team.</p>
            <a 
              href="mailto:support@yrdly.ng" 
              className="inline-flex items-center justify-center h-10 px-6 rounded-full font-medium text-primary-foreground transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Contact Data Protection Team
            </a>
            <p className="mt-4 text-xs font-mono text-muted-foreground">support@yrdly.ng | Yrdly Technologies Limited</p>
          </section>
        </article>
      </main>
      
      <footer className="py-8 text-center text-xs text-muted-foreground border-t border-border mt-10">
        <p>&copy; {new Date().getFullYear()} Yrdly. All rights reserved.</p>
      </footer>
    </div>
  );
}

