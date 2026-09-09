"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ArrowLeft, MapPin, Eye, ShieldCheck, Loader2 } from 'lucide-react';

export default function PrivacySettingsPage() {
  const router = useRouter();
  const { profile, updateProfile } = useAuth();
  const { toast } = useToast();
  const [updating, setUpdating] = useState(false);

  const handleToggle = async (key: 'share_location' | 'discoverable', value: boolean) => {
    setUpdating(true);
    try {
      await updateProfile({ [key]: value });
      toast({
        title: "Settings Updated",
        description: "Your privacy preferences have been updated.",
      });
    } catch (e: any) {
      toast({
        title: "Error",
        description: e.message || "Failed to update privacy settings.",
        variant: "destructive",
      });
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="container max-w-2xl py-6 space-y-6">
      <div className="flex items-center space-x-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Privacy & Discoverability</h1>
        {updating && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-auto" />}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-medium flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-muted-foreground" />
            Location & Search Privacy
          </CardTitle>
          <CardDescription>
            Manage how your location is shared and how others find you in your local neighbourhood.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between space-x-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-lg bg-muted">
                <MapPin className="h-5 w-5 text-foreground" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="share-location" className="font-medium text-base leading-none">
                  Share Location
                </Label>
                <p className="text-sm text-muted-foreground">
                  Show your approximate neighbourhood to nearby users on local feeds and maps.
                </p>
              </div>
            </div>
            <Switch
              id="share-location"
              checked={profile?.share_location ?? profile?.shareLocation ?? true}
              onCheckedChange={(checked) => handleToggle('share_location', checked)}
              disabled={updating}
            />
          </div>

          <div className="border-t pt-6 flex items-center justify-between space-x-4">
            <div className="flex items-start space-x-3">
              <div className="p-2 rounded-lg bg-muted">
                <Eye className="h-5 w-5 text-foreground" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="discoverable" className="font-medium text-base leading-none">
                  Public Profile Discoverability
                </Label>
                <p className="text-sm text-muted-foreground">
                  Allow members in your area to find your profile through local discovery recommendations.
                </p>
              </div>
            </div>
            <Switch
              id="discoverable"
              checked={profile?.discoverable ?? true}
              onCheckedChange={(checked) => handleToggle('discoverable', checked)}
              disabled={updating}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
