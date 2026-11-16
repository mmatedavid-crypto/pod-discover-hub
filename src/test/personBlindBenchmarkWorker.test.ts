import {describe,it,expect,vi} from 'vitest';
import {personBlindBenchmarkTick} from '../../supabase/functions/_shared/person-blind-benchmark-worker';
const input={episode_id:'22222222-2222-4222-8222-222222222222',fingerprint:'abc',title:'Epizód',published_at:null,podcast_title:'Műsor',clean_hash:null,
 sources:[{id:'rss',kind:'episode_description',scope:'episode',url:null,text:'Vendég: Kovács Péter közgazdász. Az infláció és a megtakarítás kapcsolatáról beszélgetünk. A háztartások helyzetét is elemezzük.'}],
 people:[{id:'11111111-1111-4111-8111-111111111111',name:'Kovács Péter',aliases:[],context:null,identity_risk:false,role_source_hash:'hash'}],taxonomy:[]};
const job=(overrides={})=>({id:'job',lease_token:'token',status:'prepared',items:[{episode_id:input.episode_id,input,status:'prepared'}],...overrides});
function dbFor(j:any,failAction?:string){const actions:any[]=[];return {actions,rpc:vi.fn(async(name,args)=>{actions.push({name,...args});return args.p_action===failAction?{error:{message:'evidence_pilot_cap_exceeded'}}:{data:args.p_action==='claim'?j:{ok:true}};})};}
describe('rich blind benchmark',()=>{
 it('does not contact provider when budget reservation fails and releases owned lease',async()=>{
  const db=dbFor(job(),'reserve'),api=vi.fn(); const out=await personBlindBenchmarkTick(db,api);
  expect(out.blocked).toBe('benchmark_budget');expect(api).not.toHaveBeenCalled();expect(db.actions.at(-1).p_action).toBe('release');
 });
 it('sends the production request without references and never calls public apply',async()=>{
  const db=dbFor(job());const api=vi.fn(async(path,init)=>{if(path==='/files'){const text=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsText(init.body.get('file'));});expect(text).not.toMatch(/label_status|labeled_by/);return {ok:true,data:{id:'file'}};}return {ok:true,data:{id:'batch'}};});
  const out=await personBlindBenchmarkTick(db,api);expect(out.submitted).toBe(true);
  expect(db.actions.map(x=>x.p_action)).toEqual(['claim','reserve','guard','submitting','guard','submitted','release']);
  expect(db.actions.every(x=>x.name==='person_blind_benchmark_step_v1')).toBe(true);
 });
 it('never resubmits an ambiguous POST even if batch list does not find it',async()=>{
  const db=dbFor(job({status:'submitting'}));const api=vi.fn(async()=>({ok:true,data:{data:[]}}));
  expect((await personBlindBenchmarkTick(db,api)).blocked).toBe('benchmark_submission_outcome_unknown');
  expect(api.mock.calls).toHaveLength(1);expect(api.mock.calls[0][0]).toBe('/batches?limit=100');
 });
 it('keeps raw output separate from source-validated output',async()=>{
  const db=dbFor(job({status:'submitted',openai_batch_id:'batch'}));const raw={summary:null,topics:[],questions:[],entities:[],format:null,people:[{person_id:input.people[0].id,role:'guest',descriptor:null,evidence:{source:'rss',quote:'This invented quote is not in the source.'}}]};
  const row={custom_id:`episode-rich-v1|${input.episode_id}|abc`,response:{status_code:200,body:{status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}]}}};
  const api=vi.fn(async(path)=>path.startsWith('/batches/')?{ok:true,data:{status:'completed',output_file_id:'out'}}:{ok:true,res:{text:async()=>JSON.stringify(row)}});
  await personBlindBenchmarkTick(db,api);const saved=db.actions.find(x=>x.p_action==='result').p_payload;
  expect(saved.raw.people).toHaveLength(1);expect(saved.validated.value.people).toHaveLength(0);expect(db.actions.some(x=>x.p_action==='finish')).toBe(true);
 });
});
