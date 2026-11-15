import { describe,it,expect } from 'vitest';
import { buildEpisodeRequest, validateEnrichment, deterministicPersonItems, promptInput, episodeRequestUpperBound, episodeUsageCost, type EpisodeInput } from '../../supabase/functions/_shared/episode-enrichment-batch';
const person='11111111-1111-4111-8111-111111111111';
const input:EpisodeInput={episode_id:'22222222-2222-4222-8222-222222222222',fingerprint:'abc',title:'Infláció és megtakarítás',published_at:'2026-11-15',podcast_title:'Minta',clean_hash:'hash',
 sources:[{id:'rss',kind:'episode_description',scope:'episode',url:null,text:'Vendég: Kovács Péter közgazdász. Az infláció és a megtakarítás kapcsolatáról beszélgetünk. A háztartások helyzetét is elemezzük.'},
 {id:'show',kind:'show_description',scope:'show',url:null,text:'Műsorvezető: Kovács Péter közgazdász.'}],people:[{id:person,name:'Kovács Péter',aliases:[],context:null,identity_risk:false,role_source_hash:'rolehash'}],taxonomy:[{id:'topic-1',name:'Infláció'}]};
const ev={source:'rss',quote:'Az infláció és a megtakarítás kapcsolatáról beszélgetünk.'};
const result=()=>({summary:{text:'Az epizód az infláció és a megtakarítás kapcsolatáról szól.',evidence:[ev]},topics:[{topic_id:'topic-1',label:'infláció',evidence:ev}],questions:[{text:'Hogyan függ össze az infláció és a megtakarítás?',evidence:ev}],entities:[],format:null,
 people:[{person_id:person,role:'guest',descriptor:'közgazdász',evidence:{source:'rss',quote:'Vendég: Kovács Péter közgazdász.'}}]});
describe('episode-rich-v1',()=>{
 it('uses one episode request, approved model and Batch-compatible Responses schema',()=>{
  const r=buildEpisodeRequest(input);expect(r.url).toBe('/v1/responses');expect(r.body.model).toBe('gpt-6-luna');expect(r.body.store).toBe(false);expect(r.body.reasoning.effort).toBe('none');expect(r.body.text.format.strict).toBe(true);
  expect(r.body.input).not.toContain('role_source_hash');expect(r.custom_id).toContain(input.episode_id);
 });
 it('does not turn show-level host text into episode evidence',()=>{
  const raw=result();raw.people[0].evidence={source:'show',quote:'Műsorvezető: Kovács Péter közgazdász.'};expect(validateEnrichment(input,raw).value.people).toEqual([]);
 });
 it('drops invented quotes, unrelated identities and invented taxonomy ids',()=>{
  const raw=result();raw.topics[0].topic_id='not-real';raw.questions[0].evidence.quote='Ezt a szöveget kitaláltam';raw.people[0].person_id='other';
  const r=validateEnrichment(input,raw);expect(r.value.topics).toEqual([]);expect(r.value.questions).toEqual([]);expect(r.value.people).toEqual([]);
 });
 it('deduplicates equal source bodies without merging show/episode scope',()=>{
  const r=promptInput({...input,sources:[...input.sources,{...input.sources[0],id:'copy'}]});expect(r.sources).toHaveLength(2);
 });
 it('passes only deterministic exact role hits to the existing identity RPC',()=>{
  const r=validateEnrichment(input,result());expect(deterministicPersonItems(input,r.value)[0]).toMatchObject({person_id:person,episode_id:input.episode_id,role:'guest',source_hash:'rolehash'});
  expect(deterministicPersonItems({...input,people:[{...input.people[0],identity_risk:true}]},r.value)).toEqual([]);
 });
 it('keeps editor or merely mentioned names out of accepted speakers',()=>{
  const v={...input,sources:[{...input.sources[0],text:'Szerkesztő: Kovács Péter. Beszélgetés az inflációról és a megtakarításokról.'}]};
  expect(deterministicPersonItems(v,result() as any)).toEqual([]);
 });
 it('does not use generated source-less summary',()=>{const r=result();r.summary.evidence=[];expect(validateEnrichment(input,r).value.summary).toBeNull();});
 it('rejects oversized source packages instead of silently removing evidence',()=>{expect(()=>buildEpisodeRequest({...input,sources:[{...input.sources[0],text:'a'.repeat(240001)}]})).toThrow('source_package_too_large');});
 it('cost reservation includes JSON schema and gives no assumed cache saving',()=>{expect(episodeRequestUpperBound(buildEpisodeRequest(input))).toBeGreaterThan(3000*0.25/1e6);expect(episodeUsageCost({input_tokens:1000,output_tokens:1000})).toBeCloseTo(.0003);});
 it('source missing returns no fake successful work',()=>{expect(()=>buildEpisodeRequest({...input,sources:[]})).toThrow('no_episode_source');});
});
