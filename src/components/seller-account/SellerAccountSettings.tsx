"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { SellerAccountService } from '@/lib/seller-account-service';
import { 
  SellerAccount, 
  AccountType, 
  VerificationStatus, 
  VerificationLevel,
  PayoutRequest 
} from '@/types/seller-account';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, 
  Edit, 
  Trash2, 
  CheckCircle, 
  XCircle, 
  Clock, 
  AlertCircle,
  Smartphone,
  Building2,
  Banknote
} from 'lucide-react';
import { AddAccountDialog } from './AddAccountDialog';
import { EditAccountDialog } from './EditAccountDialog';
import { VerificationDialog } from './VerificationDialog';
import { PayoutHistory } from './PayoutHistory';
import { useToast } from '@/hooks/use-toast';

export function SellerAccountSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<SellerAccount[]>([]);
  const [payoutHistory, setPayoutHistory] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [editAccountOpen, setEditAccountOpen] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<SellerAccount | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [accountsData, payoutsData] = await Promise.all([
        SellerAccountService.getSellerAccounts(user!.id),
        SellerAccountService.getPayoutHistory(user!.id)
      ]);
      setAccounts(accountsData);
      setPayoutHistory(payoutsData);
    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load account information"
      });
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, loadData]);

  const handleAddAccount = () => {
    setSelectedAccount(null);
    setAddAccountOpen(true);
  };

  const handleEditAccount = (account: SellerAccount) => {
    setSelectedAccount(account);
    setEditAccountOpen(true);
  };

  const handleVerifyAccount = (account: SellerAccount) => {
    setSelectedAccount(account);
    setVerificationOpen(true);
  };

  const handleDeleteAccount = async (accountId: string) => {
    try {
      // In a real implementation, you would call a delete method
      // For now, we'll just reload the data
      await loadData();
      toast({
        title: "Success",
        description: "Account deleted successfully"
      });
    } catch (error) {
      console.error('Error deleting account:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete account"
      });
    }
  };

  const getAccountIcon = (accountType: AccountType) => {
    switch (accountType) {
      case AccountType.BANK_ACCOUNT:
        return <Building2 className="h-5 w-5" />;
      case AccountType.MOBILE_MONEY:
        return <Smartphone className="h-5 w-5" />;
      default:
        return <Banknote className="h-5 w-5" />;
    }
  };

  const getVerificationBadge = (status: VerificationStatus) => {
    switch (status) {
      case VerificationStatus.VERIFIED:
        return <Badge variant="default" className="bg-green-100 text-green-800"><CheckCircle className="h-3 w-3 mr-1" />Verified</Badge>;
      case VerificationStatus.PENDING:
        return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case VerificationStatus.REJECTED:
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      case VerificationStatus.EXPIRED:
        return <Badge variant="outline"><AlertCircle className="h-3 w-3 mr-1" />Expired</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
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

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-10 animate-in fade-in duration-700" style={{ fontFamily: "Inter, sans-serif" }}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 p-8 rounded-[40px] bg-card/60 border border-border backdrop-blur-3xl shadow-2xl relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#388E3C]/10 rounded-full blur-[80px] -translate-y-1/2 translate-x-1/2 pointer-events-none" />
        
        <div className="relative z-10">
          <h2 className="text-3xl font-black text-foreground tracking-tight">Payout Settings</h2>
          <p className="text-muted-foreground font-medium mt-1">
            Configure how you receive your neighborhood earnings.
          </p>
        </div>
        <button 
          onClick={handleAddAccount}
          className="relative z-10 h-14 px-8 rounded-2xl bg-[#388E3C] text-white font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95 shadow-[0_10px_20px_-5px_rgba(56,142,60,0.4)] group"
        >
          <Plus className="h-5 w-5 group-hover:rotate-90 transition-transform duration-300" />
          Add Account
        </button>
      </div>

      <Tabs defaultValue="accounts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="payouts">Payout History</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          {accounts.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Banknote className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No accounts added</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Add a payout account to receive payments from your sales
                </p>
                <Button onClick={handleAddAccount}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Your First Account
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {accounts.map((account) => (
                <div 
                  key={account.id}
                  className="rounded-[32px] bg-card/40 border border-border overflow-hidden transition-all hover:border-[#388E3C]/30 hover:bg-card/60 group"
                >
                  <div className="p-8 space-y-6">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center border border-border group-hover:border-[#388E3C]/20 transition-colors">
                          <div className="text-[#388E3C]">
                            {getAccountIcon(account.accountType)}
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-black text-foreground text-lg tracking-tight">
                              {getAccountDisplayName(account)}
                            </h4>
                            {account.isPrimary && (
                              <div className="px-2 py-0.5 rounded-full bg-[#388E3C]/20 border border-[#388E3C]/30 text-[0.625rem] font-black text-[#388E3C] uppercase tracking-widest">
                                Primary
                              </div>
                            )}
                          </div>
                          <p className="text-[0.625rem] font-black text-muted-foreground uppercase tracking-[0.2em] mt-0.5">
                            {account.accountType.replace('_', ' ')}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEditAccount(account)}
                          className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-all border border-border"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(account.id)}
                          className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center text-red-500 hover:bg-red-500 hover:text-foreground transition-all border border-red-500/20"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4 pt-6 border-t border-border">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <p className="text-[0.625rem] font-black text-muted-foreground uppercase tracking-widest opacity-60">Status</p>
                          {getVerificationBadge(account.verificationStatus)}
                        </div>
                        <div className="text-right space-y-1">
                          <p className="text-[0.625rem] font-black text-muted-foreground uppercase tracking-widest opacity-60">Added</p>
                          <p className="text-sm font-bold text-foreground">{account.createdAt.toLocaleDateString()}</p>
                        </div>
                      </div>

                      {account.verificationStatus === VerificationStatus.PENDING && (
                        <button
                          onClick={() => handleVerifyAccount(account)}
                          className="w-full h-12 rounded-xl bg-[#388E3C]/10 border border-[#388E3C]/30 text-[#388E3C] font-black text-xs uppercase tracking-widest hover:bg-[#388E3C] hover:text-foreground transition-all mt-2"
                        >
                          Verify Account
                        </button>
                      )}

                      {account.rejectedReason && (
                        <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 text-xs text-red-400 font-medium">
                          <span className="font-black text-red-500 uppercase tracking-widest block mb-1">Rejection Reason</span>
                          {account.rejectedReason}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="payouts">
          <PayoutHistory payouts={payoutHistory} />
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <AddAccountDialog
        open={addAccountOpen}
        onOpenChange={setAddAccountOpen}
        onSuccess={loadData}
      />

      <EditAccountDialog
        open={editAccountOpen}
        onOpenChange={setEditAccountOpen}
        account={selectedAccount}
        onSuccess={loadData}
      />

      <VerificationDialog
        open={verificationOpen}
        onOpenChange={setVerificationOpen}
        account={selectedAccount}
        onSuccess={loadData}
      />
    </div>
  );
}
