import type { ReactNode } from 'react';
import { GoogleMapsProvider } from '@/components/providers/GoogleMapsProvider';

export default function OnboardingProfileLayout({ children }: { children: ReactNode }) {
  return <GoogleMapsProvider>{children}</GoogleMapsProvider>;
}
