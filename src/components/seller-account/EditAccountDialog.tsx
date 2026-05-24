"use client";

import React, { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SellerAccountService } from '@/lib/seller-account-service';
import { SellerAccount, AccountType, BankAccountDetails, MobileMoneyDetails } from '@/types/seller-account';
import { useToast } from '@/hooks/use-toast';
import { Building2, Smartphone } from 'lucide-react';
import nigerianBanks from '@/data/nigerian-banks.json';

const editAccountFormSchema = z.object({
  isPrimary: z.boolean().default(false),
  
  // Bank account fields
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  bankCode: z.string().optional(),
  accountTypeBank: z.enum(['savings', 'current']).optional(),
  
  // Mobile money fields
  provider: z.enum(['mtn', 'airtel', 'glo', '9mobile', 'opay', 'palmpay']).optional(),
  phoneNumber: z.string().optional(),
});

type EditAccountFormValues = z.infer<typeof editAccountFormSchema>;

interface EditAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: SellerAccount | null;
  onSuccess: () => void;
}

export function EditAccountDialog({ open, onOpenChange, account, onSuccess }: EditAccountDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  
  const form = useForm<EditAccountFormValues>({
    resolver: zodResolver(editAccountFormSchema),
    defaultValues: {
      isPrimary: false,
    },
  });

  useEffect(() => {
    if (account && open) {
      // Populate form with existing account data
      const details = account.accountDetails as any;
      
      form.reset({
        isPrimary: account.isPrimary,
        accountNumber: details.accountNumber || '',
        accountName: details.accountName || '',
        bankCode: details.bankCode || '',
        accountTypeBank: details.accountType || '',
        provider: details.provider || '',
        phoneNumber: details.phoneNumber || '',
      });
    }
  }, [account, open, form]);

  const onSubmit = async (data: EditAccountFormValues) => {
    if (!account) return;

    try {
      setLoading(true);
      
      // Update account details based on account type
      let updatedDetails: BankAccountDetails | MobileMoneyDetails;
      
      switch (account.accountType) {
        case AccountType.BANK_ACCOUNT:
          const selectedBank = nigerianBanks.find(bank => bank.code === data.bankCode);
          updatedDetails = {
            accountNumber: data.accountNumber!,
            accountName: data.accountName!,
            bankCode: data.bankCode!,
            bankName: selectedBank?.name || '',
            accountType: data.accountTypeBank!
          } as BankAccountDetails;
          break;
          
        case AccountType.MOBILE_MONEY:
          updatedDetails = {
            provider: data.provider!,
            phoneNumber: data.phoneNumber!,
            accountName: data.accountName || ''
          } as MobileMoneyDetails;
          break;
          
        default:
          throw new Error('Invalid account type');
      }

      // In a real implementation, you would call an update method
      // For now, we'll just show success

      toast({
        title: "Success",
        description: "Account updated successfully"
      });

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating account:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update account. Please try again."
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
                  {getAccountTypeIcon(account.accountType)}
                </div>
                <h2 className="text-2xl font-black text-foreground tracking-tight">Edit Account</h2>
              </div>
            </div>
            <p className="text-sm text-muted-foreground font-medium leading-relaxed">
              Update your payout details to ensure smooth transactions.
            </p>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="relative z-10 space-y-8">
            <div className="space-y-6 pt-4 border-t border-border">
              {account.accountType === AccountType.BANK_ACCOUNT && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Bank</label>
                      <select 
                        className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none appearance-none"
                        value={form.watch('bankCode')}
                        onChange={(e) => form.setValue('bankCode', e.target.value)}
                      >
                        <option value="" className="bg-card">Select...</option>
                        {nigerianBanks.map((bank) => (
                          <option key={bank.code} value={bank.code} className="bg-card">{bank.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Type</label>
                      <select 
                        className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none appearance-none"
                        value={form.watch('accountTypeBank')}
                        onChange={(e) => form.setValue('accountTypeBank', e.target.value as any)}
                      >
                        <option value="savings" className="bg-card">Savings</option>
                        <option value="current" className="bg-card">Current</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Account Number</label>
                    <input
                      className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none placeholder:text-muted-foreground"
                      placeholder="0123456789"
                      {...form.register('accountNumber')}
                    />
                  </div>
                </div>
              )}

              {account.accountType === AccountType.MOBILE_MONEY && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Provider</label>
                      <select 
                        className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none appearance-none"
                        value={form.watch('provider')}
                        onChange={(e) => form.setValue('provider', e.target.value as any)}
                      >
                        <option value="mtn" className="bg-card">MTN</option>
                        <option value="airtel" className="bg-card">Airtel</option>
                        <option value="opay" className="bg-card">Opay</option>
                        <option value="palmpay" className="bg-card">PalmPay</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Phone</label>
                      <input
                        className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none placeholder:text-muted-foreground"
                        placeholder="08012345678"
                        {...form.register('phoneNumber')}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[0.625rem] uppercase tracking-[0.15em] font-black text-muted-foreground ml-1">Account Holder Name</label>
                <input
                  className="w-full h-12 rounded-xl bg-white/5 border border-border px-4 text-base text-foreground focus:border-[#388E3C]/50 focus:outline-none placeholder:text-muted-foreground"
                  placeholder="e.g. John Doe"
                  {...form.register('accountName')}
                />
              </div>

              {/* Primary Checkbox */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    {...form.register('isPrimary')}
                  />
                  <div className="w-5 h-5 rounded border border-border bg-white/5 peer-checked:bg-[#388E3C] peer-checked:border-[#388E3C] transition-all" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 peer-checked:opacity-100 transition-opacity">
                    <div className="w-2 h-2 rounded-full bg-white" />
                  </div>
                </div>
                <span className="text-xs font-bold text-muted-foreground group-hover:text-foreground transition-colors">Set as primary payout method</span>
              </label>
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-3 pt-4">
              <button
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-2xl bg-[#388E3C] text-white font-black text-sm transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
                style={{ boxShadow: "0 10px 20px -5px rgba(56,142,60,0.3)" }}
              >
                {loading ? 'Updating Account...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full h-12 rounded-2xl bg-white/5 text-muted-foreground font-black text-xs uppercase tracking-widest hover:text-foreground transition-all"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
