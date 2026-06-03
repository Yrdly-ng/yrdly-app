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
    <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-4 bg-background/95 backdrop-blur-sm border-b border-border">
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
