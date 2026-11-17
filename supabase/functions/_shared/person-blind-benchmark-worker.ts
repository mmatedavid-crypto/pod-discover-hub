// Shadow evaluation inside the existing authenticated batch worker/transport.
// References stay in the database and are NEVER read by this worker.
import { buildEpisodeRequest, episodeRequestUpperBound, episodeUsageCost, validateEnrichment } from './episode-enrichment-batch.ts';
import { buildRelationshipRequest, validateRelationships, RELATIONSHIP_POLICY, type RelationshipInput } from './person-relationship-policy.ts';
const supportedPolicies=['episode-rich-v1',RELATIONSHIP_POLICY];
function requestFor(input:RelationshipInput) {
 if (!input.relationship_policy || input.relationship_policy==='episode-rich-v1') return buildEpisodeRequest(input);
 if (input.relationship_policy===RELATIONSHIP_POLICY) return buildRelationshipRequest(input);
 throw new Error('unsupported_benchmark_policy');
}
type Transport = (path: string, init?: RequestInit) => Promise<any>;
const rpc = async (db:any, action:string, token:string|null=null, payload:any={}) => {
 const r=await db.rpc('person_blind_benchmark_step_v1',{p_action:action,p_token:token,p_payload:payload});
 if(r.error) throw new Error(r.error.message); return r.data;
};
export async function personBlindBenchmarkTick(db:any, api:Transport) {
 const j=await rpc(db,'claim'); if(!j?.id) return {...j,supported_policies:supportedPolicies};
 const token=j.lease_token;
 try {
  if(j.status==='submitting' && !j.openai_batch_id) {
   const list=await api('/batches?limit=100');
   if(!list.ok) return {blocked:'benchmark_reconciliation_unavailable'};
   const found=(list.data?.data||[]).find((b:any)=>b.metadata?.person_blind_benchmark_id===j.id);
   if(!found) return {blocked:'benchmark_submission_outcome_unknown'};
   await rpc(db,'submitted',token,{batch_id:found.id});return {reconciled:true};
  }
  if(j.openai_batch_id) {
   const b=await api(`/batches/${j.openai_batch_id}`);if(!b.ok) throw new Error(`benchmark_poll:${b.status}`);
   if(!['completed','expired','cancelled','failed'].includes(b.data.status)) return {waiting:true,batch_id:j.openai_batch_id};
   const byId=new Map(j.items.map((i:any)=>[requestFor(i.input).custom_id,i]));
   for(const file of [b.data.output_file_id,b.data.error_file_id].filter(Boolean)) {
    const out=await api(`/files/${file}/content`);if(!out.ok) throw new Error(`benchmark_output:${out.status}`);
    for(const line of (await out.res.text()).split('\n').filter(Boolean)) {
     const row=JSON.parse(line); const item:any=byId.get(row.custom_id);
     if(!item) throw new Error('benchmark_unexpected_custom_id');
     if(item.status==='evaluated'||item.status==='error') continue;
     const body=row.response?.body;const cost=episodeUsageCost(body?.usage);
     let raw=null,validated=null,error=null;
     try {
      if(row.error||row.response?.status_code!==200||body?.status!=='completed') throw new Error('api_incomplete');
      const content=(body.output||[]).filter((x:any)=>x.type==='message').flatMap((x:any)=>x.content||[]);
      if(content.some((x:any)=>x.type==='refusal')) throw new Error('refusal');
      raw=JSON.parse(content.filter((x:any)=>x.type==='output_text').map((x:any)=>x.text).join(''));
      validated=item.input.relationship_policy===RELATIONSHIP_POLICY?validateRelationships(item.input,raw):validateEnrichment(item.input,raw);
     } catch(e) {error=String(e).slice(0,300);}
     await rpc(db,'result',token,{episode_id:item.episode_id,raw,validated,error,cost});
     item.status=error?'error':'evaluated';
    }
   }
   return await rpc(db,'finish',token,{batch_status:b.data.status});
  }
  const lines=j.items.map((i:any)=>requestFor(i.input));
  const policies=new Set(lines.map((l:any)=>l.custom_id.split('|')[0]));
  if(policies.size!==1) throw new Error('mixed_benchmark_policies');
  const reservation=lines.reduce((n:number,l:any)=>n+episodeRequestUpperBound(l),0);
  try {await rpc(db,'reserve',token,{amount:reservation});}
  catch(e) {if(/cap_exceeded/.test(String(e))) return {blocked:'benchmark_budget',detail:String(e)}; throw e;}
  const form=new FormData();form.append('purpose','batch');
  form.append('file',new Blob([lines.map((x:any)=>JSON.stringify(x)).join('\n')+'\n'],{type:'application/jsonl'}),`person-blind-${j.id}.jsonl`);
  // Guard immediately before both provider writes. Lost upload responses are free;
  // ambiguous batch submission responses are reconciled, never blindly repeated.
  await rpc(db,'guard',token);
  const file=await api('/files',{method:'POST',body:form});if(!file.ok) throw new Error(`benchmark_upload:${file.status}`);
  await rpc(db,'submitting',token,{file_id:file.data.id});
  await rpc(db,'guard',token);
  const b=await api('/batches',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({input_file_id:file.data.id,endpoint:'/v1/responses',completion_window:'24h',metadata:{person_blind_benchmark_id:j.id,policy:[...policies][0]+'-blind'}})});
  if(!b.ok) return {blocked:'benchmark_submission_needs_reconciliation',http_status:b.status};
  await rpc(db,'submitted',token,{batch_id:b.data.id});
  return {submitted:true,batch_id:b.data.id,episodes:lines.length,reserved_usd:reservation};
 } finally {await rpc(db,'release',token);}
}
