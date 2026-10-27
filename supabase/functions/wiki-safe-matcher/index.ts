// wiki-safe-matcher — free, AI-free Wikipedia matching for people and organizations.
// Applies only safe matches (policy in _shared/wiki-safe-match.ts) through apply_wiki_safe_match_v1
// (row lock, only unmatched rows, before-state logged, undo via revert_wiki_safe_match_v1);
// everything else is logged as review / no_article in wiki_safe_match_log.
// Images: only freely licensed Commons files, cached into the entity-images bucket.
// Starts only from the scheduler (per-job token), the service role, or a signed-in admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import { ORG_TYPE_ROOTS, orgDecision, personDecision, pickUnique, resolveTitles, resolveTypeKey, reusableLicense, WIKI_POLICY_VERSION,
  WIKI_RESOLVE_POLICY_VERSION, type WikiPage } from "../_shared/wiki-safe-match.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const JOB = "wiki-safe-matcher";
const CONTROLS_KEY = "wiki_safe_match_controls";
const UA = { "User-Agent": "PodiverzumBot/1.0 (https://podiverzum.hu; wiki safe matcher)" };
const TIME_BUDGET_MS = 110_000;

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function authorized(admin: any, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

async function getJson(url: string, tries = 3): Promise<any> {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15_000) });
      if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 1500 * (a + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise((s) => setTimeout(s, 800 * (a + 1))); }
  }
  return null;
}

const wikiDate = (v: any): string | null => {
  const m = String(v?.time || "").match(/^\+(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2] === "00" ? "01" : m[2]}-${m[3] === "00" ? "01" : m[3]}` : null;
};

async function lookup(name: string, kind: "person" | "organization", orgType?: string) {
  const q = new URL("https://hu.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", titles: name, redirects: "1", prop: "pageprops|extracts|pageimages",
    ppprop: "wikibase_item|disambiguation", exintro: "1", explaintext: "1", exsentences: "4", piprop: "name" })) q.searchParams.set(k, v);
  const j = await getJson(q.toString());
  const page: any = Object.values(j?.query?.pages || {})[0];
  if (!page || page.missing !== undefined || page.invalid !== undefined) return { page: { exists: false } as WikiPage };
  const pp = page.pageprops || {};
  const out: WikiPage = { exists: true, title: page.title, extract: String(page.extract || "").slice(0, 1200), disambiguation: pp.disambiguation !== undefined };
  const qid: string | undefined = pp.wikibase_item;
  const extra: any = { qid, pageimage: page.pageimage || null };
  if (out.disambiguation || !qid) return { page: out, extra };
  const w = await getJson(`https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=${qid}&props=claims|descriptions&languages=hu|en`);
  const ent = w?.entities?.[qid];
  out.p31 = (ent?.claims?.P31 || []).map((c: any) => c?.mainsnak?.datavalue?.value?.id).filter(Boolean);
  out.birth = wikiDate(ent?.claims?.P569?.[0]?.mainsnak?.datavalue?.value);
  out.death = wikiDate(ent?.claims?.P570?.[0]?.mainsnak?.datavalue?.value);
  out.description = ent?.descriptions?.hu?.value || ent?.descriptions?.en?.value || "";
  if (kind === "organization") {
    const roots = (ORG_TYPE_ROOTS[orgType || "other"] || ORG_TYPE_ROOTS.other).map((r) => `wd:${r}`).join(" ");
    const sparql = `ASK { VALUES ?root { ${roots} } wd:${qid} wdt:P31/wdt:P279* ?root . }`;
    const a = await getJson(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`);
    out.typeOk = a?.boolean === true;
  }
  return { page: out, extra };
}

