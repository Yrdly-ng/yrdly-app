"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, AlertTriangle, ShieldAlert, Loader2, Send } from 'lucide-react';

export default function AdminCreateAlertPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<'amber' | 'missing_person' | 'community_safety' | 'info'>('community_safety');
  const [severity, setSeverity] = useState<'information' | 'caution' | 'urgent'>('urgent');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaName, setAreaName] = useState('');
  const [actionInstruction, setActionInstruction] = useState('');

  const handleCreateAlert = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) {
      toast({
        title: "Missing Fields",
        description: "Please fill in title and description.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Insert into safety_alerts table as approved admin broadcast
      const { error } = await supabase
        .from('safety_alerts')
        .insert({
          user_id: user?.id,
          title,
          description,
          type,
          severity,
          area_name: areaName || 'Community-Wide',
          action: actionInstruction || undefined,
          status: 'approved',
        });

      if (error) throw error;

      toast({
        title: "Alert Published",
        description: "The broadcast alert has been published to the community feed.",
      });

      router.push('/admin/moderation');
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Error",
        description: err.message || "Failed to create alert.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6 space-y-6 font-yrdly-body text-foreground">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight font-yrdly-display text-foreground">Create Community Broadcast Alert</h1>
      </div>

      <Card className="border border-[var(--yrdly-glass-border)] bg-[var(--yrdly-glass-bg)] backdrop-blur-xl shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg font-medium font-yrdly-display flex items-center gap-2 text-foreground">
            <ShieldAlert className="h-5 w-5 text-red-500" />
            Admin Alert Broadcast
          </CardTitle>
          <CardDescription className="text-[var(--yrdly-label)]">
            Issue a high-priority community safety alert, missing person bulletin, or amber notice across the platform.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateAlert} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="alert-type" className="text-foreground">Alert Category</Label>
                <Select value={type} onValueChange={(val: any) => setType(val)}>
                  <SelectTrigger id="alert-type" className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="community_safety">Community Safety</SelectItem>
                    <SelectItem value="amber">Amber Alert</SelectItem>
                    <SelectItem value="missing_person">Missing Person</SelectItem>
                    <SelectItem value="info">Informational Bulletin</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="alert-severity" className="text-foreground">Severity Level</Label>
                <Select value={severity} onValueChange={(val: any) => setSeverity(val)}>
                  <SelectTrigger id="alert-severity" className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground">
                    <SelectValue placeholder="Select severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent / Critical</SelectItem>
                    <SelectItem value="caution">Caution / High</SelectItem>
                    <SelectItem value="information">Information / General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-title" className="text-foreground">Headline / Title</Label>
              <Input
                id="alert-title"
                placeholder="e.g. Flash Flood Warning in Lekki Phase 1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-area" className="text-foreground">Affected Area / Location</Label>
              <Input
                id="alert-area"
                placeholder="e.g. Ikeja, Lagos"
                value={areaName}
                onChange={(e) => setAreaName(e.target.value)}
                className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-desc" className="text-foreground">Alert Description</Label>
              <Textarea
                id="alert-desc"
                placeholder="Provide detailed information regarding the safety alert..."
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-action" className="text-foreground">Recommended Action / Instruction (Optional)</Label>
              <Input
                id="alert-action"
                placeholder="e.g. Avoid the coastal road until further notice"
                value={actionInstruction}
                onChange={(e) => setActionInstruction(e.target.value)}
                className="border-[var(--yrdly-glass-border)] bg-background/50 text-foreground"
              />
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Broadcast Alert
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
