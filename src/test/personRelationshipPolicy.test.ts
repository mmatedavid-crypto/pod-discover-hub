import {describe,it,expect} from 'vitest';
import {buildEpisodeRequest,episodeRequestUpperBound,type EpisodeInput} from '../../supabase/functions/_shared/episode-enrichment-batch';
import {buildRelationshipRequest,validateRelationships,assessReference,RELATIONSHIP_POLICY} from '../../supabase/functions/_shared/person-relationship-policy';
const id='11111111-1111-4111-8111-111111111111';
const base:EpisodeInput={episode_id:'22222222-2222-4222-8222-222222222222',title:'Noach hetiszakasz',published_at:'2026-11-17',podcast_title:'T12 Tanház',fingerprint:'source-hash',clean_hash:null,taxonomy:[],
 people:[{id,name:'Zeev Paskesz',aliases:[],context:null,identity_risk:false,role_source_hash:'role-hash'}],
 sources:[{id:'rss',kind:'episode_description',scope:'episode',url:null,text:'T Előadó: Zeev Paskesz'}]};
const claim=(kind='episode_speaker',basis='explicit_episode',source='rss',quote=base.sources[0].text)=>({kind,basis,evidence:[{source,quote}],rationale:'A leírás név szerint megadja az előadót.'});
const raw=(claims:any[])=>({people:[{person_id:id,claims,unknown_reason:null}]});
describe('relationship evidence principle',()=>{
 it.each([
  ['Zeev Paskesz','T Előadó: Zeev Paskesz'],
  ['Szántó-Várnagy Binjomin','T12 Tanház Előadó: Szántó-Várnagy Binjomin'],
  ['Nádudvary Tamás','Felolvasta: Nádudvary Tamás'],
 ])('admits short explicit credit for %s without a public acceptance', (name,text)=>{
  const input={...base,people:[{...base.people[0],name}],sources:[{...base.sources[0],text}]};
  expect(buildEpisodeRequest(input).body.input).toContain(name);
  expect(buildRelationshipRequest(input).custom_id).toContain(RELATIONSHIP_POLICY);
 });
 it.each(['Vendég: Másik Ember','Következő vendég: Zeev Paskesz','Előadó: Zeev Paskesznél','https://example.org/zeev-paskesz','adás archívum',''])('does not waive production source eligibility for %s',text=>{
  expect(()=>buildEpisodeRequest({...base,sources:[{...base.sources[0],text}]})).toThrow('no_episode_source');
 });
 it('does not swallow an editor as an episode speaker',()=>{
  expect(()=>buildEpisodeRequest({...base,sources:[{...base.sources[0],text:'Előadó: Másik Ember Szerkesztő Zeev Paskesz'}]})).toThrow('no_episode_source');
 });
 it('admits named short interview titles, but not a bare name',()=>{
  expect(()=>buildEpisodeRequest({...base,sources:[{...base.sources[0],kind:'episode_title',text:'Életút interjú Zeev Paskesz részvételével'}]})).not.toThrow();
  expect(()=>buildEpisodeRequest({...base,sources:[{...base.sources[0],kind:'episode_title',text:'Zeev Paskesz'}]})).toThrow();
 });
 it('can assess known episode context without pretending that a description exists',()=>{
  const r=buildRelationshipRequest({...base,sources:[]});
  expect(JSON.parse(r.body.input).sources).toEqual([]);
  expect(r.body.instructions).toContain('model_knowledge');
  expect(()=>buildRelationshipRequest({...base,podcast_title:''})).toThrow('missing_relationship_context');
 });
 it('keeps source-free background knowledge as a researchable hypothesis',()=>{
  const c={kind:'show_host',basis:'model_knowledge',evidence:[],rationale:'Háttértudásom szerint a műsor házigazdája; a bemenet ezt nem igazolja.'};
  const r=validateRelationships(base,raw([c]));
  expect(r.errors).toEqual([]);
  expect(r.value.people[0].claims[0]).toMatchObject({...c,route:'source_research',public_apply:false});
  expect(assessReference(r.value,id,'accepted','show_host')).toMatchObject({proposed_positive:true,inferred_positive:true,source_supported_positive:false,quality_gate_passed:false});
 });
 it('distinguishes show role from episode appearance, including in benchmark scoring',()=>{
  const show={...base,sources:[{...base.sources[0],id:'show',kind:'show_description',scope:'show' as const,text:'Műsorvezető: Zeev Paskesz'}]};
  const r=validateRelationships(show,raw([claim('show_host','explicit_show','show',show.sources[0].text)]));
  expect(r.value.people[0].claims[0].route).toBe('show_host_rule_review');
  expect(assessReference(r.value,id,'accepted','show_host').source_supported_positive).toBe(true);
  expect(assessReference(r.value,id,'accepted','episode_participant').abstained).toBe(true);
  const bad=validateRelationships(show,raw([claim('episode_host','explicit_show','show',show.sources[0].text)]));
  expect(bad.value.people[0].claims[0]).toMatchObject({evidence_valid:false,route:'invalid_evidence',public_apply:false});
 });
 it('allows two different supported roles for one person without collapsing them',()=>{
  const input={...base,sources:[{...base.sources[0],text:'Szerző: Zeev Paskesz. Felolvasta: Zeev Paskesz.'}]};
  const r=validateRelationships(input,raw([claim('author','explicit_episode','rss','Szerző: Zeev Paskesz.'),claim('episode_narrator','explicit_episode','rss','Felolvasta: Zeev Paskesz.')]));
  expect(r.value.people[0].claims.map(c=>c.route)).toEqual(['credit_review','episode_evidence_review']);
 });
 it('does not count authorship as a speaking appearance',()=>{
  const input={...base,sources:[{...base.sources[0],text:'Szerző: Zeev Paskesz. Felolvasta: Másik Ember.'}]};
  const r=validateRelationships(input,raw([claim('author','explicit_episode','rss','Szerző: Zeev Paskesz.')]));
  expect(assessReference(r.value,id,'accepted','episode_participant').source_supported_positive).toBe(false);
  expect(assessReference(r.value,id,'accepted','contribution').source_supported_positive).toBe(true);
 });
 it('keeps invalid, invented, wrong-scope and unrelated quotes out of supported metrics',()=>{
  for(const c of [claim('episode_guest','explicit_episode','rss','Ezt az idézetet a modell találta ki.'),claim('episode_host','explicit_episode','show','Műsorvezető: Zeev Paskesz'),{...claim(),evidence:[null]}]){
   const r=validateRelationships(base,raw([c]));
   expect(r.errors).toContain('invalid_evidence');
   expect(assessReference(r.value,id,'accepted','episode_participant').source_supported_positive).toBe(false);
  }
 });
 it('retains identity blockers after assessment without telling the blind model the decision',()=>{
  const r=validateRelationships({...base,people:[{...base.people[0],identity_risk:true}]},raw([claim()]));
  expect(r.value.people[0].claims[0].route).toBe('identity_review');
 });
 it('explicitly whitelists input fields instead of leaking goldens or repair notes',()=>{
  const dirty:any={...base,label_status:'accepted',reference_target:'speaker',people:[{...base.people[0],context:'Human accepted reference',label_status:'accepted',labeled_by:'secret-user',identity_risk:true}],sources:[{...base.sources[0],reference_label:'accepted'}]};
  const s=buildRelationshipRequest(dirty).body.input;
  expect(s).not.toMatch(/label_status|reference_target|labeled_by|reference_label|identity_risk|role_source_hash|Human accepted/);
 });
 it('does not improve apparent recall by dropping missing candidates or scoring ambiguous references',()=>{
  const r=validateRelationships(base,{people:[]});
  expect(r.value.people).toHaveLength(1);expect(r.errors).toContain('missing_person');
  expect(assessReference(r.value,id,'accepted','legacy_unspecified')).toMatchObject({comparable:false,quality_gate_passed:false});
 });
 it('rejects unknown policies at worker boundary and budgets the complete relationship request',()=>{
  expect(episodeRequestUpperBound(buildRelationshipRequest(base))).toBeGreaterThan(.00075);
  expect(()=>buildRelationshipRequest({...base,sources:[{...base.sources[0],text:'a'.repeat(240001)}]})).toThrow('source_package_too_large');
 });
});