async function freeImage(admin: any, filename: string | null, path: string) {
  if (!filename) return null;
  const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&titles=${encodeURIComponent("File:" + filename)}`);
  const info: any = (Object.values(j?.query?.pages || {})[0] as any)?.imageinfo?.[0];
  const meta = info?.extmetadata || {};
  const license = meta.LicenseShortName?.value || null;
  const licenseUrl = meta.LicenseUrl?.value || null;
  if (!info?.thumburl || !reusableLicense(license, licenseUrl)) return null;
  const strip = (s: string) => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
  const res = await fetch(info.thumburl, { headers: UA, signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  const type = res.headers.get("content-type") || "image/jpeg";
  if (!type.startsWith("image/")) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > 3_000_000) return null;
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  const { error } = await admin.storage.from("entity-images").upload(`${path}.${ext}`, bytes, { contentType: type, upsert: true });
  if (error) return null;
  const { data: pub } = admin.storage.from("entity-images").getPublicUrl(`${path}.${ext}`);
  const author = strip(meta.Artist?.value || "");
  return { image_url: pub.publicUrl, image_original_url: info.descriptionurl || info.url, image_license: license, image_license_url: licenseUrl,
    image_author: author || null, image_attribution: [author || "Wikimedia Commons", license].filter(Boolean).join(", ") };
}

const wikiApi = (params: Record<string, string>) => {
  const q = new URL("https://hu.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({ action: "query", format: "json", ...params })) q.searchParams.set(k, v);
  return getJson(q.toString());
};

// Article links (main namespace) of the disambiguation page for a name.
async function disambigLinks(name: string, rejectedTitle: string | null): Promise<string[]> {
  const titles = [rejectedTitle && /egyértelműsítő/i.test(rejectedTitle) ? rejectedTitle : null, `${name} (egyértelműsítő lap)`].filter(Boolean) as string[];
  const out: string[] = [];
  for (const t of [...new Set(titles)]) {
    const j = await wikiApi({ titles: t, redirects: "1", prop: "links", plnamespace: "0", pllimit: "200" });
    for (const p of Object.values(j?.query?.pages || {}) as any[]) for (const l of p.links || []) out.push(l.title);
  }
  return out;
}

// Which of the titles exist (after redirects), as distinct resolved article titles.
async function existingTitles(titles: string[]): Promise<string[]> {
  const out = new Set<string>();
  for (let i = 0; i < titles.length; i += 40) {
    const j = await wikiApi({ titles: titles.slice(i, i + 40).join("|"), redirects: "1", prop: "pageprops", ppprop: "disambiguation" });
    for (const p of Object.values(j?.query?.pages || {}) as any[]) {
      if (p.missing === undefined && p.invalid === undefined && p.pageprops?.disambiguation === undefined && p.title) out.add(p.title);
    }
  }
  return [...out];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const started = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(admin, req))) return json({ error: "forbidden" }, 403);
  const guard = await checkBackgroundJobsAllowed(admin, JOB);
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
  const body = await req.json().catch(() => ({} as any));
  const { data: cRow } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  const ctrl = (cRow?.value || {}) as any;
  if (ctrl.enabled !== true) return json({ ok: true, paused: true, reason: "disabled_by_controls" });
  const perKind: Record<string, number> = {
    organization: Math.max(0, Math.min(150, Number(body.orgs ?? ctrl.orgs_per_run ?? 50))),
    person: Math.max(0, Math.min(150, Number(body.people ?? ctrl.people_per_run ?? 100))),
  };
  const runId = `wsm-${new Date().toISOString().slice(0, 16)}-${crypto.randomUUID().slice(0, 6)}`;
  const log = runLog(admin, JOB);
  await log.start({ run_id: runId, policy: WIKI_POLICY_VERSION, ...perKind });
  const counts: Record<string, number> = {};
  let seen = 0;
  const bump = (k: string) => { counts[k] = (counts[k] || 0) + 1; };
  try {
    // Second pass first (small, ≤30 s): organizations whose exact-name article was a disambiguation
    // page or the wrong thing get one try with qualified titles + disambiguation links.
    const resolveLimit = Math.max(0, Math.min(40, Number(body.resolve ?? ctrl.resolve_per_run ?? 10)));
    if (resolveLimit > 0) {
      const { data: rc, error: rErr } = await admin.rpc("wiki_safe_resolve_candidates_v1", { _limit: resolveLimit, _base_policy: WIKI_POLICY_VERSION, _policy: WIKI_RESOLVE_POLICY_VERSION });
      if (rErr) throw new Error(`resolve candidates: ${rErr.message}`);
      const rlist = (rc || []) as any[];
      seen += rlist.length;
      const rDeadline = body.only === "resolve" ? TIME_BUDGET_MS : 30_000;
      let ri = 0;
      const rworker = async () => { while (true) {
        const c = rlist[ri++];
        if (!c || Date.now() - started > rDeadline) return;
        try {
          const links = await disambigLinks(c.name, c.rejected_title);
          const titles = await existingTitles(resolveTitles(c.name, c.org_type, c.rejected_title, links));
          const context = ((c.mentions || []) as any[]).flatMap((m: any) => [m.title, m.evidence]).filter(Boolean);
          const looked = await Promise.all(titles.slice(0, 8).map((t) => lookup(t, "organization", resolveTypeKey(c.org_type))));
          const tried: any[] = looked.filter(({ page }) => page.exists && page.title !== c.rejected_title).map(({ page, extra }) => ({
            title: page.title, qid: extra?.qid || null, page, extra,
            decision: orgDecision({ name: c.name, orgType: c.org_type, aliases: c.aliases, context }, page) }));
          const { pick, reason } = pickUnique(tried);
          const summary = tried.map((x) => ({ title: x.title, qid: x.qid, decision: x.decision.decision, reason: x.decision.reason }));
          if (pick && pick.page.title && pick.qid) {
            const img = await freeImage(admin, pick.extra?.pageimage, `orgs/${c.id}-wiki`);
            const why = `resolved(${c.base_reason}):${pick.decision.reason}`;
            const patch: Record<string, unknown> = {
              wikipedia_title: pick.page.title, wikipedia_url: `https://hu.wikipedia.org/wiki/${encodeURIComponent(pick.page.title.replace(/ /g, "_"))}`,
              wikidata_id: pick.qid, wikipedia_extract: pick.page.extract || null, wikipedia_description: pick.page.description || null,
              wikipedia_match_confidence: Math.min(pick.decision.confidence ?? 0.85, 0.85),
              wikipedia_match_evidence: { policy: WIKI_RESOLVE_POLICY_VERSION, reason: why, rejected_title: c.rejected_title, tried: summary, p31: pick.page.p31 },
              ...(img || {}),
            };
            const { data: res, error: aErr } = await admin.rpc("apply_wiki_safe_match_v1", { _kind: "organization", _id: c.id, _patch: patch, _run_id: runId,
              _policy: WIKI_RESOLVE_POLICY_VERSION, _reason: why, _candidate: { wikipedia_title: pick.page.title, qid: pick.qid, tried: summary, image: !!img } });
            if (aErr) throw new Error(aErr.message);
            bump(`resolve:${res === "applied" ? "applied" : "skip"}`);
          } else {
            await admin.from("wiki_safe_match_log").upsert({ run_id: runId, policy_version: WIKI_RESOLVE_POLICY_VERSION, entity_kind: "organization", entity_id: c.id,
              entity_name: c.name, decision: "review", reason, candidate: { tried: summary } }, { onConflict: "entity_kind,entity_id,policy_version", ignoreDuplicates: true });
            bump(`resolve:review`);
          }
        } catch (e) {
          bump("resolve:error");
          await admin.from("wiki_safe_match_log").upsert({ run_id: runId, policy_version: WIKI_RESOLVE_POLICY_VERSION, entity_kind: "organization", entity_id: c.id,
            entity_name: c.name, decision: "error", reason: String(e instanceof Error ? e.message : e).slice(0, 200) }, { onConflict: "entity_kind,entity_id,policy_version", ignoreDuplicates: true });
        }
      }
    }
      } };
      await Promise.all([rworker(), rworker(), rworker()]);
    }
    for (const kind of ["organization", "person"] as const) {
      if (body.only === "resolve") break;
      if (!perKind[kind]) continue;
      const { data: cands, error } = await admin.rpc("wiki_safe_match_candidates_v1", { _kind: kind, _limit: perKind[kind], _policy: WIKI_POLICY_VERSION });
      if (error) throw new Error(`${kind} candidates: ${error.message}`);
      const list = (cands || []) as any[];
      seen += list.length;
      let i = 0;
      // Organizations (slower: type check) get at most half the time so people always progress.
      const deadline = kind === "organization" ? TIME_BUDGET_MS / 2 : TIME_BUDGET_MS;
      const worker = async () => {
        while (true) {
          const c = list[i++];
          if (!c || Date.now() - started > deadline) return;
          try {
            const { page, extra } = await lookup(c.name, kind, c.org_type);
            const context = [...(c.podcasts || []), ...((c.mentions || []) as any[]).flatMap((m: any) => [m.title, m.evidence])].filter(Boolean);
            const d = kind === "person"
              ? personDecision({ name: c.name, aliases: c.aliases, context, sameNamePublic: c.same_name_public, participantRoles: c.participant_roles, firstParticipantAt: c.first_participant_at }, page)
              : orgDecision({ name: c.name, orgType: c.org_type, aliases: c.aliases, context }, page);
            const candidate = { wikipedia_title: page.title || null, qid: extra?.qid || null, description: page.description || null,
              p31: page.p31 || null, birth: page.birth || null, death: page.death || null, type_ok: page.typeOk ?? null, overlap: d.overlap || [],
              extract: (page.extract || "").slice(0, 400) };
            if (d.decision === "accept" && page.title && extra?.qid) {
              const img = await freeImage(admin, extra.pageimage, `${kind === "person" ? "people" : "orgs"}/${c.id}-wiki`);
              const patch: Record<string, unknown> = {
                wikipedia_title: page.title, wikipedia_url: `https://hu.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
                wikidata_id: extra.qid, wikipedia_extract: page.extract || null, wikipedia_description: page.description || null,
                wikipedia_match_confidence: d.confidence, wikipedia_match_evidence: { policy: WIKI_POLICY_VERSION, reason: d.reason, overlap: d.overlap, p31: page.p31 },
                ...(img || {}),
              };
              const { data: res, error: aErr } = await admin.rpc("apply_wiki_safe_match_v1", { _kind: kind, _id: c.id, _patch: patch, _run_id: runId,
                _policy: WIKI_POLICY_VERSION, _reason: d.reason, _candidate: { ...candidate, image: !!img } });
              if (aErr) throw new Error(aErr.message);
              bump(`${kind}:${res === "applied" ? "applied" : "skip"}`);
              if (res === "applied" && img) bump(`${kind}:image`);
            } else {
              await admin.from("wiki_safe_match_log").upsert({ run_id: runId, policy_version: WIKI_POLICY_VERSION, entity_kind: kind, entity_id: c.id,
                entity_name: c.name, decision: d.decision === "accept" ? "review" : d.decision, reason: d.reason, candidate }, { onConflict: "entity_kind,entity_id,policy_version", ignoreDuplicates: true });
              bump(`${kind}:${d.decision}`);
            }
          } catch (e) {
            bump(`${kind}:error`);
            await admin.from("wiki_safe_match_log").upsert({ run_id: runId, policy_version: WIKI_POLICY_VERSION, entity_kind: kind, entity_id: c.id,
              entity_name: c.name, decision: "error", reason: String(e instanceof Error ? e.message : e).slice(0, 200) }, { onConflict: "entity_kind,entity_id,policy_version", ignoreDuplicates: true });
          }
          await new Promise((s) => setTimeout(s, 150)); // polite to Wikimedia
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    }
    // Backlog drained: switch the job off (re-reading controls so an owner change is never undone).
    if (seen === 0 && body.only !== "resolve") {
      const { data: fresh } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
      await admin.from("app_settings").update({ value: { ...(fresh?.value || {}), enabled: false, paused_reason: "queue_empty", drained_at: new Date().toISOString() } }).eq("key", CONTROLS_KEY);
    }
    const summary = { ok: true, run_id: runId, counts, candidates: seen, runtime_ms: Date.now() - started };
    await log.finish("ok", summary);
    return json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log.finish("error", { run_id: runId, counts }, msg).catch(() => {});
    return json({ ok: false, error: msg, counts }, 500);
  }
});
