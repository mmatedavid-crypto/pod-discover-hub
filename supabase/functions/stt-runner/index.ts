// stt-runner: drains `stt` jobs and writes Gemini audio transcripts
// into episode_transcripts.
//
// Drain-loop inside one invocation (max ~110s). All knobs from app_settings.stt_controls.
// Supports ?pilot=N&model=... → ad-hoc transcribe N S-tier episodes without touching cron.
//
// Audio flow: GET audio bytes → base64 → Lovable AI Gateway chat completions
// with input_audio content part. Falls back to no-call if audio too large.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Rough pricing for Gemini audio (per 1k tokens). These are approximate;
// audio input is metered by Google differently but we track relative spend.
const PRICING: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash":             { in: 0.000075, out: 0.0003 },
  "google/gemini-2.5-flash-lite":        { in: 0.00003,  out: 0.00012 },
  "google/gemini-3-flash-preview":       { in: 0.000075, out: 0.0003 },
  "google/gemini-3.1-flash-lite-preview":{ in: 0.00003,  out: 0.00012 },
  "google/gemini-3.1-pro-preview":       { in: 0.00125,  out: 0.005 },
  "google/gemini-2.5-pro":               { in: 0.00125,  out: 0.005 },
};
const priceOf = (model: string) => PRICING[model] || PRICING["google/gemini-2.5-flash"];

const SYSTEM_PROMPT =
  "You are a faithful Hungarian podcast transcriber. Return the COMPLETE verbatim transcript of the audio in the source language (Hungarian). Use proper punctuation and paragraph breaks every few sentences. Do NOT summarize, do NOT translate, do NOT add headings, do NOT add speaker labels unless clearly identifiable. Output only the transcript text — nothing else.";

