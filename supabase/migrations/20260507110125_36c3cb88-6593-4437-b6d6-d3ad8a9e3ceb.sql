create or replace function public.set_deep_hydration_schedule(_schedule text)
returns void
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_jobid int;
begin
  if _schedule not in ('*/2 * * * *', '*/5 * * * *', '*/10 * * * *', '*/30 * * * *') then
    raise exception 'invalid schedule: %', _schedule;
  end if;
  select jobid into v_jobid from cron.job where jobname = 'podiverzum-deep-hydration-every-30-min';
  if v_jobid is null then
    raise exception 'deep hydration cron job not found';
  end if;
  perform cron.alter_job(job_id := v_jobid, schedule := _schedule);
end;
$$;

revoke all on function public.set_deep_hydration_schedule(text) from public;
grant execute on function public.set_deep_hydration_schedule(text) to service_role;