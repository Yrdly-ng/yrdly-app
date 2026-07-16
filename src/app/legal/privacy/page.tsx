"use client";

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
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
      <main className="container max-w-3xl mx-auto px-4 py-12 md:py-16">
        <div className="mb-12 text-center md:text-left">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary/10 text-primary mb-6">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-foreground mb-4" style={{ fontFamily: FONT_WORK_SANS }}>
            Privacy Policy
          </h1>
          <p className="text-muted-foreground font-medium" style={{ fontFamily: FONT_RALEWAY }}>
            Last updated: <span className="text-foreground">February 20, 2024</span>
          </p>
        </div>

        <article className="prose prose-neutral dark:prose-invert max-w-none space-y-8 text-muted-foreground" style={{ fontFamily: FONT_RALEWAY }}>
          <section className="bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm">
            <p className="text-[1.0625rem] leading-relaxed mb-0">
              At Yrdly, your privacy is important to us. This Privacy Policy explains how we collect, use, and protect your personal information when you use our platform. By using Yrdly, you agree to the collection and use of information in accordance with this policy.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">1</span>
              Information We Collect
            </h2>
            <p className="mb-4 text-[0.9375rem] leading-relaxed">When you use Yrdly, we may collect various types of information, including but not limited to:</p>
            <ul className="space-y-3 pl-4 list-none text-[0.9375rem]">
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Account details:</strong> Name, email, phone number, and profile information you provide during registration.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Usage data:</strong> Listings you create, events you attend, items you purchase, and how you interact with the app.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-primary before:rounded-full">
                <strong className="text-foreground font-semibold">Device information:</strong> IP address, browser type, and device identifiers, used to help keep your account secure.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">2</span>
              How We Use Your Information
            </h2>
            <p className="mb-4 text-[0.9375rem] leading-relaxed">We use your information to provide and improve our services, specifically to:</p>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm">Core Features</h3>
                <p className="text-xs">Enable features such as creating listings, purchasing items, and joining events.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm">Personalization</h3>
                <p className="text-xs">Personalize your experience and suggest content relevant to your neighborhood.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm">Improvement</h3>
                <p className="text-xs">Improve our services through analytics and user feedback tracking.</p>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl">
                <h3 className="font-semibold text-foreground mb-1 text-sm">Communication</h3>
                <p className="text-xs">Communicate with you about updates, promotions, or customer support.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">3</span>
              Sharing of Information
            </h2>
            <div className="bg-primary/5 border border-primary/20 p-5 rounded-xl mb-4">
              <p className="font-semibold text-primary m-0">We do not sell your personal data under any circumstances.</p>
            </div>
            <p className="mb-3 text-[0.9375rem] leading-relaxed">We may share information only with:</p>
            <ul className="space-y-3 pl-4 list-none text-[0.9375rem]">
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                <strong className="text-foreground">Trusted Service Providers:</strong> Partners who support our platform infrastructure, such as hosting services or payment processors.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                <strong className="text-foreground">Legal Authorities:</strong> Law enforcement or regulatory bodies, only if strictly required by law.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">4</span>
              Data Security
            </h2>
            <p className="text-[0.9375rem] leading-relaxed">
              We use industry-standard security measures to protect your data during transmission and in storage. However, no digital system is 100% secure. We encourage you to use strong passwords and keep your login details strictly private to help protect your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">5</span>
              Your Choices & Rights
            </h2>
            <ul className="space-y-3 pl-4 list-none text-[0.9375rem]">
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                Update or correct your account information directly in your profile settings.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                Opt out of promotional marketing emails by clicking the “unsubscribe” link at the bottom of our emails.
              </li>
              <li className="relative before:absolute before:-left-4 before:top-2 before:w-1.5 before:h-1.5 before:bg-muted-foreground before:rounded-full">
                Request the permanent deletion of your account and associated data by contacting our support team.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">6</span>
              Children’s Privacy
            </h2>
            <p className="text-[0.9375rem] leading-relaxed">
              Yrdly is not intended for use by children under the age of 13. We do not knowingly collect or solicit personal data from minors. If we learn we have collected personal data from a child under 13, we will delete that information as quickly as possible.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-3 mt-10">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm">7</span>
              Updates to This Policy
            </h2>
            <p className="text-[0.9375rem] leading-relaxed">
              We may update this Privacy Policy periodically to reflect changes in our practices or legal requirements. Any modifications will be posted directly on this page along with a revised “Last updated” date at the top. We encourage you to review this policy periodically.
            </p>
          </section>

          <section className="bg-card border border-border p-6 md:p-8 rounded-2xl shadow-sm mt-12 text-center">
            <h2 className="text-xl font-bold text-foreground mb-2">Have Questions?</h2>
            <p className="text-sm mb-6">If you have any questions or concerns about this Privacy Policy, please reach out to our team.</p>
            <a 
              href="mailto:yardlyng234@gmail.com" 
              className="inline-flex items-center justify-center h-10 px-6 rounded-full font-medium text-primary-foreground transition-colors"
              style={{ background: 'hsl(var(--primary))' }}
            >
              Contact Support
            </a>
            <p className="mt-4 text-xs font-mono text-muted-foreground">yardlyng234@gmail.com</p>
          </section>
        </article>
      </main>
      
      <footer className="py-8 text-center text-xs text-muted-foreground border-t border-border mt-10">
        <p>&copy; {new Date().getFullYear()} Yrdly. All rights reserved.</p>
      </footer>
    </div>
  );
}
