import {afterEach,describe,it,expect,vi} from 'vitest';
import {episodePilotTick} from '../../supabase/functions/_shared/episode-enrichment-worker';
vi.mock('../../supabase/functions/_shared/runner-run-log',()=>({runLog:()=>({start:vi.fn(),finish:vi.fn()})}));
function fixture(sizes=[101,7]) {
 const jobs=sizes.map((_,n)=>({id:'job'+n,status:'submitted',openai_batch_id:'batch'+n,lease_token:null,lease_until:null}));
 const items=sizes.flatMap((size,n)=>Array.from({length:size},(_,i)=>({episode_id:`e${n}-${i}`,job_id:jobs[n].id,status:'submitted',fingerprint:'fp',input:{episode_id:`e${n}-${i}`,fingerprint:'fp',sources:[],people:[],taxonomy:[]}})));
 const chunks:any[]=[];let afterChunk=()=>{};let allowed=true;let reservationCap=Infinity;let submission:any=null;
 const db:any={from(table:string){let action='select',patch:any,filters:any[]=[];const q:any={
  select(){return q},update(p:any){action='update';patch=p;return q},eq(k:string,v:any){filters.push((r:any)=>r[k]===v);return q},
  not(_k:string,_o:string,v:string){filters.push((r:any)=>!v.slice(1,-1).split(',').includes(r.status));return q},
  in(k:string,v:any[]){filters.push((r:any)=>v.includes(r[k]));return q},order(){return q},limit(){return q},
  gt(k:string,v:string){filters.push((r:any)=>r[k]>v);return q},or(){filters.push((r:any)=>!r.lease_until||Date.parse(r.lease_until)<Date.now());return q},
  async maybeSingle(){return {data:{value:{enabled:true,max_requests_per_job:500}}}},
  then(resolve:any){const rows=(table.endsWith('_jobs')?jobs:items).filter(r=>filters.every(f=>f(r)));if(action==='update' && patch.reserved_cost_usd>reservationCap)return Promise.resolve({error:{message:'evidence_pilot_cap_exceeded'}}).then(resolve);if(action==='update')rows.forEach(r=>Object.assign(r,patch));return Promise.resolve({data:structuredClone(rows)}).then(resolve)}
 };return q;},rpc:vi.fn(async(name:string,args:any)=>{
  if(name==='episode_enrichment_allowed_v1')return {data:allowed};
  if(name==='claim_episode_enrichment_job_v1')return {data:submission||{blocked:'no_selected'}};
  if(name==='episode_enrichment_progress_v1')return {data:{}};
  if(name==='apply_episode_enrichment_chunk_v1') {
   if(!allowed)return {error:{message:'disabled'}};
   chunks.push(args);const out=args.p_items.map((x:any)=>{const i=items.find(i=>i.episode_id===x.episode_id)!;i.status=x.error?'invalid':'applied';return {episode_id:i.episode_id,fingerprint:i.fingerprint,status:i.status}});afterChunk();return {data:out};
  }
  if(name==='finish_episode_enrichment_job_v1'){jobs.find(j=>j.id===args.p_job)!.status='ingested';return {data:{job_id:args.p_job,ingested:true}};}
  throw Error('unexpected '+name);
 })};
 const api=vi.fn(async(path:string)=>{
  if(path==='/files')return {ok:true,data:{id:'uploaded'}};
  if(path==='/batches')return {ok:true,data:{id:'new-batch'}};
  if(path.startsWith('/batches/'))return {ok:true,data:{status:'completed',output_file_id:path.split('/').pop()}};
  const n=Number(path.split('/')[2].replace('batch',''));const rows=items.filter(i=>i.job_id===jobs[n].id).map(i=>({custom_id:`episode-rich-v1|${i.episode_id}|fp`,response:{status_code:200,body:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({summary:null,topics:[],questions:[],entities:[],format:null,people:[]})}]}]}}}));
  return {ok:true,res:{text:async()=>rows.map(r=>JSON.stringify(r)).join('\n')}};
 });
 return {db,api,jobs,items,chunks,prepareSubmission:(size:number,cap:number)=>{
  reservationCap=cap;jobs.push({id:'new',status:'preparing',openai_batch_id:null,lease_token:null,lease_until:null} as any);
  const inputs=Array.from({length:size},(_,i)=>({episode_id:'new'+i,fingerprint:'fp',title:'Minta',published_at:'2026-11-16',podcast_title:'Teszt',clean_hash:'x',sources:[{id:'rss',kind:'episode_description',scope:'episode',text:'Az epizód a magyar gazdaság fejlődéséről, a háztartások megtakarításairól és a pénzügyi tervezésről szól.',url:null}],people:[],taxonomy:[]}));
  items.push(...inputs.map(input=>({episode_id:input.episode_id,job_id:'new',status:'prepared',fingerprint:'fp',input})) as any);
  submission={job_id:'new',lease_token:'newtoken',count:size,items:inputs};
 },setAfterChunk:(fn:()=>void)=>afterChunk=fn,disable:()=>allowed=false};
}
afterEach(()=>vi.restoreAllMocks());
describe('paid output ingestion throughput',()=>{
 it('drains more than 40 and multiple completed jobs, then reaches submission in the same tick',async()=>{
  const f=fixture();await episodePilotTick(f.db,f.api);
  expect(f.items.filter(i=>i.status==='applied')).toHaveLength(108);
  expect(f.chunks.map(c=>c.p_items.length)).toEqual([40,40,21,7]);
  expect(f.jobs.every(j=>j.status==='ingested')).toBe(true);
  expect(f.db.rpc).toHaveBeenCalledWith('claim_episode_enrichment_job_v1',{p_limit:500});
 });
 it('resumes paid output after deadline without settling unseen rows and still reaches submission',async()=>{
  let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
  const f=fixture();f.setAfterChunk(()=>{now+=46000});await episodePilotTick(f.db,f.api);
  expect(f.items.filter(i=>i.status==='applied')).toHaveLength(40);expect(f.jobs[0].status).toBe('submitted');
  expect(f.db.rpc).not.toHaveBeenCalledWith('finish_episode_enrichment_job_v1',expect.anything());
  expect(f.db.rpc).toHaveBeenCalledWith('claim_episode_enrichment_job_v1',{p_limit:500});
  f.setAfterChunk(()=>{});await episodePilotTick(f.db,f.api);expect(f.items.every(i=>i.status==='applied')).toBe(true);
  expect(f.chunks.flatMap(c=>c.p_items).map(i=>i.episode_id)).toHaveLength(108);
 });
 it('stops when controls are disabled between chunks and does not submit',async()=>{
  const f=fixture();f.setAfterChunk(f.disable);await expect(episodePilotTick(f.db,f.api)).rejects.toThrow('disabled');
  expect(f.items.filter(i=>i.status==='applied')).toHaveLength(40);
  expect(f.db.rpc).not.toHaveBeenCalledWith('claim_episode_enrichment_job_v1',expect.anything());
  expect(f.jobs.every(j=>j.lease_token===null)).toBe(true);
 });
 it('shrinks an unpaid job to fit the same budget, preserving deferred episodes',async()=>{
  const f=fixture([]);f.prepareSubmission(4,0.0015);
  // Prepared claim is created only when claim RPC runs, after polling.
  const original=f.db.rpc.getMockImplementation();const job=f.jobs.pop()!;
  f.db.rpc.mockImplementation(async(name:string,args:any)=>{if(name==='claim_episode_enrichment_job_v1')f.jobs.push(job);return original!(name,args)});
  const result:any=await episodePilotTick(f.db,f.api);
  expect(result.submitted).toBe(true);expect(result.episodes).toBe(1);
  expect(result.reserved_usd).toBeLessThanOrEqual(0.0015);
  expect(f.items.filter(i=>i.status==='selected')).toHaveLength(3);
  expect(f.items.filter(i=>i.status==='submitted')).toHaveLength(1);
  expect(f.api.mock.calls.filter(([path])=>path==='/batches')).toHaveLength(1);
 });
 it('does not duplicate applied output after a response is lost',async()=>{
  const f=fixture([50]);let once=true;f.setAfterChunk(()=>{if(once){once=false;throw Error('connection lost after commit')}});
  await expect(episodePilotTick(f.db,f.api)).rejects.toThrow('connection lost');
  await episodePilotTick(f.db,f.api);
  expect(f.chunks.map(c=>c.p_items.length)).toEqual([40,10]);expect(f.items.every(i=>i.status==='applied')).toBe(true);
  expect(f.api.mock.calls.every(([path])=>!['/batches','/files'].includes(path))).toBe(true);
 });
});
