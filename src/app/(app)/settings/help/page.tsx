'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronDown, ChevronUp, Mail } from 'lucide-react';

interface FAQItem {
  q: string;
  a: string;
}

const FAQS: FAQItem[] = [
  {
    q: 'How does marketplace escrow work?',
    a: 'When you buy an item, your payment is held securely in escrow by YRDLY. Once you meet the seller and verify the item is in the described condition, you release the funds to the seller. This protects both parties from fraud.',
  },
  {
    q: 'How do I list an item for sale?',
    a: 'Tap the "+" icon in the bottom menu or go to the Marketplace tab, then tap "List Item". Enter the details, upload photos, set a price, and publish it to your neighbourhood.',
  },
  {
    q: 'Can I change my home neighbourhood?',
    a: 'Yes. Go to Settings > Location, and select a new State and LGA. Note that updating your location will change the posts and listings visible to you to match your new neighbourhood.',
  },
  {
    q: 'What should I do if I get scammed?',
    a: 'If you suspect a scam, do not release escrow funds. Go to the transaction details page and tap "File Dispute". Our admin team will investigate and mediate the dispute.',
  },
];

function FAQRow({ faq }: { faq: FAQItem }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-border/50 last:border-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left font-medium hover:bg-muted/40 transition-colors"
      >
        <span className="text-sm font-semibold text-foreground pr-4">{faq.q}</span>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          {faq.a}
        </div>
      )}
    </div>
  );
}

export default function HelpCenterPage() {
  const router = useRouter();

  const handleContactSupport = () => {
    window.location.href = 'mailto:support@yrdly.ng?subject=YRDLY Web Support Request';
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-12">
      {/* Top Header */}
      <header className="lg:hidden sticky top-0 z-20 backdrop-blur-md bg-background/80 border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="w-9 h-9 rounded-xl bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
        >
          <ChevronLeft className="w-5 h-5 text-foreground" />
        </button>
        <h1 className="font-bold text-lg text-foreground">Help Center</h1>
        <div className="w-9" />
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6 space-y-6">
        <div>
          <h2 className="font-bold text-xl text-foreground mb-4">Frequently Asked Questions</h2>
          <div className="bg-card rounded-2xl border border-border/60 shadow-sm overflow-hidden">
            {FAQS.map((faq) => (
              <FAQRow key={faq.q} faq={faq} />
            ))}
          </div>
        </div>

        {/* Still need help card */}
        <div className="bg-card rounded-2xl border border-border/60 p-6 flex flex-col items-center text-center shadow-sm">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
            <Mail className="w-6 h-6 text-primary" />
          </div>
          <h3 className="font-bold text-base text-foreground mb-1">Still need help?</h3>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 max-w-sm">
            Our support team is available to assist you with any questions or account issues.
          </p>
          <button
            onClick={handleContactSupport}
            className="h-11 px-6 rounded-full bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Email Support
          </button>
        </div>
      </main>
    </div>
  );
}
