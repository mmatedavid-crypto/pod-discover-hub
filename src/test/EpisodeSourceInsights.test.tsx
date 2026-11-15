import { beforeEach,describe,it,expect,vi } from 'vitest';
import { act,render,screen } from '@testing-library/react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { EpisodeSourceInsights } from '../components/EpisodeSourceInsights';
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc}}));
const show=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MemoryRouter><EpisodeSourceInsights episodeId="episode"/></MemoryRouter></QueryClientProvider>);
describe('episode source insights public use',()=>{
 beforeEach(()=>rpc.mockReset());
 it('renders useful questions and a quoted search link, without exposing private source evidence',async()=>{
  rpc.mockResolvedValue({data:{questions:['Hogyan működik az infláció?'],entities:[{name:'Magyar Nemzeti Bank',kind:'organization'}],format:'interjú',evidence:'PRIVATE TRANSCRIPT QUOTE'}});
  show();expect(await screen.findByText('Hogyan működik az infláció?')).toBeTruthy();
  expect(screen.getByRole('link',{name:'Magyar Nemzeti Bank'}).getAttribute('href')).toBe('/kereses?q=%22Magyar%20Nemzeti%20Bank%22');
  expect(screen.queryByText('PRIVATE TRANSCRIPT QUOTE')).toBeNull();expect(screen.queryByRole('button')).toBeNull();
 });
 it('does not show an empty block when public results are disabled',async()=>{
  rpc.mockResolvedValue({data:null});const r=show();await act(async()=>{await new Promise(resolve=>setTimeout(resolve,10));});expect(r.container.textContent).toBe('');
 });
});
