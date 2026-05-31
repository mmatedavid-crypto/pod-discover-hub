// Megosztható "Hallgatói profil" nyugta. Tisztán DOM/CSS — html-to-image-szel
// PNG-vé render. Mobil-first: fix 360px belső szélesség, monospace, fekete-fehér,
// papír textúra, perforált fel/le él, szaggatott dividerek.

import { forwardRef } from "react";
import { Barcode } from "./Barcode";
import type { ListenerProfile } from "@/lib/listenerProfiles";

export type ReceiptProps = {
  profile: ListenerProfile;
  receiptNumber: string;
  /** ISO date — alapból most. */
  date?: string;
  /** "ritka profil" stb. — opcionális. */
  rareBadge?: string | null;
  /** Csak vizuális — pl. share_id a barcode seedjéhez. */
  seed?: string;
};

function fmtDate(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${y}.${m}.${day}  ${hh}:${mm}`;
}

/**
 * A receipt mindig 360px széles a DOM-ban — a kép-exportnál pixelRatio-val
 * skálázzuk 9:16 vagy 1:1 cél-méretre.
 */
export const ListenerReceipt = forwardRef<HTMLDivElement, ReceiptProps>(
  function ListenerReceipt({ profile, receiptNumber, date, rareBadge, seed }, ref) {
    const dateStr = fmtDate(date);
    const barcodeSeed = seed || receiptNumber;

    return (
      <div
        ref={ref}
        className="listener-receipt"
        style={{
          width: 360,
          maxWidth: "100%",
          background: "#f7f4ee",
          color: "#0a0a0a",
          fontFamily:
            "'JetBrains Mono', 'IBM Plex Mono', 'Courier New', ui-monospace, monospace",
          fontSize: 13,
          lineHeight: 1.55,
          position: "relative",
          padding: "28px 24px 24px",
          boxShadow: "0 24px 60px -28px rgba(0,0,0,0.45)",
          // Halk papír textúra (SVG noise) — html-to-image-zel jól exportálódik.
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.045 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      >
        {/* Perforált felső él */}
        <PerforatedEdge position="top" />

        {/* Fejléc */}
        <div style={{ textAlign: "center", marginTop: 6 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.32em",
              fontWeight: 700,
            }}
          >
            PODIVERZUM RECEIPT
          </div>
          <div
            style={{
              fontSize: 11,
              opacity: 0.7,
              marginTop: 4,
              letterSpacing: "0.08em",
            }}
          >
            {dateStr}
          </div>
          <div
            style={{
              fontSize: 10,
              opacity: 0.6,
              marginTop: 2,
              letterSpacing: "0.12em",
            }}
          >
            RECEIPT NO: {receiptNumber}
          </div>
        </div>

        <DottedDivider />

        {/* Hallgatói profil */}
        <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
          <div
            style={{
              fontSize: 10,
              opacity: 0.65,
              letterSpacing: "0.32em",
              fontWeight: 600,
            }}
          >
            HALLGATÓI PROFIL
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.01em",
              marginTop: 8,
              lineHeight: 1.18,
              textTransform: "uppercase",
            }}
          >
            {profile.name}
          </div>
          {rareBadge && (
            <div
              style={{
                display: "inline-block",
                marginTop: 10,
                padding: "3px 8px",
                border: "1px solid #0a0a0a",
                fontSize: 10,
                letterSpacing: "0.2em",
                fontWeight: 700,
              }}
            >
              {rareBadge}
            </div>
          )}
        </div>

        <DottedDivider />

        {/* Trait sorok */}
        <div style={{ padding: "8px 0" }}>
          {profile.traits.map((t, i) => (
            <LeaderRow key={t} index={i + 1} label={t} />
          ))}
        </div>

        <DottedDivider />

        {/* Ajánlott irány */}
        <div style={{ padding: "10px 0 4px" }}>
          <div
            style={{
              fontSize: 10,
              opacity: 0.65,
              letterSpacing: "0.3em",
              fontWeight: 600,
            }}
          >
            AJÁNLOTT IRÁNY
          </div>
          <div style={{ marginTop: 4, fontSize: 13, fontWeight: 600 }}>
            {profile.recommendedDirection}
          </div>
        </div>

        <DottedDivider />

        {/* Total */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 0 6px",
            fontWeight: 800,
            fontSize: 14,
            letterSpacing: "0.08em",
          }}
        >
          <span>TOTAL</span>
          <span>1 ÚJ HALLGATÓ</span>
        </div>

        <DottedDivider />

        {/* Barcode + URL */}
        <div style={{ paddingTop: 12, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <Barcode seed={barcodeSeed} width={280} height={48} />
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 11,
              letterSpacing: "0.18em",
              fontWeight: 700,
            }}
          >
            PODIVERZUM.HU / START
          </div>
        </div>

        {/* CTA + tagline */}
        <div
          style={{
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px dashed #0a0a0a",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.16em",
            }}
          >
            NEKED MI JÖN KI?
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 10,
              opacity: 0.65,
              letterSpacing: "0.18em",
            }}
          >
            PODIVERZUM.HU — FIND IT. HEAR IT.
          </div>
        </div>

        <PerforatedEdge position="bottom" />
      </div>
    );
  },
);

function DottedDivider() {
  return (
    <div
      aria-hidden
      style={{
        borderTop: "1.5px dotted #0a0a0a",
        opacity: 0.55,
        margin: "6px 0",
      }}
    />
  );
}

function LeaderRow({ index, label }: { index: number; label: string }) {
  // A "pontok" CSS-trükk: a középső flex elem repeating linear-gradient hátérrel.
  const idx = String(index).padStart(2, "0");
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 6,
        fontSize: 13,
        padding: "4px 0",
      }}
    >
      <span style={{ fontWeight: 700, opacity: 0.85, minWidth: 22 }}>{idx}</span>
      <span style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.02em" }}>
        {label}
      </span>
      <span
        aria-hidden
        style={{
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          // 4px dot-step "leader"
          backgroundImage:
            "radial-gradient(circle, #0a0a0a 0.8px, transparent 1px)",
          backgroundSize: "5px 5px",
          backgroundPosition: "0 70%",
          backgroundRepeat: "repeat-x",
          height: 14,
          opacity: 0.55,
          margin: "0 4px",
        }}
      />
      <span style={{ fontWeight: 800 }}>✓</span>
    </div>
  );
}

function PerforatedEdge({ position }: { position: "top" | "bottom" }) {
  // Háromszög-fűrésszel utánzott perforáció — SVG, hogy exportkor is stabil.
  const W = 360;
  const H = 12;
  const teeth = 30;
  const step = W / teeth;
  const points: string[] = [];
  if (position === "top") {
    points.push(`0,${H}`);
    for (let i = 0; i < teeth; i++) {
      points.push(`${i * step},${H}`);
      points.push(`${i * step + step / 2},0`);
      points.push(`${(i + 1) * step},${H}`);
    }
    points.push(`${W},${H}`);
  } else {
    points.push(`0,0`);
    for (let i = 0; i < teeth; i++) {
      points.push(`${i * step},0`);
      points.push(`${i * step + step / 2},${H}`);
      points.push(`${(i + 1) * step},0`);
    }
    points.push(`${W},0`);
  }
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [position]: -1,
        display: "block",
      }}
      aria-hidden
    >
      <polygon points={points.join(" ")} fill="#f7f4ee" />
    </svg>
  );
}
