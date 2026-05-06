import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";

export function BrandMark({
  size = 28,
  withWordmark = true,
  className = "",
  tagline = false,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  tagline?: boolean;
}) {
  return (
    <Link
      to="/"
      aria-label="Podiverzum — home"
      className={`group inline-flex items-center gap-2.5 ${className}`}
    >
      <span
        className="relative inline-flex items-center justify-center rounded-md overflow-hidden bg-black ring-1 ring-white/10 shadow-[0_0_0_1px_hsl(var(--brand-red)/0.0),0_8px_24px_-12px_hsl(var(--brand-red)/0.45)] transition-shadow group-hover:shadow-[0_0_0_1px_hsl(var(--brand-red)/0.4),0_8px_24px_-8px_hsl(var(--brand-red)/0.6)]"
        style={{ width: size, height: size }}
      >
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          className="object-cover scale-[1.4] -translate-y-[6%]"
          loading="eager"
          decoding="async"
        />
      </span>
      {withWordmark && (
        <span className="leading-none">
          <span className="block font-semibold tracking-tight text-foreground text-[15px] sm:text-base">
            Podiverzum
          </span>
          {tagline && (
            <span className="block mt-0.5 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Find it. <span className="text-primary">Hear it.</span>
            </span>
          )}
        </span>
      )}
    </Link>
  );
}
