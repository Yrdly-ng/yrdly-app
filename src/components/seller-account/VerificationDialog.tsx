"use client";

import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle 
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SellerAccountService } from '@/lib/seller-account-service';
import { SellerAccount, AccountType, VerificationStatus } from '@/types/seller-account';
import { useToast } from '@/hooks/use-toast';
import { 
  Building2, 
  Smartphone, 
  CheckCircle, 
  Clock, 
  AlertCircle,
  Upload,
  FileText,
  Shield
} from 'lucide-react';

interface VerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SellerAccount | null;
  onSuccess: () => void;
}

export function VerificationDialog({ open, onOpenChange, account, onSuccess }: VerificationDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [microDepositAmount, setMicroDepositAmount] = useState<number | null>(null);
  const [enteredAmount, setEnteredAmount] = useState('');
  const [verificationStep, setVerificationStep] = useState<'initiate' | 'verify' | 'documents'>('initiate');

  const handleInitiateMicroDeposit = async () => {
    if (!account) return;

    try {
      setLoading(true);
      const amount = await SellerAccountService.initiateMicroDepositVerification(account.id);
      setMicroDepositAmount(amount);
      setVerificationStep('verify');
      
      toast({
        title: "Micro-deposit sent",
        description: `We've sent ₦${amount} to your account. Please check your bank statement and enter the amount.`
      });
    } catch (error) {
      console.error('Error initiating micro-deposit:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send micro-deposit. Please try again."
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyMicroDeposit = async () => {
    if (!account || !enteredAmount) return;

    try {
      setLoading(true);
      const isValid = await SellerAccountService.verifyMicroDeposit(account.id, parseInt(enteredAmount));
      
      if (isValid) {
        toast({
          title: "Verification successful",
          description: "Your account has been verified successfully!"
        });
        onSuccess();
        onOpenChange(false);
      } else {
        toast({
          variant: "destructive",
          title: "Verification failed",
          description: "The amount you entered is incorrect. Please check your bank statement and try again."
        });
      }
    } catch (error) {
      console.error('Error verifying micro-deposit:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to verify micro-deposit. Please try again."
      });
    } finally {
      setLoading(false);
    }
  };

  const getAccountTypeIcon = (type: AccountType) => {
    switch (type) {
      case AccountType.BANK_ACCOUNT:
        return <Building2 className="h-5 w-5" />;
      case AccountType.MOBILE_MONEY:
        return <Smartphone className="h-5 w-5" />;
      default:
        return <Building2 className="h-5 w-5" />;
    }
  };

  const getAccountDisplayName = (account: SellerAccount) => {
    switch (account.accountType) {
      case AccountType.BANK_ACCOUNT:
        const bankDetails = account.accountDetails as any;
        return `${bankDetails.bankName} - ${bankDetails.accountNumber.slice(-4)}`;
      case AccountType.MOBILE_MONEY:
        const mobileDetails = account.accountDetails as any;
        return `${mobileDetails.provider.toUpperCase()} - ${mobileDetails.phoneNumber}`;
      default:
        return 'Unknown Account';
    }
  };

  if (!account) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-lg w-[95vw] p-0 border-none bg-transparent shadow-2xl overflow-hidden"
        style={{ fontFamily: "Inter, sans-serif" }}
      >
        <div 
          className="relative w-full max-h-[90vh] overflow-y-auto rounded-[32px] p-8 space-y-8 animate-in zoom-in-95 duration-300"
          style={{ 
            background: "var(--card)",
            border: "1px solid rgba(255,255,255,0.05)"
          }}
        >
          {/* Decorative Header Gradient */}
          <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-[#388E3C]/10 to-transparent pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-2xl bg-[#388E3C]/20 flex items-center justify-center">
                  <Shield className="w-5 h-5 text-[#388E3C]" />
                </div>
                <h2 className="text-2xl font-black text-foreground tracking-tight">Verify Account</h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
              Complete verification to unlock faster payouts and higher limits.
            </p>
          </div>

          <div className="relative z-10 space-y-8">
            {/* Account Preview Card */}
            <div className="p-6 rounded-[24px] bg-white/5 border border-border space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center text-muted-foreground">
                  {getAccountTypeIcon(account.accountType)}
                </div>
                <div>
                  <p className="text-xs font-black text-foreground tracking-wide">{getAccountDisplayName(account)}</p>
                  <p className="text-[0.625rem] font-bold text-muted-foreground uppercase tracking-wider">{account.accountType.replace('_', ' ')}</p>
                </div>
                <div className="ml-auto">
                  <Badge variant="secondary" className="bg-[#388E3C]/20 text-[#388E3C] border-none font-bold text-[0.625rem] px-3">
                    PENDING
                  </Badge>
                </div>
              </div>
            </div>

            {/* Verification Content */}
            {account.accountType === AccountType.BANK_ACCOUNT ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-lg bg-[#388E3C] flex items-center justify-center text-foreground text-[0.625rem] font-black">1</div>
                    <h3 className="text-sm font-black text-foreground">Micro-deposit Verification</h3>
                  </div>
                  
                  {verificationStep === 'initiate' && (
                    <div className="space-y-4 pl-9">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        We&apos;ll send a small amount (₦1-₦5) to your account. You&apos;ll need to enter the exact amount here to verify ownership.
                      </p>
                      <button
                        onClick={handleInitiateMicroDeposit}
                        disabled={loading}
                        className="w-full h-12 rounded-xl bg-[#388E3C] text-white font-black text-sm transition-all active:scale-95 disabled:opacity-50"
                      >
                        {loading ? 'Sending...' : 'Send Micro-deposit'}
                      </button>
                    </div>
                  )}

                  {verificationStep === 'verify' && (
                    <div className="space-y-6 pl-9">
                      <div className="p-4 rounded-xl bg-[#388E3C]/10 border border-[#388E3C]/20">
                        <p className="text-xs text-[#388E3C] font-bold">
                          Deposit Sent! Please enter the ₦ amount shown in your bank statement.
                        </p>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Enter Amount (₦)</label>
                        <input
                          type="number"
                          className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none placeholder:text-muted-foreground"
                          placeholder="e.g. 3"
                          value={enteredAmount}
                          onChange={(e) => setEnteredAmount(e.target.value)}
                        />
                      </div>
                      
                      <div className="flex gap-3">
                        <button
                          onClick={() => setVerificationStep('initiate')}
                          className="flex-1 h-12 rounded-xl bg-white/5 text-muted-foreground font-black text-xs uppercase tracking-widest hover:text-foreground transition-all"
                        >
                          Back
                        </button>
                        <button
                          onClick={handleVerifyMicroDeposit}
                          disabled={loading || !enteredAmount}
                          className="flex-[2] h-12 rounded-xl bg-[#388E3C] text-white font-black text-sm transition-all active:scale-95"
                        >
                          {loading ? 'Verifying...' : 'Verify Amount'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-6 border-t border-border space-y-4 opacity-50">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center text-muted-foreground text-[0.625rem] font-black">2</div>
                    <h3 className="text-sm font-black text-foreground">Identity Verification</h3>
                  </div>
                  <p className="text-[0.625rem] text-muted-foreground pl-9">
                    Upload government ID or utility bill to increase your transaction limits. (Coming soon)
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="p-6 rounded-[24px] bg-[#388E3C]/5 border border-[#388E3C]/20 flex gap-4">
                  <Clock className="w-5 h-5 text-[#388E3C] shrink-0" />
                  <div>
                    <p className="text-xs font-black text-foreground mb-1 uppercase tracking-widest">Manual Review Required</p>
                    <p className="text-[0.625rem] text-muted-foreground leading-relaxed font-medium">
                      Mobile money accounts are reviewed manually by our team. Verification typically completes within 24-48 hours.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Close Action */}
            <div className="pt-4">
              <button
                onClick={() => onOpenChange(false)}
                className="w-full h-12 rounded-2xl bg-white/5 text-muted-foreground font-black text-xs uppercase tracking-widest hover:text-foreground transition-all"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
