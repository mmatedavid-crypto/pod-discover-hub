// One-time topic catch-up policy (owner-authorized, total-capped). Pure, no I/O.
// controls.catchup = { started_at, total_cap_usd, base_tiers, exhausted_at? }.
// Fresh episodes (last FRESH_DAYS) are always claimed first with the full tier list;
// older (backlog) episodes use the full list only while the cap has room, then the base tiers.
export const FRESH_DAYS = 14;

export type TopicCatchupPlan = {
  active: boolean; spent: number; cap: number; backlogOpen: boolean; markExhausted: boolean;
  freshTiers: string[] | null; backlogTiers: string[] | null;
};

export function topicCatchupPlan(ctrl: any, spentSinceStart: number): TopicCatchupPlan {
  const c = ctrl?.catchup;
  const tiers: string[] = Array.isArray(ctrl?.tier_filter) ? ctrl.tier_filter : ["S"];
  if (!c?.started_at) return { active: false, spent: 0, cap: 0, backlogOpen: true, markExhausted: false, freshTiers: null, backlogTiers: null };
  const cap = Math.max(0, Number(c.total_cap_usd) || 0);
  const spent = Math.max(0, Number(spentSinceStart) || 0);
  const backlogOpen = !c.exhausted_at && spent < cap;
  const base: string[] = Array.isArray(c.base_tiers) ? c.base_tiers.filter((t: string) => tiers.includes(t)) : tiers;
  return {
    active: true, spent, cap, backlogOpen,
    markExhausted: !backlogOpen && !c.exhausted_at,
    freshTiers: tiers,
    backlogTiers: backlogOpen ? tiers : base,
  };
}
