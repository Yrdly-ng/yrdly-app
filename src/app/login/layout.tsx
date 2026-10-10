import localFont from 'next/font/local';

const inter = localFont({ src: '../fonts/inter.woff2', weight: '100 900', variable: '--font-sans', display: 'swap' });

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
