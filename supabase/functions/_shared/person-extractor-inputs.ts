// A show roster is not episode evidence. Only explicit feed/manual rosters may
// seed tentative host candidates; AI discovery lists never fan out to episodes.
export function personEpisodeInputs(episode: any, podcast: any) {
  const hostsSource = String(podcast?.hosts_source || "");
  const hostSource = hostsSource === "rss_author" ? "rss_author"
    : hostsSource === "manual_excel" ? "podcast_host_list" : null;
  const names = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((n): n is string => typeof n === "string" && !!n.trim()))] : [];
  const evidence = Array.isArray(episode?.entity_extraction_evidence?.person_mentions)
    ? episode.entity_extraction_evidence.person_mentions.filter((p: any) => typeof p?.name === "string" && !!p.name.trim()) : [];
  const speakers = evidence.filter((p: any) => p.role === "speaker").map((p: any) => p.name);
  const mentioned = evidence.filter((p: any) => p.role !== "speaker").map((p: any) => p.name);
  return {
    hosts: hostSource ? names(podcast?.hosts) : [], hostSource, hostsSource,
    // Deliberately do not subtract hosts: an episode's own evidence takes its
    // own path, including when a roster called a subject or a guest a host.
    speakers: names(speakers.length ? speakers : episode?.people),
    mentioned: names(mentioned.length ? mentioned : episode?.mentioned),
    evidence,
  };
}

export function isProtectedPersonPair(row: { relevance_status?: string | null; validation_source?: string | null; disposition?: string | null; decided_by?: string | null }): boolean {
  return ["accepted", "rejected", "resolved_show_host", "resolved_production_credit"].includes(row.relevance_status || "")
    || ["decided_accepted", "decided_rejected", "resolved_show_host", "resolved_production_credit"].includes(row.disposition || "")
    || /human|manual|chatgpt|external_review/i.test(`${row.validation_source || ""} ${row.decided_by || ""}`);
}
