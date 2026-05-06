import { Link } from "react-router-dom";
import logo from "@/assets/logo.png";

export function BrandMark({
  size = 28,
  withWordmark = true,
  className = "",
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
}) {
  return (
    <Link
      to="/"
      aria-label="Podiverzum — home"
      className={`group inline-flex items-center gap-2 ${className}`}
    >
      <span
        className="relative inline-flex items-center justify-center rounded-md overflow-hidden ring-1 ring-border bg-background"
        style={{ width: size, height: size }}
      >
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          className="object-cover"
          loading="eager"
          decoding="async"
        />
      </span>
      {withWordmark && (
        <span className="font-semibold tracking-tight text-foreground text-[15px] sm:text-base">
          Podiverzum
        </span>
      )}
    </Link>
  );
}
