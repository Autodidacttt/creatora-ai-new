-- 0018: Align earlier read models with the project state machine.
-- campaign_creators now also holds sprint entrants that were never hired (status applied/shortlisted/...),
-- so every "selected / hired" count filters on hired_at. Functions are patched in place from their live
-- definition; a patch fails loudly if the text it expects isn't there.

create or replace function private.patch_function(p_sig regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_sig);
begin
  if position(p_old in d) = 0 then
    raise exception 'patch_function: expected text not found in %', p_sig;
  end if;
  execute replace(d, p_old, p_new);
end $$;

-- Campaign card: "selected" means hired; expose the caller's own project; studio inputs stay private to the brand
select private.patch_function('public.campaign_card(uuid)'::regprocedure,
$o$    'my_selected', exists (select 1 from public.campaign_creators s
                           where s.campaign_id = c.id and s.creator_id = auth.uid()),$o$,
$n$    'my_selected', exists (select 1 from public.campaign_creators s
                           where s.campaign_id = c.id and s.creator_id = auth.uid() and s.hired_at is not null),
    'my_project', (select jsonb_build_object('id', s.id, 'status', s.status) from public.campaign_creators s
                   where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'sprint_closed', c.is_sprint and c.sprint_deadline <= now(),$n$);
select private.patch_function('public.campaign_card(uuid)'::regprocedure,
$o$to_jsonb(c) - 'search'$o$,
$n$to_jsonb(c) - 'search' - (case when c.brand_id = auth.uid() then '{}'::text[]
                                   else array['source_idea', 'source_url', 'source_summary', 'studio_step'] end)$n$);

-- Experience counts only real hires
select private.patch_function('public.rank_creators_for_campaign(uuid,integer,integer,boolean,uuid[])'::regprocedure,
$o$(select count(*) from public.campaign_creators x where x.creator_id = b.id) as exp_count$o$,
$n$(select count(*) from public.campaign_creators x where x.creator_id = b.id and x.hired_at is not null) as exp_count$n$);

-- Closed sprints disappear from "For you"
select private.patch_function('public.get_opportunities(text,integer,integer)'::regprocedure,
$o$      and c.brand_id is distinct from (select uid from me)$o$,
$n$      and (not c.is_sprint or c.sprint_deadline > now() or p_tab in ('saved', 'applied'))
      and c.brand_id is distinct from (select uid from me)$n$);

-- Creator dashboard career section
select private.patch_function('public.dashboard_career(uuid,date,date)'::regprocedure,
$o$hired as (select * from public.campaign_creators where creator_id = p_creator$o$,
$n$hired as (select * from public.campaign_creators where creator_id = p_creator and hired_at is not null$n$);
select private.patch_function('public.dashboard_career(uuid,date,date)'::regprocedure,
$o$where x.creator_id = p_creator and x.status = 'selected' and c.status = 'active'),$o$,
$n$where x.creator_id = p_creator and x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')),$n$);
select private.patch_function('public.dashboard_ai_evidence(uuid)'::regprocedure,
$o$'hired', (select count(*) from public.campaign_creators where creator_id = p_creator),$o$,
$n$'hired', (select count(*) from public.campaign_creators where creator_id = p_creator and hired_at is not null),$n$);

-- Simple dashboards: redefined (small)
create or replace function public.get_brand_dashboard()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'campaigns', (select count(*) from public.campaigns where brand_id = auth.uid()),
    'active', (select count(*) from public.campaigns where brand_id = auth.uid() and status = 'active'),
    'applications', (select count(*) from public.campaign_applications a
                     join public.campaigns c on c.id = a.campaign_id
                     where c.brand_id = auth.uid() and a.status <> 'withdrawn'),
    'shortlisted', (select count(*) from public.campaign_shortlists s
                    join public.campaigns c on c.id = s.campaign_id where c.brand_id = auth.uid()),
    'selected', (select count(*) from public.campaign_creators s
                 join public.campaigns c on c.id = s.campaign_id where c.brand_id = auth.uid() and s.hired_at is not null),
    'liked_creators', (select count(distinct target_id) from public.interactions
                       where user_id = auth.uid() and target_type = 'profile' and action = 'swipe_right'));
$$;

create or replace function public.get_creator_dashboard()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'applications', (select count(*) from public.campaign_applications
                     where creator_id = auth.uid() and status <> 'withdrawn'),
    'shortlisted', (select count(*) from public.campaign_shortlists where creator_id = auth.uid()),
    'selected', (select count(*) from public.campaign_creators where creator_id = auth.uid() and hired_at is not null),
    'active_projects', (select count(*) from public.campaign_creators x join public.campaigns c on c.id = x.campaign_id
                        where x.creator_id = auth.uid()
                          and (x.status in ('hired', 'in_progress', 'submitted', 'revision_requested', 'resubmitted', 'approved')
                               or (c.is_sprint and x.status in ('applied', 'shortlisted') and c.sprint_deadline > now()))),
    'revisions_requested', (select count(*) from public.campaign_creators where creator_id = auth.uid() and status = 'revision_requested'),
    'saved_opportunities', (select count(*) from public.saved_opportunities where creator_id = auth.uid()),
    'profile_views', (select count(*) from public.interactions
                      where target_type = 'profile' and target_id = auth.uid() and action = 'view'),
    'brand_interest', (select count(distinct i.user_id) from public.interactions i
                       join public.profiles p on p.id = i.user_id and p.role = 'brand'
                       where i.target_type = 'profile' and i.target_id = auth.uid()
                         and i.action in ('swipe_right', 'contact', 'shortlist')));
$$;

-- Pipeline tab keeps its two stages: hired projects show as "selected" until completed
create or replace function public.get_campaign_pipeline(p_campaign uuid)
returns table (creator jsonb, stage text, note text, created_at timestamptz, applied boolean)
language sql stable set search_path = public as $$
  select public.creator_card(s.creator_id), 'shortlisted', s.note, s.created_at,
         exists (select 1 from public.campaign_applications a where a.campaign_id = s.campaign_id
                 and a.creator_id = s.creator_id and a.status <> 'withdrawn')
  from public.campaign_shortlists s where s.campaign_id = p_campaign
  union all
  select public.creator_card(x.creator_id), case when x.status = 'completed' then 'completed' else 'selected' end, null,
         coalesce(x.hired_at, x.created_at),
         exists (select 1 from public.campaign_applications a where a.campaign_id = x.campaign_id
                 and a.creator_id = x.creator_id and a.status <> 'withdrawn')
  from public.campaign_creators x
  where x.campaign_id = p_campaign and x.hired_at is not null and x.status not in ('cancelled', 'rejected')
  order by 4 desc;
$$;

create or replace view public.campaign_stats with (security_invoker = true) as
select
  c.id as campaign_id,
  (select count(*) from public.campaign_applications a
     where a.campaign_id = c.id and a.status <> 'withdrawn')::int as applications_count,
  (select count(*) from public.campaign_shortlists s where s.campaign_id = c.id)::int as shortlisted_count,
  (select count(*) from public.campaign_creators x
     where x.campaign_id = c.id and x.hired_at is not null and x.status not in ('cancelled', 'rejected'))::int as selected_count
from public.campaigns c;

drop function private.patch_function(regprocedure, text, text);
