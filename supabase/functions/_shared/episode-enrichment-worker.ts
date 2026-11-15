// Called ONLY by the existing, authenticated person-relevance-openai-batch worker.
import { buildEpisodeRequest, deterministicPersonItems, episodeRequestUpperBound, episodeUsageCost, validateEnrichment, EPISODE_BATCH_VERSION, type EpisodeInput } from './episode-enrichment-batch.ts';
import { runLog } from './runner-run-log.ts';
type Transport = (path: string, init?: RequestInit) => Promise<any>;
const rpc = async (db: any, name: string, args: any = {}) => { const r = await db.rpc(name,args); if(r.error) throw new Error(`${name}:${r.error.message}`); return r.data; };
const check = (r: any) => { if(r.error) throw new Error(r.error.message); return r.data; };
const terminal = ['completed','expired','cancelled','failed'];

async function controls(db: any) {
 const row = check(await db.from('app_settings').select('value').eq('key','episode_enrichment_pilot_controls').maybeSingle());
 return row?.value || {};
}
async function jobPatch(db:any,id:string,patch:any) {
 if(!await rpc(db,'episode_enrichment_allowed_v1',{p_require_enabled:false})) throw new Error('background_disabled');
 check(await db.from('episode_enrichment_pilot_jobs').update({...patch,updated_at:new Date().toISOString()}).eq('id',id));
}
export async function episodePilotStatus(db:any) {
 const ctrl = await controls(db);
 const {data:jobs,error}=await db.from('episode_enrichment_pilot_jobs').select('id,status,model,request_count,reserved_cost_usd,actual_cost_usd,last_error,created_at,openai_batch_id').order('created_at',{ascending:false}).limit(25);
 if(error) throw error;
 return {policy:EPISODE_BATCH_VERSION,controls:ctrl,jobs,counts:await rpc(db,'episode_enrichment_pilot_counts_v1')};
}
async function ingest(db:any,api:Transport,job:any,batch:any) {
 const stopAt=Date.now()+60000;let processed=0;
 const stored=check(await db.from('episode_enrichment_pilot_items').select('episode_id,input,fingerprint,status,cost_usd').eq('job_id',job.id));
 const byId=new Map<string,any>((stored||[]).map((i:any)=>[`${EPISODE_BATCH_VERSION}|${i.episode_id}|${i.fingerprint}`,i]));
 for(const file of [batch.output_file_id,batch.error_file_id].filter(Boolean)) {
  const response=await api(`/files/${file}/content`);
  if(!response.ok) throw new Error(`output_fetch:${response.status}`);
  const lines=(await response.res.text()).split('\n').filter(Boolean);
  for(const line of lines) {
   let row:any;try{row=JSON.parse(line);}catch{throw new Error('invalid_batch_output_line');}
   const item=byId.get(row.custom_id);if(!item) throw new Error('unexpected_custom_id');
   if(['applied','stale','invalid','api_error'].includes(item.status)) continue;
   // Resume the same paid output next tick instead of overrunning the edge execution window.
   if(processed>=40 || Date.now()>stopAt) return {job_id:job.id,partial:true,processed};
   processed++;
   if(!await rpc(db,'episode_enrichment_allowed_v1')) return {paused:true};
   const body=row.response?.body;const cost=episodeUsageCost(body?.usage);
   const saveInvalid=async(error:string)=>{check(await db.from('episode_enrichment_pilot_items').update({status:'invalid',error,cost_usd:cost}).eq('episode_id',item.episode_id).in('status',['prepared','submitted']));item.status='invalid';};
   if(row.error || row.response?.status_code!==200 || body?.status!=='completed') {
    await saveInvalid(String(row.error?.code||body?.error?.code||body?.incomplete_details?.reason||'api_incomplete'));continue;
   }
   const content=(body.output||[]).filter((o:any)=>o.type==='message').flatMap((o:any)=>o.content||[]);
   if(content.some((c:any)=>c.type==='refusal')){await saveInvalid('refusal');continue;}
   let validated:any;
   try{validated=validateEnrichment(item.input,JSON.parse(content.filter((c:any)=>c.type==='output_text').map((c:any)=>c.text).join('')));}
   catch(e){await saveInvalid(String(e).slice(0,200));continue;}
   // DB transaction verifies the original full-source fingerprint again and keeps before-states.
   await rpc(db,'apply_episode_enrichment_item_v1',{p_episode:item.episode_id,p_fingerprint:item.fingerprint,p_result:validated.value,p_errors:validated.errors,
     p_role_items:deterministicPersonItems(item.input,validated.value),p_cost:cost});
   item.status='applied';
  }
 }
 const remaining=check(await db.from('episode_enrichment_pilot_items').select('episode_id').eq('job_id',job.id).in('status',['prepared','submitted']));
 // Explicit error output / terminal batch establishes no result; never auto-repay these inputs.
 if(remaining?.length) check(await db.from('episode_enrichment_pilot_items').update({status:'api_error',error:`batch_${batch.status}_without_output`}).eq('job_id',job.id).in('status',['prepared','submitted']));
 const costs=check(await db.from('episode_enrichment_pilot_items').select('cost_usd').eq('job_id',job.id));
 const total=(costs||[]).reduce((n:number,r:any)=>n+Number(r.cost_usd||0),0);
 await jobPatch(db,job.id,{status:'ingested',actual_cost_usd:total,lease_token:null,lease_until:null});
 return {job_id:job.id,ingested:true,actual_cost_usd:total};
}
export async function episodePilotTick(db:any,api:Transport) {
 const ctrl=await controls(db);
 if(ctrl.enabled!==true || !await rpc(db,'episode_enrichment_allowed_v1')) return {skipped:'episode_pilot_disabled',policy:EPISODE_BATCH_VERSION};
 const log=runLog(db,'episode-enrichment-pilot');await log.start({policy:EPISODE_BATCH_VERSION});
 let failed=false;
 try {
  const jobs=check(await db.from('episode_enrichment_pilot_jobs').select('*').not('status','in','(ingested,aborted,failed)').order('created_at').limit(12));
  for(const job of jobs||[]) {
   if(!job.openai_batch_id) {
    if(job.status==='submitting') {
     // A timeout after POST /batches is ambiguous. Read back, never submit the job twice.
     const list=await api('/batches?limit=100');
     if(!list.ok) return {blocked:'submission_reconciliation_unavailable',job_id:job.id};
     const found=(list.data?.data||[]).find((b:any)=>b.metadata?.episode_pilot_job_id===job.id);
     if(!found) return {blocked:'submission_outcome_unknown',job_id:job.id};
     await jobPatch(db,job.id,{openai_batch_id:found.id,status:'submitted'});return {reconciled:job.id};
    }
    if(job.lease_until && new Date(job.lease_until).getTime()>Date.now()) continue;
    // No batch POST has been attempted. An upload-only orphan is free and may be abandoned.
    check(await db.from('episode_enrichment_pilot_items').update({status:'selected',job_id:null,input:null,fingerprint:null}).eq('job_id',job.id).eq('status','prepared'));
    await jobPatch(db,job.id,{status:'aborted',last_error:'pre_submit_worker_interrupted'});return {released:job.id};
   }
   const claim=check(await db.from('episode_enrichment_pilot_jobs').update({lease_token:crypto.randomUUID(),lease_until:new Date(Date.now()+120000).toISOString()})
    .eq('id',job.id).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select('lease_token'));
   if(!claim?.length) continue;
   const token=claim[0].lease_token;
   try {
    const b=await api(`/batches/${job.openai_batch_id}`);if(!b.ok) throw new Error(`batch_poll:${b.status}`);
    if(!terminal.includes(b.data.status)) continue;
    return await ingest(db,api,job,b.data);
   } finally { check(await db.from('episode_enrichment_pilot_jobs').update({lease_token:null,lease_until:null}).eq('id',job.id).eq('lease_token',token)); }
  }
  if(ctrl.submit_paused_reason) return {blocked:ctrl.submit_paused_reason};
  const claimed=await rpc(db,'claim_episode_enrichment_job_v1',{p_limit:Math.min(500,Number(ctrl.max_requests_per_job)||500)});
  if(!claimed.job_id || !claimed.count) {
   if(claimed.blocked==='no_selected') await rpc(db,'episode_enrichment_progress_v1',{p_event:'finish',p_detail:null});
   return claimed;
  }
  const id=claimed.job_id;const items=claimed.items as EpisodeInput[];
  const lines:ReturnType<typeof buildEpisodeRequest>[]=[];let bytes=0;const deferred:string[]=[];
  for(const input of items){
   let line:ReturnType<typeof buildEpisodeRequest>;
   try{line=buildEpisodeRequest(input);}catch(e){
    check(await db.from('episode_enrichment_pilot_items').update({status:'source_unavailable',error:String(e).slice(0,200)}).eq('job_id',id).eq('episode_id',input.episode_id));continue;
   }
   const size=new TextEncoder().encode(JSON.stringify(line)).length+1;
   if(bytes+size>24*1024*1024){deferred.push(input.episode_id);continue;}
   bytes+=size;lines.push(line);
  }
  if(deferred.length) check(await db.from('episode_enrichment_pilot_items').update({status:'selected',job_id:null,input:null,fingerprint:null}).eq('job_id',id).in('episode_id',deferred));
  await jobPatch(db,id,{request_count:lines.length});
  if(!lines.length){await jobPatch(db,id,{status:'aborted',last_error:'no_usable_episode_inputs'});return {blocked:'source_package'};}
  const reservation=lines.reduce((n,l)=>n+episodeRequestUpperBound(l),0);
  // Existing global grant, daily ceiling and the 5 USD pilot cap all apply through the job trigger.
  try{await jobPatch(db,id,{reserved_cost_usd:reservation,status:'uploading'});}catch(e){
   check(await db.from('episode_enrichment_pilot_items').update({status:'selected',job_id:null}).eq('job_id',id).eq('status','prepared'));
   await jobPatch(db,id,{status:'aborted',last_error:String(e).slice(0,200)});
   await rpc(db,'episode_enrichment_progress_v1',{p_event:'budget_blocked',p_detail:String(e).slice(0,200)});
   return {blocked:'budget_reservation',detail:String(e).slice(0,200)};
  }
  const blob=new Blob([lines.map(l=>JSON.stringify(l)).join('\n')+'\n'],{type:'application/jsonl'});
  if(blob.size>24*1024*1024) throw new Error('batch_file_too_large');
  if(!await rpc(db,'episode_enrichment_allowed_v1')) throw new Error('disabled_before_upload');
  const form=new FormData();form.append('purpose','batch');form.append('file',blob,`episode-rich-${id}.jsonl`);
  const upload=await api('/files',{method:'POST',body:form});
  if(!upload.ok) {await jobPatch(db,id,{last_error:`upload:${upload.status}`});return {blocked:'upload_failed'};}
  await jobPatch(db,id,{openai_input_file_id:upload.data.id,status:'submitting'});
  if(!await rpc(db,'episode_enrichment_allowed_v1')) throw new Error('disabled_before_submit');
  const batch=await api('/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input_file_id:upload.data.id,endpoint:'/v1/responses',completion_window:'24h',metadata:{episode_pilot_job_id:id,policy:EPISODE_BATCH_VERSION}})});
  if(!batch.ok) {
   if(batch.status>=400 && batch.status<500 && batch.status!==408) {
    // A definite rejection did not create a paid batch. Preserve the work and release reservation.
    check(await db.from('episode_enrichment_pilot_items').update({status:'selected',job_id:null}).eq('job_id',id).eq('status','prepared'));
    await jobPatch(db,id,{status:'aborted',last_error:`submit_rejected:${batch.status}:${batch.error}`});
    return {blocked:'provider_rejected',job_id:id,status:batch.status};
   }
   await jobPatch(db,id,{last_error:`submit:${batch.status}:${batch.error}`});return {blocked:'submission_needs_reconciliation',job_id:id};
  }
  await jobPatch(db,id,{status:'submitted',openai_batch_id:batch.data.id,lease_token:null,lease_until:null});
  check(await db.from('episode_enrichment_pilot_items').update({status:'submitted'}).eq('job_id',id).eq('status','prepared'));
  return {submitted:true,job_id:id,openai_batch_id:batch.data.id,episodes:lines.length,reserved_usd:reservation};
 } catch(e) {failed=true;await log.finish('error',{},String(e));throw e;}
 finally {if(!failed) await log.finish('ok');}
}
