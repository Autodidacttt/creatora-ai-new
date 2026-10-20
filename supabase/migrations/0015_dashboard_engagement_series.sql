-- 0015: add a 7-day rolling engagement rate to the dashboard series (computed in SQL, not the browser).
-- Rolling: (likes + comments + saves over the trailing 7 days) / (views over the same 7 days) × 100.

drop function if exists public.dashboard_series(uuid, date, date);

create or replace function public.dashboard_series(p_creator uuid, p_from date, p_to date)
returns table (day date, views int, watch_ms bigint, likes int, comments int, saves int,
               new_followers int, followers int, visits int, inquiries int, earnings bigint,
               engagement_rate_7d numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform public.dashboard_assert(p_creator);
  if p_to < p_from or p_to - p_from > 400 then raise exception 'Invalid date range'; end if;
  return query
  with days as (select d::date as day from generate_series(p_from - 6, p_to, interval '1 day') d),
  v as (select (created_at at time zone 'utc')::date d, count(*) n, coalesce(sum(watch_duration), 0) ms
        from public.post_views where creator_id = p_creator
          and created_at >= (p_from - 6)::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  l as (select (l.created_at at time zone 'utc')::date d, count(*) n from public.likes l join public.posts p on p.id = l.post_id
        where p.creator_id = p_creator and l.user_id <> p_creator
          and l.created_at >= (p_from - 6)::timestamptz and l.created_at < (p_to + 1)::timestamptz group by 1),
  c as (select (c.created_at at time zone 'utc')::date d, count(*) n from public.comments c join public.posts p on p.id = c.post_id
        where p.creator_id = p_creator and c.user_id <> p_creator
          and c.created_at >= (p_from - 6)::timestamptz and c.created_at < (p_to + 1)::timestamptz group by 1),
  s as (select (s.created_at at time zone 'utc')::date d, count(*) n from public.saves s join public.posts p on p.id = s.post_id
        where p.creator_id = p_creator and s.user_id <> p_creator
          and s.created_at >= (p_from - 6)::timestamptz and s.created_at < (p_to + 1)::timestamptz group by 1),
  f as (select (created_at at time zone 'utc')::date d, count(*) n from public.follows
        where following_id = p_creator and created_at >= (p_from - 6)::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  fbase as (select count(*) n from public.follows where following_id = p_creator and created_at < (p_from - 6)::timestamptz),
  pv as (select (created_at at time zone 'utc')::date d, count(*) n from public.profile_visits
         where creator_id = p_creator and created_at >= (p_from - 6)::timestamptz and created_at < (p_to + 1)::timestamptz group by 1),
  firsts as (
    select distinct on (m.conversation_id) m.conversation_id, m.sender_id, m.created_at
    from public.messages m
    join public.conversation_participants me on me.conversation_id = m.conversation_id and me.user_id = p_creator
    order by m.conversation_id, m.created_at),
  inq as (select (fm.created_at at time zone 'utc')::date d, count(*) n from firsts fm
          join public.profiles b on b.id = fm.sender_id and b.role = 'brand'
          where fm.created_at >= (p_from - 6)::timestamptz and fm.created_at < (p_to + 1)::timestamptz group by 1),
  e as (select (paid_at at time zone 'utc')::date d, sum(agreed_amount) n from public.campaign_creators
        where creator_id = p_creator and payment_status = 'paid'
          and paid_at >= (p_from - 6)::timestamptz and paid_at < (p_to + 1)::timestamptz group by 1),
  daily as (
    select days.day,
      coalesce(v.n, 0) views, coalesce(v.ms, 0) ms, coalesce(l.n, 0) likes, coalesce(c.n, 0) comments, coalesce(s.n, 0) saves,
      coalesce(f.n, 0) newf, coalesce(pv.n, 0) visits, coalesce(inq.n, 0) inq, coalesce(e.n, 0) earn
    from days
    left join v on v.d = days.day left join l on l.d = days.day left join c on c.d = days.day
    left join s on s.d = days.day left join f on f.d = days.day left join pv on pv.d = days.day
    left join inq on inq.d = days.day left join e on e.d = days.day
  ),
  rolled as (
    select daily.*,
      (select n from fbase) + sum(newf) over (order by day) followers_total,
      sum(views) over w7 views7, sum(likes + comments + saves) over w7 eng7
    from daily window w7 as (order by day rows between 6 preceding and current row)
  )
  select day, views::int, ms::bigint, likes::int, comments::int, saves::int, newf::int, followers_total::int,
         visits::int, inq::int, earn::bigint,
         case when views7 > 0 then round(100.0 * eng7 / views7, 2) end
  from rolled
  where day >= p_from
  order by day;
end $$;
