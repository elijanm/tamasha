import { Menu, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { getInitials } from "@/utils/format";

interface TopbarProps {
  title?: string;
  onMenuClick?: () => void;
}

export function Topbar({ title, onMenuClick }: TopbarProps) {
  const { user } = useAuth();

  return (
    <header data-topbar className="h-14 border-b border-stone-800/60 bg-stone-950/80 backdrop-blur-sm flex items-center px-4 gap-3 sticky top-0 z-30">
      {onMenuClick && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </Button>
      )}

      <div className="flex-1 min-w-0">
        {title && (
          <h1 className="font-display text-base font-semibold text-stone-200 truncate">
            {title}
          </h1>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="text-stone-600 hover:text-stone-300">
          <Bell className="h-4 w-4" />
        </Button>
        {user && (
          <div className="w-8 h-8 rounded-full bg-violet-500/20 border border-violet-500/30 flex items-center justify-center">
            <span className="text-xs font-display font-semibold text-violet-400">
              {getInitials(user.username)}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
