import { Link } from "react-router-dom";
import { Building2, Landmark, Newspaper, GraduationCap, Heart, Trophy, Trophy as TrophyIcon, Church, FlaskConical, Radio, Vote, Globe } from "lucide-react";

export type OrgType =
  | "company"
  | "party"
  | "institution"
  | "media"
  | "ngo"
  | "sport_team"
  | "sport_league"
  | "church"
  | "university"
  | "research"
  | "radio_station"
  | "other";

export interface OrgCardData {
  slug: string;
  name: string;
  org_type: OrgType;
  short_description_hu?: string | null;
  ai_bio?: string | null;
  wikipedia_extract?: string | null;
  wikipedia_url?: string | null;
  wikipedia_match_status?: string | null;
  logo_url?: string | null;
  gated_episode_count: number;
  gated_podcast_count: number;
  political_color?: string | null;
  latest_episode_at?: string | null;
}

const TYPE_ICON: Record<OrgType, any> = {
  company: Building2,
  party: Vote,
  institution: Landmark,
  media: Newspaper,
  ngo: Heart,
  sport_team: Trophy,
  sport_league: TrophyIcon,
  church: Church,
  university: GraduationCap,
  research: FlaskConical,
  radio_station: Radio,
  other: Globe,
};

const TYPE_LABEL: Record<OrgType, string> = {
  company: "Cég",
  party: "Párt",
  institution: "Intézmény",
  media: "Média",
  ngo: "Civil szervezet",
  sport_team: "Sportklub",
  sport_league: "Liga",
  church: "Egyház",
  university: "Egyetem",
  research: "Kutató",
  radio_station: "Rádió",
  other: "Egyéb",
};

function detailHref(o: { org_type: OrgType; slug: string }): string {
  if (o.org_type === "party") return `/part/${o.slug}`;
  return `/ceg/${o.slug}`;
}

function buildContext(o: OrgCardData): string | null {
  const candidates = [o.short_description_hu, o.wikipedia_extract, o.ai_bio];
  for (const raw of candidates) {
    if (!raw) continue;
    const t = raw.trim();
    if (!t) continue;
    const first = t.split(/(?<=[.!?])\s+/)[0] || t;
    const trimmed = first.length > 140 ? first.slice(0, 137).trimEnd() + "…" : first;
    if (trimmed.length < 20) continue;
    return trimmed;
  }
  return null;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toLocaleUpperCase("hu-HU")).join("");
}

export default function OrgCard({ o }: { o: OrgCardData }) {
  const Icon = TYPE_ICON[o.org_type] || Building2;
  const ctx = buildContext(o);
  const isFresh = o.latest_episode_at
    ? Date.now() - new Date(o.latest_episode_at).getTime() < 30 * 24 * 3600 * 1000
    : false;

  return (
    <Link
      to={detailHref(o)}
      className="group flex items-start gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
    >
      <div className="shrink-0 h-12 w-12 rounded-lg bg-muted/60 border border-border/60 flex items-center justify-center overflow-hidden">
        {o.logo_url ? (
          <img
            src={o.logo_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-contain p-1.5"
          />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground">
            {initials(o.name) || <Icon className="h-5 w-5" />}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold truncate leading-tight">{o.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5 flex items-center gap-1.5">
              <Icon className="h-3 w-3" />
              <span>{TYPE_LABEL[o.org_type]}</span>
            </div>

          </div>
          {isFresh && (
            <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
              Friss
            </span>
          )}
        </div>
        {ctx && <div className="text-xs text-foreground/75 mt-1.5 line-clamp-2 leading-snug">{ctx}</div>}
        <div className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1.5 flex-wrap">
          <span>{o.gated_episode_count} epizód</span>
          <span aria-hidden>·</span>
          <span>{o.gated_podcast_count} műsor</span>
        </div>
      </div>
    </Link>
  );

}

export { TYPE_LABEL as ORG_TYPE_LABEL, TYPE_ICON as ORG_TYPE_ICON };
