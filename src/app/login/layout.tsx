import { AuthProvider } from '@/hooks/use-supabase-auth';
import { Pacifico, Inter } from 'next/font/google';

const pacifico = Pacifico({ weight: '400', subsets: ['latin'], variable: '--font-pacifico' });
const inter = Inter({ weight: ['300', '400', '500'], subsets: ['latin'], variable: '--font-sans' });

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${pacifico.variable} ${inter.variable} font-sans`}>
      {children}
    </div>
  );
}