function detectMimeFromUrl(url: string): string {
  const u = url.toLowerCase().split("?")[0];
  if (u.endsWith(".mp3")) return "audio/mpeg";
  if (u.endsWith(".m4a") || u.endsWith(".mp4") || u.endsWith(".aac")) return "audio/mp4";
  if (u.endsWith(".ogg") || u.endsWith(".oga") || u.endsWith(".opus")) return "audio/ogg";
  if (u.endsWith(".wav")) return "audio/wav";
  if (u.endsWith(".webm")) return "audio/webm";
  return "audio/mpeg"; // safe default for podcasts
}

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid spread (stack overflow for big arrays).
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Native Google Generative Language API. Strips `google/` prefix; only Gemini models supported.
// Returns OpenAI-shape `{choices,usage}` so the rest of the runner is unchanged.
async function callGeminiSTT(model: string, audioBase64: string, mime: string) {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("missing_GEMINI_API_KEY");
  const nativeModel = model.replace(/^google\//, "");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${nativeModel}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [
          { text: "Írd át az alábbi magyar podcast hangfelvételt teljes egészében, szöveghűen." },
          { inline_data: { mime_type: mime, data: audioBase64 } },
        ],
      }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 32768 },
    }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402 || res.status === 403) throw new Error(`provider_${res.status}`);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`gemini_${res.status}: ${txt.slice(0, 300)}`);
  }
  const j = await res.json();
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
  const um = j?.usageMetadata || {};
  return {
    choices: [{ message: { content: text } }],
    usage: {
      prompt_tokens: Number(um.promptTokenCount || 0),
      completion_tokens: Number(um.candidatesTokenCount || 0),
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;
  const TAIL_RESERVE_MS = 5_000;

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const guard = await checkBackgroundJobsAllowed(admin, "stt-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const url = new URL(req.url);
    const pilotN = Number(url.searchParams.get("pilot") || 0);
    const overrideModel = url.searchParams.get("model");
    const body = await req.json().catch(() => ({}));

    // Controls
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "stt_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false && !pilotN) return json({ ok: true, paused: true });

    const model = String(overrideModel || body.model || ctrl.model || "google/gemini-2.5-flash");
    const batch = Math.max(1, Math.min(20, Number(body.batch) || ctrl.batch_size || 4));
    const concurrency = Math.max(1, Math.min(8, Number(body.concurrency) || ctrl.concurrency || 2));
    const maxAudioMb = Number(ctrl.max_audio_mb || 25);
    const maxBytes = Math.floor(maxAudioMb * 1024 * 1024);
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 5);
    const maxAttempts = Number(ctrl.max_attempts || 2);

    // Reap stale locks
    let reaped = 0;
    try {
      const { data: r } = await admin.rpc("reap_ai_stale_locks", { _older_than_minutes: 10 });
      reaped = Number(r) || 0;
    } catch { /* ignore */ }

    // Spend today
    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    let spend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    const byKind = { ...(spendRow?.by_kind || {}) };
    if (!pilotN && spend >= dailyBudget) return json({ ok: true, budget_reached: true, spend });

    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0, skipped_too_big = 0;
    let total_claimed = 0, drain_loops = 0;
    const samples: any[] = [];
    let stop = false;

    const runJob = async (job: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
      if (!pilotN && spend >= dailyBudget) {
        await admin.from("ai_enrichment_jobs").update({ status: "pending", locked_until: null }).eq("id", job.id);
        return;
      }
      processed++;
      const audioUrl: string | undefined = job.result?.audio_url;
      const podcastId: string | undefined = job.result?.podcast_id;
      try {
        if (!audioUrl) throw new Error("no_audio_url");

        // Size check via HEAD (some servers don't support it; fall through if not)
        let audioBytes = 0;
        try {
          const head = await fetch(audioUrl, { method: "HEAD", redirect: "follow" });
          const cl = head.headers.get("content-length");
          if (cl) audioBytes = parseInt(cl, 10);
          if (audioBytes && audioBytes > maxBytes) {
            console.log(`skip too_big HEAD ${audioBytes} url=${audioUrl}`);
            skipped_too_big++;
            if (!String(job.id).startsWith("pilot-")) {
              await admin.from("ai_enrichment_jobs").update({
                status: "failed", last_error: `audio_too_large:${audioBytes}`, completed_at: new Date().toISOString(),
              }).eq("id", job.id);
            }
            return;
          }
        } catch { /* ignore */ }

        const aRes = await fetch(audioUrl, { redirect: "follow" });
        if (!aRes.ok) throw new Error(`audio_fetch_${aRes.status}`);
        const buf = new Uint8Array(await aRes.arrayBuffer());
        if (buf.byteLength > maxBytes) {
          console.log(`skip too_big GET ${buf.byteLength} url=${audioUrl}`);
          skipped_too_big++;
          if (!String(job.id).startsWith("pilot-")) {
            await admin.from("ai_enrichment_jobs").update({
              status: "failed", last_error: `audio_too_large:${buf.byteLength}`, completed_at: new Date().toISOString(),
            }).eq("id", job.id);
          }
          return;
        }
        const mime = aRes.headers.get("content-type")?.split(";")[0]?.trim() || detectMimeFromUrl(audioUrl);
        const b64 = bytesToBase64(buf);

        const ai = await callGeminiSTT(model, b64, mime);
        const text: string = ai.choices?.[0]?.message?.content?.toString() || "";
        if (!text || text.length < 20) throw new Error("empty_transcript");

        const usage = ai.usage || {};
        const inTok = Number(usage.prompt_tokens || 0);
        const outTok = Number(usage.completion_tokens || 0);
        const p = priceOf(model);
        const cost = (inTok / 1000) * p.in + (outTok / 1000) * p.out;
        spend += cost; calls++;
        byKind.stt = Number(byKind.stt || 0) + cost;

        // Upsert transcript
        await admin.from("episode_transcripts").upsert({
          episode_id: job.target_id,
          podcast_id: podcastId,
          model,
          language: "hu",
          transcript: text,
          audio_bytes: buf.byteLength,
          input_tokens: inTok,
          output_tokens: outTok,
          cost_usd: cost,
          content_hash: job.input_hash,
          updated_at: new Date().toISOString(),
        }, { onConflict: "episode_id,model" });

        await admin.from("ai_enrichment_jobs").update({
          status: "succeeded",
          completed_at: new Date().toISOString(),
          input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
          model,
          result: { ...(job.result || {}), transcript_chars: text.length },
        }).eq("id", job.id);
        succeeded++;
        if (samples.length < 3) samples.push({ episode_id: job.target_id, chars: text.length, cost_usd: cost, preview: text.slice(0, 220) });
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg === "rate_limited") rate_limited++;
        const finalFail = (job.attempts || 1) >= maxAttempts;
        await admin.from("ai_enrichment_jobs").update({
          status: finalFail ? "failed" : "pending",
          last_error: msg,
          locked_until: null,
          completed_at: finalFail ? new Date().toISOString() : null,
        }).eq("id", job.id);
        failed++;
      }
    };

    // PILOT mode: synthesize jobs in-memory, run, exit (no queue write, no cron change)
    if (pilotN) {
      const { data: pods } = await admin.from("podcasts").select("id").ilike("language", "hu%").eq("shadow_rank_tier", "S").eq("rss_status", "active").limit(60);
      const podIds = (pods || []).map((p: any) => p.id);
      const { data: eps } = await admin
        .from("episodes")
        .select("id, podcast_id, audio_url, title")
        .in("podcast_id", podIds)
        .not("audio_url", "is", null)
        .order("published_at", { ascending: false })
        .limit(pilotN * 10);
      const epIds = (eps || []).map((e: any) => e.id);
      const { data: existing } = await admin.from("episode_transcripts").select("episode_id").in("episode_id", epIds).eq("model", model);
      const haveSet = new Set((existing || []).map((r: any) => r.episode_id));
      const candidates = (eps as any[]).filter(e => !haveSet.has(e.id));

      // No HEAD pre-filter — many CDNs misreport / disallow HEAD. Just take the first few candidates;
      // the GET path enforces maxBytes and will skip oversized files.
      const todo = candidates.slice(0, Math.max(pilotN, 1));
      console.log(`pilot: ${candidates.length} cand, picking ${todo.length} (no HEAD filter)`);



      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= todo.length || stop) return;
          const e = todo[idx];
          await runJob({
            id: `pilot-${e.id}`,
            target_id: e.id,
            input_hash: `pilot|${model}|${e.audio_url}`,
            attempts: 99, // never re-pending
            result: { audio_url: e.audio_url, podcast_id: e.podcast_id, title: e.title },
          });
        }
      });
      await Promise.all(workers);

      // Pilot still updates spend log (do NOT touch real jobs table)
      if (calls > Number(spendRow?.calls || 0)) {
        await admin.from("ai_spend_daily").upsert({
          day: dayKey, spend_usd: spend, calls, by_kind: byKind, updated_at: new Date().toISOString(),
        });
      }
      return json({
        ok: true, pilot: true, model, requested: pilotN, ran: todo.length,
        processed, succeeded, failed, rate_limited, skipped_too_big,
        spend_usd_total: spend, spend_delta_usd: spend - Number(spendRow?.spend_usd || 0),
        samples, elapsed_ms: Date.now() - startedAt,
      });
    }

    // Normal drain loop
    while (!stop) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) break;
      if (spend >= dailyBudget) break;
      const { data: claimed, error: cErr } = await admin.rpc("claim_ai_jobs_by_kind", { _kind: "stt", _limit: batch, _lock_seconds: 300 });
      if (cErr) throw cErr;
      const jobs = (claimed || []) as any[];
      if (!jobs.length) break;
      total_claimed += jobs.length;
      drain_loops++;
      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= jobs.length || stop) return;
          if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
          await runJob(jobs[idx]);
        }
      });
      await Promise.all(workers);
    }

    // Persist spend
    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: spend, calls, by_kind: byKind, updated_at: new Date().toISOString(),
    });

    // Auto-pause on budget
    if (spend >= dailyBudget) {
      await admin.from("app_settings").upsert({
        key: "stt_controls",
        value: { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    }

    return json({
      ok: true, model, claimed: total_claimed, drain_loops, processed, succeeded, failed,
      rate_limited, skipped_too_big, spend_usd: spend, reaped_stale_locks: reaped,
      samples, elapsed_ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("stt-runner error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
