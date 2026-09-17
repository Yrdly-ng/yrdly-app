import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

interface AppHeaderProps {
  title: string;
  onBack?: () => void;
  rightElement?: React.ReactNode;
}

export function AppHeader({ title, onBack, rightElement }: AppHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      router.back();
    }
  };

  return (
    <div className="sticky top-[calc(4rem+env(safe-area-inset-top))] md:top-[calc(84px+env(safe-area-inset-top))] z-40 flex items-center justify-between px-4 py-4 bg-card border-b border-border shadow-sm">
      <div className="flex items-center gap-3">
        <button 
          onClick={handleBack} 
          className="p-2 -ml-2 rounded-full hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-foreground" />
        </button>
        <div>
          <h1 className="font-sans font-bold text-xl text-foreground">{title}</h1>
        </div>
      </div>
      {rightElement && (
        <div>{rightElement}</div>
      )}
    </div>
  );
}
