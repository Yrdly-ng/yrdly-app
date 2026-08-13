import { useBankLogos } from "@/hooks/use-bank-logos";

export function BankLogo({ code, name, size = 24 }: { code: string; name: string; size?: number }) {
  const { getBankLogo } = useBankLogos();
  const logoUrl = getBankLogo(code);
  
  if (logoUrl) {
    return (
      <img 
        src={logoUrl} 
        alt={name} 
        width={size} 
        height={size} 
        className="rounded-full object-cover border border-border bg-card shrink-0" 
      />
    );
  }
  
  // Fallback UI
  const initials = name.substring(0, 2).toUpperCase();
  return (
    <div 
      className="rounded-full flex items-center justify-center font-bold bg-primary/10 text-primary border border-primary/20 shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {initials}
    </div>
  );
}
