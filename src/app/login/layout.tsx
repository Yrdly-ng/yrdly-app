import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Inter } from 'next/font/google';


const inter = Inter({ weight: ['300', '400', '500'], subsets: ['latin'], variable: '--font-sans' });

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={` ${inter.variable} font-sans`}>
      {children}
    </div>
  );
}
