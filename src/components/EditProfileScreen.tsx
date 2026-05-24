"use client";

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ArrowLeft, Camera, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/hooks/use-supabase-auth';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/lib/supabase';
import { StorageService } from '@/lib/storage-service';
import { allStates, lgasByState, wardsByLga } from '@/lib/geo-data';
import interestsData from '@/data/interests.json';

const profileFormSchema = z.object({
  name: z.string().min(2, { message: 'Name must be at least 2 characters.' }),
  bio: z.string().max(160, { message: 'Bio cannot exceed 160 characters.' }).optional(),
  locationState: z.string().optional(),
  locationLga: z.string().optional(),
  locationWard: z.string().optional(),
  avatar: z.any().optional(),
  interests: z.array(z.string()).optional(),
});

type ProfileFormValues = z.infer<typeof profileFormSchema>;

interface EditProfileScreenProps {
  onBack?: () => void;
}

export function EditProfileScreen({ onBack }: EditProfileScreenProps) {
  const router = useRouter();
  const { user, profile, loading: authLoading, updateProfile } = useAuth();
  const { toast } = useToast();
  const [formLoading, setFormLoading] = useState(false);
  const [lgas, setLgas] = useState<string[]>([]);
  const [wards, setWards] = useState<string[]>([]);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isInterestsOpen, setIsInterestsOpen] = useState(false);

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues: {
      name: '',
      bio: '',
      locationState: undefined,
      locationLga: undefined,
      locationWard: undefined,
      interests: [],
    },
  });

  // Load profile data
  useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name || '',
        bio: profile.bio || '',
        locationState: profile.location?.state || '',
        locationLga: profile.location?.lga || '',
        locationWard: profile.location?.ward || '',
        interests: profile.interests || [],
      });
      setAvatarPreview(profile.avatar_url || null);
      setSelectedInterests(profile.interests || []);
    }
  }, [profile, form]);

  // Update LGAs when state changes
  const selectedState = form.watch('locationState');
  useEffect(() => {
    if (selectedState) {
      setLgas(lgasByState[selectedState] || []);
      form.setValue('locationLga', undefined); // Reset LGA when state changes
      form.setValue('locationWard', undefined); // Reset ward when state changes
    } else {
      setLgas([]);
      setWards([]);
    }
  }, [selectedState, form]);

  // Update wards when LGA changes
  const selectedLga = form.watch('locationLga');
  useEffect(() => {
    if (selectedLga) {
      setWards(wardsByLga[selectedLga] || []);
      form.setValue('locationWard', undefined); // Reset ward when LGA changes
    } else {
      setWards([]);
    }
  }, [selectedLga, form]);

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Set the form value
      form.setValue('avatar', [file]);
      
      // Set preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setAvatarPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const onSubmit = async (values: ProfileFormValues) => {
    if (!user) return;

    
    setFormLoading(true);
    try {
      let avatarUrl = profile?.avatar_url;

      // Upload new avatar if provided
      if (values.avatar && values.avatar.length > 0) {
        const file = values.avatar[0];
        const { url, error } = await StorageService.uploadUserAvatar(user.id, file);
        if (error) {
          console.error('Error uploading avatar:', error);
          throw new Error(error?.message || 'Failed to upload profile picture');
        }
        if (url) avatarUrl = url;
      }

      // Update profile using auth hook to ensure local state is updated
      await updateProfile({
        name: values.name,
        bio: values.bio,
        avatar_url: avatarUrl,
        interests: selectedInterests,
        location: (() => {
          // Only set new location if the user actually selected a state
          if (values.locationState && values.locationState.trim()) {
            return {
              state: values.locationState,
              lga: values.locationLga || undefined,
              ward: values.locationWard || undefined,
            };
          }
          // No new location entered — preserve whatever they had before
          return profile?.location ?? undefined;
        })(),
        updated_at: new Date().toISOString(),
      });

      toast({
        title: 'Profile updated successfully!',
        description: 'Your changes have been saved.',
      });

      if (onBack) {
        onBack();
      } else {
        router.back();
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      toast({
        variant: 'destructive',
        title: 'Error updating profile',
        description: 'Please try again.',
      });
    } finally {
      setFormLoading(false);
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  if (authLoading) {
    return (
      <div className="p-4 space-y-6 pb-24 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-muted animate-pulse rounded" />
          <div className="h-8 w-32 bg-muted animate-pulse rounded" />
        </div>
        <Card className="p-6">
          <div className="space-y-4">
            <div className="h-24 w-24 bg-muted animate-pulse rounded-full mx-auto" />
            <div className="space-y-2">
              <div className="h-6 w-48 bg-muted animate-pulse rounded mx-auto" />
              <div className="h-4 w-32 bg-muted animate-pulse rounded mx-auto" />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-24 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={handleBack} className="p-0">
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-2xl font-bold text-foreground">Edit Profile</h2>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Profile Picture */}
          <Card className="p-6 yrdly-shadow">
            <div className="flex flex-col items-center space-y-4">
              <div className="relative">
                <Avatar className="w-24 h-24">
                  <AvatarImage src={avatarPreview || profile?.avatar_url || "/placeholder.svg"} />
                  <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                    {profile?.name?.charAt(0) || "U"}
                  </AvatarFallback>
                </Avatar>
                <label
                  htmlFor="avatar-upload"
                  className="absolute bottom-0 right-0 w-8 h-8 bg-primary text-primary-foreground rounded-full flex items-center justify-center cursor-pointer hover:bg-primary/90 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                </label>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>
              <div className="text-center">
                <h3 className="font-semibold text-foreground">Profile Picture</h3>
                <p className="text-sm text-muted-foreground">Tap to change your photo</p>
              </div>
            </div>
          </Card>

          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Basic Information</h3>

            <Card className="p-4 space-y-4 yrdly-shadow">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your full name" autoComplete="name" enterKeyHint="next" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="bio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bio</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us about yourself..."
                        className="min-h-[100px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Card>
          </div>

          {/* Location */}
          <div className="space-y-4">
            <h3 className="font-semibold text-foreground">Location</h3>

            <Card className="p-4 space-y-4 yrdly-shadow">
              <FormField
                control={form.control}
                name="locationState"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {allStates.filter((s) => s != null && s !== '').map((state) => (
                          <SelectItem key={state} value={state}>
                            {state}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="locationLga"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Local Government Area</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={!form.watch('locationState')}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your LGA" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {lgas.filter((l) => l != null && l !== '').map((lga) => (
                          <SelectItem key={lga} value={lga}>
                            {lga}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="locationWard"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Ward</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value || undefined} disabled={!form.watch('locationLga')}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select your ward" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {wards.filter((w) => w != null && w !== '').map((ward) => (
                          <SelectItem key={ward} value={ward}>
                            {ward}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Card>
          </div>

          {/* Interests Selection */}
          <div className="space-y-4">
            <Collapsible open={isInterestsOpen} onOpenChange={setIsInterestsOpen}>
              <Card className="p-4 yrdly-shadow">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-foreground">Interests</h3>
                    {selectedInterests.length > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {selectedInterests.length}/10
                      </Badge>
                    )}
                  </div>
                  {isInterestsOpen ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </CollapsibleTrigger>
                
                <CollapsibleContent className="space-y-4 mt-4">
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-foreground">Select your interests</label>
                      <p className="text-xs text-muted-foreground">Choose topics that interest you (up to 10)</p>
                    </div>
                    
                    {/* Search Input */}
                    <Input
                      placeholder="Search interests..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full"
                      enterKeyHint="search"
                      inputMode="search"
                    />
                    
                    {/* Selected Interests */}
                    {selectedInterests.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-foreground">Selected ({selectedInterests.length}/10):</p>
                        <div className="flex flex-wrap gap-2">
                          {selectedInterests.map((interest) => (
                            <Badge
                              key={interest}
                              className="bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                              onClick={() => {
                                const newInterests = selectedInterests.filter(i => i !== interest);
                                setSelectedInterests(newInterests);
                                form.setValue('interests', newInterests);
                              }}
                            >
                              {interest} ×
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Available Interests */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-foreground">Available interests:</p>
                      <div className="max-h-48 overflow-y-auto border rounded-md p-3 space-y-1">
                        {interestsData
                          .filter(interest => 
                            interest.toLowerCase().includes(searchTerm.toLowerCase()) &&
                            !selectedInterests.includes(interest)
                          )
                          .slice(0, 50) // Limit to first 50 for performance
                          .map((interest) => (
                            <div
                              key={interest}
                              className="flex items-center justify-between p-2 hover:bg-muted rounded cursor-pointer"
                              onClick={() => {
                                if (selectedInterests.length < 10) {
                                  const newInterests = [...selectedInterests, interest];
                                  setSelectedInterests(newInterests);
                                  form.setValue('interests', newInterests);
                                }
                              }}
                            >
                              <span className="text-sm">{interest}</span>
                              {selectedInterests.length < 10 && (
                                <span className="text-xs text-muted-foreground">+</span>
                              )}
                            </div>
                          ))}
                        {selectedInterests.length >= 10 && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Maximum 10 interests selected
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* Save Button */}
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1 bg-transparent"
              onClick={handleBack}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={formLoading}
            >
              {formLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
