import { Link, useNavigate } from "react-router-dom";
import { User, LogOut, Sparkles, Heart, Bookmark, Bell, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { isCompletedTasteProgress } from "@/lib/tasteCompletion";

const TASTE_STORAGE_KEY = "podiverzum_taste_v1";

function hasLocalTasteResult(): boolean {
  try {
    const raw = localStorage.getItem(TASTE_STORAGE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw);
    return isCompletedTasteProgress({
      completedAt: p.completedAt || null,
      seenCardIds: Array.isArray(p.seenCardIds) ? p.seenCardIds : [],
      likedCardIds: Array.isArray(p.likedCardIds) ? p.likedCardIds : [],
    });
  } catch {
    return false;
  }
}

export function UserMenu() {
  const { user, profile, signOut } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [localTasteDone, setLocalTasteDone] = useState(false);

  useEffect(() => {
    setLocalTasteDone(hasLocalTasteResult());
  }, []);

  if (!user) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Hallgatói menü"
            title="Hallgatói menü"
            className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
          >
            <User className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-60 p-2 rounded-md border border-border bg-popover shadow-lg"
        >
          <nav className="flex flex-col gap-0.5">
            <MenuItem to="/te-podiverzumod" icon={Sparkles} onClick={() => setOpen(false)}>
              {localTasteDone ? "Hallgatói profilom" : "Te Podiverzumod"}
            </MenuItem>
            <MenuItem to="/belepes" icon={User} onClick={() => setOpen(false)}>
              Belépés
            </MenuItem>
          </nav>
        </PopoverContent>
      </Popover>
    );
  }

  const initial = (profile?.display_name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Fiók menü"
          className="inline-flex items-center justify-center h-9 w-9 rounded-full border-2 border-primary/40 bg-primary/10 text-primary overflow-hidden transition-colors hover:border-primary/70"
        >
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs font-semibold">{initial}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-60 p-2 rounded-md border border-border bg-popover shadow-lg"
      >
        <div className="px-3 py-2 border-b border-border/60">
          <div className="text-sm font-medium truncate">{profile?.display_name || user.email}</div>
          {profile?.username && <div className="text-xs text-muted-foreground truncate">@{profile.username}</div>}
        </div>
        <nav className="flex flex-col gap-0.5 mt-1">
          <MenuItem to="/en-podiverzumom" icon={Sparkles} onClick={() => setOpen(false)}>Az én Podiverzumom</MenuItem>
          <MenuItem to="/en-podiverzumom?tab=kedvencek" icon={Heart} onClick={() => setOpen(false)}>Kedvencek</MenuItem>
          <MenuItem to="/en-podiverzumom?tab=meghallgatando" icon={Bookmark} onClick={() => setOpen(false)}>Meghallgatandó</MenuItem>
          <MenuItem to="/en-podiverzumom?tab=kovetett" icon={Bell} onClick={() => setOpen(false)}>Követett podcastok</MenuItem>
          <MenuItem to="/en-podiverzumom?tab=beallitasok" icon={Settings} onClick={() => setOpen(false)}>Beállítások</MenuItem>
          <button
            type="button"
            onClick={async () => { setOpen(false); await signOut(); nav("/"); }}
            className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center gap-2 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Kijelentkezés
          </button>
        </nav>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({
  to, icon: Icon, children, onClick,
}: { to: string; icon: any; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground flex items-center gap-2 transition-colors"
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Link>
  );
}
