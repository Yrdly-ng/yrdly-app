"use client";

import React, { useState } from 'react';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SellerAccountService } from '@/lib/seller-account-service';
import { AccountType, BankAccountDetails, MobileMoneyDetails } from '@/types/seller-account';
import { useToast } from '@/hooks/use-toast';
import { Building2, Smartphone } from 'lucide-react';
import nigerianBanks from '@/data/nigerian-banks.json';

const accountFormSchema = z.object({
  accountType: z.enum(['bank_account', 'mobile_money']),
  isPrimary: z.boolean().default(false),
  
  // Bank account fields
  accountNumber: z.string().optional(),
  accountName: z.string().optional(),
  bankCode: z.string().optional(),
  accountTypeBank: z.enum(['savings', 'current']).optional(),
  
  // Mobile money fields
  provider: z.enum(['mtn', 'airtel', 'glo', '9mobile', 'opay', 'palmpay']).optional(),
  phoneNumber: z.string().optional(),
  
}).refine((data) => {
  if (data.accountType === 'bank_account') {
    return data.accountNumber && data.accountName && data.bankCode && data.accountTypeBank;
  }
  if (data.accountType === 'mobile_money') {
    return data.provider && data.phoneNumber;
  }
  return false;
}, {
  message: "Please fill in all required fields for the selected account type",
  path: ["accountType"]
});

type AccountFormValues = z.infer<typeof accountFormSchema>;

interface AddAccountDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function AddAccountDialog({ open, onOpenChange, onSuccess }: AddAccountDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [verifiedName, setVerifiedName] = useState("");
  
  const form = useForm<AccountFormValues>({
    resolver: zodResolver(accountFormSchema),
    defaultValues: {
      accountType: 'bank_account',
      isPrimary: false,
    },
  });

  const onSubmit = async (data: AccountFormValues) => {
    try {
      setLoading(true);
      
      const selectedBank = nigerianBanks.find(bank => bank.code === data.bankCode);
      const accountDetails: BankAccountDetails = {
        accountNumber: data.accountNumber!,
        accountName: data.accountName || verifiedName || "Verified User",
        bankCode: data.bankCode!,
        bankName: selectedBank?.name || '',
        accountType: data.accountTypeBank || 'savings'
      };

      await SellerAccountService.saveAccount(
        'current-user-id', // This should come from auth context
        'bank_account',
        accountDetails,
        data.isPrimary
      );

      toast({
        title: "Success",
        description: "Account added successfully."
      });

      onSuccess();
      onOpenChange(false);
      form.reset();
    } catch (error) {
      console.error('Error adding account:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add account. Please try again."
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-lg w-[95vw] p-0 border-none bg-surface shadow-2xl overflow-hidden rounded-[24px]"
      >
        <div className="relative w-full max-h-[90vh] overflow-y-auto px-6 py-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="font-pacifico text-2xl tracking-tight text-on-surface" style={{ fontFamily: "Pacifico, cursive" }}>Add Payout Account</h1>
          </div>

          <section className="mb-8">
            <p className="font-editorial text-[12px] text-on-surface-variant mb-4" style={{ fontFamily: "Raleway, sans-serif" }}>Required to receive your marketplace earnings</p>
            <div className="flex items-center gap-2 bg-primary-container/10 p-3 rounded-lg">
              <Building2 className="text-primary w-5 h-5 flex-shrink-0" />
              <p className="font-editorial text-[11px] text-primary" style={{ fontFamily: "Raleway, sans-serif" }}>Your account details are encrypted at rest</p>
            </div>
          </section>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label className="font-editorial text-[13px] font-medium ml-4 text-on-surface-variant" style={{ fontFamily: "Raleway, sans-serif" }}>Select Bank</label>
              <div className="relative">
                <select 
                  className="w-full h-14 bg-surface-container-high border-[0.5px] border-outline-variant/20 rounded-full px-6 text-on-surface focus:border-primary-container focus:ring-0 transition-all font-body appearance-none"
                  {...form.register('bankCode')}
                >
                  <option value="">Select...</option>
                  {nigerianBanks.map((bank) => (
                    <option key={bank.code} value={bank.code}>{bank.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="font-editorial text-[13px] font-medium ml-4 text-on-surface-variant" style={{ fontFamily: "Raleway, sans-serif" }}>Account Number</label>
              <input 
                className="w-full h-14 bg-surface-container-high border-[0.5px] border-outline-variant/20 rounded-full px-6 text-on-surface focus:border-primary-container focus:ring-0 transition-all font-body"
                placeholder="10-digit account number"
                type="number"
                {...form.register('accountNumber')}
              />
            </div>

            <div className="space-y-2">
              <label className="font-editorial text-[13px] font-medium ml-4 text-on-surface-variant" style={{ fontFamily: "Raleway, sans-serif" }}>Account Name</label>
              <input 
                className="w-full h-14 bg-surface-container-high border-[0.5px] border-outline-variant/20 rounded-full px-6 text-on-surface focus:border-primary-container focus:ring-0 transition-all font-body"
                placeholder="Name on account"
                {...form.register('accountName')}
              />
            </div>

            <div className="flex items-start gap-3 px-4 py-2">
              <p className="font-editorial text-[11px] text-on-surface-variant leading-relaxed" style={{ fontFamily: "Raleway, sans-serif" }}>
                We verify your account to ensure accurate payouts. Your data is protected by industry-standard protocols.
              </p>
            </div>

            <div className="mt-8 space-y-4">
              <button 
                type="submit"
                disabled={loading}
                className="w-full h-14 rounded-full bg-primary-container text-on-primary-container font-bold text-lg shadow-lg shadow-primary-container/20 active:scale-[0.98] transition-all disabled:opacity-50"
                style={{ fontFamily: "Raleway, sans-serif" }}
              >
                {loading ? "Saving..." : "Save Account Details"}
              </button>
              <button 
                type="button"
                onClick={() => onOpenChange(false)}
                className="w-full py-2 text-on-surface-variant font-editorial text-sm hover:text-on-surface transition-colors"
                style={{ fontFamily: "Raleway, sans-serif" }}
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
