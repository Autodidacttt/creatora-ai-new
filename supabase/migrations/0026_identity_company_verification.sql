-- 0026: Account verification overhaul (expand step — safe with the previous app still serving).
-- * Tool / workflow verification is retired: no RPC, card, ranking or filter reads it any more and no new requests
--   can be filed. The old rows stay until the contract migration (0027, applied separately after approval).
-- * Phone OTP + one number per account, ID verification (eKYC, admin decides), a mock government-ID API,
--   brand account types (individual recruiter / company), company verification with a contact invitation, and
--   gating: a NEW brand can't publish or hire until verified. Existing brands are grandfathered.
-- Sensitive data (phone, ID number, DOB, ID images) is written and read only by server routes (service role) or
-- permission-checked admin RPCs; clients have no table access. ID numbers and phones are stored as peppered hashes.

-- ---------------------------------------------------------------------------
-- 1. Settings (flags the database enforces)
-- ---------------------------------------------------------------------------
create table public.app_settings (
  key text primary key check (key ~ '^[a-z_]{3,60}$'),
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
insert into public.app_settings (key, value) values
  ('brand_verification_gating', 'true'::jsonb),   -- new brands must verify before publishing / hiring
  ('id_retention_days', '30'::jsonb),             -- ID images are deleted this many days after the decision
  ('identity_max_attempts', '3'::jsonb);          -- ID submissions per user (a rejection uses one)

create or replace function private.setting(p_key text, p_default jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default);
$$;

-- ---------------------------------------------------------------------------
-- 2. Admin permissions
-- ---------------------------------------------------------------------------
create table public.admin_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission text not null check (permission in ('verify_creators', 'verify_brands')),
  granted_at timestamptz not null default now(),
  primary key (user_id, permission)
);
alter table public.admin_permissions enable row level security;
revoke all on public.admin_permissions from anon, authenticated;
insert into public.admin_permissions (user_id, permission)
select p.id, x.perm from public.profiles p cross join (values ('verify_creators'), ('verify_brands')) x(perm)
where p.role = 'admin' on conflict do nothing;

create or replace function public.has_admin_permission(p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() and exists (select 1 from public.admin_permissions
                                       where user_id = auth.uid() and permission = p_permission);
$$;

-- ---------------------------------------------------------------------------
-- 3. Account state: badges + brand type
-- ---------------------------------------------------------------------------
alter table public.profiles add column phone_verified_at timestamptz, add column identity_verified_at timestamptz;
-- (profiles: clients may update only the columns granted in 0011, so these stay server-only)

alter table public.brand_details
  add column brand_type text check (brand_type in ('individual', 'company')),
  add column verification_required boolean not null default true,
  add column company_verified_at timestamptz;
-- Existing brands keep every ability they had (grandfathered); new brands default to verification_required.
-- (the backfill doesn't bump updated_at: existing values stay exactly as they were)
alter table public.brand_details disable trigger brand_details_touch;
update public.brand_details set verification_required = false;
-- Seeded demo brands are verified companies so the demo flows keep working
update public.brand_details bd set brand_type = 'company', company_verified_at = now()
from auth.users u where u.id = bd.profile_id and u.email like '%@demo.creatora.ai';
alter table public.brand_details enable trigger brand_details_touch;
-- brand_details was fully client-updatable; the verification columns are now server-only
revoke update on public.brand_details from authenticated;
grant update (company_name, industry, company_size, description, updated_at) on public.brand_details to authenticated;

-- What a card / profile / chat header shows (no sensitive data)
create or replace function public.trust_badges(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'phone_verified', p.phone_verified_at is not null,
    'identity_verified', p.identity_verified_at is not null,
    'company_verified', bd.company_verified_at is not null,
    'brand_type', bd.brand_type)
  from public.profiles p left join public.brand_details bd on bd.profile_id = p.id where p.id = p_id;
$$;

-- Gating: may this brand publish briefs and hire?
create or replace function public.brand_can_operate(p_brand uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not (private.setting('brand_verification_gating', 'true'::jsonb))::boolean
        or not bd.verification_required
        or (bd.brand_type = 'individual' and p.identity_verified_at is not null)
        or (bd.brand_type = 'company' and bd.company_verified_at is not null)
    from public.brand_details bd join public.profiles p on p.id = bd.profile_id
    where bd.profile_id = p_brand), true);
$$;

create or replace function public.tg_campaign_publish_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active')
     and not public.brand_can_operate(new.brand_id) then
    raise exception 'Verify your brand account before publishing a brief (Verification page).' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger campaigns_publish_gate before insert or update of status on public.campaigns
  for each row execute function public.tg_campaign_publish_gate();

-- Brand chooses its account type (until it is verified)
create or replace function public.set_brand_type(p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_bd public.brand_details;
begin
  if public.current_app_role() <> 'brand' then raise exception 'Only brand accounts have a type' using errcode = '42501'; end if;
  if p_type not in ('individual', 'company') then raise exception 'Choose Individual Recruiter or Company' using errcode = '23514'; end if;
  select * into v_bd from public.brand_details where profile_id = v_me for update;
  if v_bd.brand_type is not distinct from p_type then return; end if;
  if v_bd.company_verified_at is not null or (v_bd.brand_type = 'individual' and exists (
       select 1 from public.profiles where id = v_me and identity_verified_at is not null)) then
    raise exception 'Your account is already verified as this type' using errcode = '23514';
  end if;
  if exists (select 1 from public.identity_verifications where user_id = v_me and status = 'pending')
     or exists (select 1 from public.company_verifications where brand_id = v_me and status = 'pending') then
    raise exception 'A verification is under review — wait for the decision before changing type' using errcode = '23514';
  end if;
  update public.brand_details set brand_type = p_type where profile_id = v_me;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (v_me, 'set_brand_type', 'profile', v_me::text, jsonb_build_object('brand_type', p_type));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Phone OTP (one verified number per account, across creators and brands)
-- ---------------------------------------------------------------------------
create table public.phone_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone_hash text not null check (char_length(phone_hash) = 64),
  phone_cipher text not null check (char_length(phone_cipher) <= 400),
  phone_masked text not null check (char_length(phone_masked) <= 24),
  method text not null check (method in ('demo', 'twilio_verify')),
  code_hash text check (char_length(code_hash) = 64),   -- demo mode only (Twilio keeps its own code)
  attempts int not null default 0 check (attempts between 0 and 10),
  sends int not null default 1 check (sends between 1 and 10),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'locked', 'replaced')),
  ip_hash text check (char_length(ip_hash) = 64),
  expires_at timestamptz not null,
  last_sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index phone_otp_user_idx on public.phone_otp_challenges(user_id, created_at desc);
create index phone_otp_phone_idx on public.phone_otp_challenges(phone_hash, created_at desc);
create index phone_otp_ip_idx on public.phone_otp_challenges(ip_hash, created_at desc);
alter table public.phone_otp_challenges enable row level security;
revoke all on public.phone_otp_challenges from anon, authenticated;

create table public.verified_phones (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  phone_hash text not null unique check (char_length(phone_hash) = 64),   -- one number = one account
  phone_cipher text not null check (char_length(phone_cipher) <= 400),    -- AES-GCM, readable only by the server
  phone_masked text not null check (char_length(phone_masked) <= 24),
  method text not null check (method in ('demo', 'twilio_verify')),
  verified_at timestamptz not null default now()
);
alter table public.verified_phones enable row level security;
revoke all on public.verified_phones from anon, authenticated;

-- Server route (service role) after a successful code check. A number verified elsewhere → unique violation.
create or replace function public.verification_record_phone(p_user uuid, p_hash text, p_masked text, p_cipher text, p_method text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.verified_phones where phone_hash = p_hash and user_id <> p_user) then
    raise exception 'This phone number is already verified on another Creatora account' using errcode = '23505';
  end if;
  insert into public.verified_phones (user_id, phone_hash, phone_cipher, phone_masked, method)
  values (p_user, p_hash, p_cipher, p_masked, p_method)
  on conflict (user_id) do update set phone_hash = excluded.phone_hash, phone_cipher = excluded.phone_cipher,
    phone_masked = excluded.phone_masked, method = excluded.method, verified_at = now();
  update public.profiles set phone_verified_at = now() where id = p_user;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_user, 'phone_verified', 'profile', p_user::text, jsonb_build_object('method', p_method));
  perform public.notify(p_user, null, 'verification', 'profile', p_user,
    jsonb_build_object('event', 'phone_verified', 'method', p_method));
end $$;

-- ---------------------------------------------------------------------------
-- 5. ID verification (eKYC) + mock government ID records
-- ---------------------------------------------------------------------------
create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('creator', 'recruiter')),
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  full_name text not null check (char_length(full_name) between 2 and 120),
  id_type text not null check (id_type in ('national_id', 'passport', 'driving_licence', 'voter_id', 'other')),
  id_number_hash text not null check (char_length(id_number_hash) = 64),
  id_last4 text not null check (char_length(id_last4) between 1 and 4),
  dob date not null check (dob between '1900-01-01' and current_date),
  id_image_path text check (char_length(id_image_path) <= 300),
  image_deleted_at timestamptz,
  phone_hash text not null check (char_length(phone_hash) = 64),
  consent_at timestamptz not null,
  mock_check jsonb,                       -- advisory: { result, simulated, checked_at, latency_ms }
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reason text check (char_length(reason) <= 500),
  delete_after timestamptz,
  created_at timestamptz not null default now()
);
create unique index identity_one_pending_idx on public.identity_verifications(user_id) where status = 'pending';
create index identity_queue_idx on public.identity_verifications(kind, status, created_at desc);
create index identity_purge_idx on public.identity_verifications(delete_after) where id_image_path is not null and image_deleted_at is null;
alter table public.identity_verifications enable row level security;
revoke all on public.identity_verifications from anon, authenticated;

create table public.mock_identity_records (
  id serial primary key,
  full_name_norm text not null,
  id_number_hash text not null unique,
  dob date not null,
  label text not null default 'Fictional demo identity'
);
alter table public.mock_identity_records enable row level security;
revoke all on public.mock_identity_records from anon, authenticated;
-- Ten FICTIONAL identities (the sample IDs shown in the demo banner). Hash: sha256('creatora-mock-id:' || normalized id)
insert into public.mock_identity_records (full_name_norm, id_number_hash, dob)
select lower(regexp_replace(n, '[^a-zA-Z]', '', 'g')), encode(extensions.digest('creatora-mock-id:' || upper(regexp_replace(i, '[^a-zA-Z0-9]', '', 'g')), 'sha256'), 'hex'), d::date
from (values
  ('Aarav Sharma', 'DEMO-100001', '1995-04-12'), ('Meera Iyer', 'DEMO-100002', '1998-09-03'),
  ('Kabir Rao', 'DEMO-100003', '1992-01-27'), ('Sofia Marin', 'DEMO-100004', '1996-06-18'),
  ('Kenji Watanabe', 'DEMO-100005', '1990-11-05'), ('Lena Fischer', 'DEMO-100006', '1994-02-14'),
  ('Diego Santos', 'DEMO-100007', '1993-08-30'), ('Maya Okafor', 'DEMO-100008', '1997-12-09'),
  ('Arjun Mehta', 'DEMO-100009', '1991-03-22'), ('Priya Nair', 'DEMO-100010', '1999-07-01')) v(n, i, d);

-- Server route (service role). Rules: right role/type, verified phone, consent, one pending, attempt limit.
create or replace function public.verification_submit_identity(p_user uuid, p_kind text, p_full_name text, p_id_type text,
  p_id_hash text, p_last4 text, p_dob date, p_image_path text, p_consent boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_role text; v_type text; v_phone text; v_id uuid; v_used int;
begin
  select p.role, bd.brand_type into v_role, v_type from public.profiles p left join public.brand_details bd on bd.profile_id = p.id
  where p.id = p_user and not p.is_suspended;
  if v_role is null then raise exception 'Account not found' using errcode = '42501'; end if;
  if not ((p_kind = 'creator' and v_role = 'creator') or (p_kind = 'recruiter' and v_role = 'brand' and v_type = 'individual')) then
    raise exception 'ID verification is for creators and individual recruiters' using errcode = '42501';
  end if;
  if not coalesce(p_consent, false) then raise exception 'Consent is required' using errcode = '23514'; end if;
  select phone_hash into v_phone from public.verified_phones where user_id = p_user;
  if v_phone is null then raise exception 'Verify your phone number first' using errcode = '23514'; end if;
  if exists (select 1 from public.profiles where id = p_user and identity_verified_at is not null) then
    raise exception 'Your identity is already verified' using errcode = '23514';
  end if;
  select count(*) into v_used from public.identity_verifications where user_id = p_user;
  if v_used >= (private.setting('identity_max_attempts', '3'::jsonb))::int then
    raise exception 'No ID verification attempts left — contact support' using errcode = '23514';
  end if;
  insert into public.identity_verifications (user_id, kind, full_name, id_type, id_number_hash, id_last4, dob, id_image_path, phone_hash, consent_at)
  values (p_user, p_kind, trim(p_full_name), p_id_type, p_id_hash, p_last4, p_dob, p_image_path, v_phone, now())
  returning id into v_id;   -- a second pending submission hits identity_one_pending_idx
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_user, 'identity_submitted', 'identity_verification', v_id::text, jsonb_build_object('kind', p_kind, 'id_type', p_id_type));
  perform public.notify(p_user, null, 'verification', 'verification', v_id, jsonb_build_object('event', 'identity_pending'));
  return v_id;
end $$;

create or replace function public.verification_set_mock_check(p_id uuid, p_check jsonb)
returns void language sql security definer set search_path = public as $$
  update public.identity_verifications set mock_check = p_check where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- 6. Company verification
-- ---------------------------------------------------------------------------
create table public.company_verifications (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  company_name text not null check (char_length(company_name) between 2 and 160),
  website text not null check (website ~ '^https?://' and char_length(website) <= 300),
  website_domain text not null check (char_length(website_domain) <= 200),
  company_email text not null check (char_length(company_email) <= 254),
  email_domain text not null check (char_length(email_domain) <= 200),
  registration_number text check (char_length(registration_number) <= 80),
  address text not null check (char_length(address) between 5 and 400),
  industry text check (char_length(industry) <= 80),
  applicant_name text not null check (char_length(applicant_name) between 2 and 120),
  applicant_role text not null check (char_length(applicant_role) between 2 and 120),
  relationship text not null check (char_length(relationship) between 2 and 300),
  phone_hash text not null check (char_length(phone_hash) = 64),
  domain_match boolean not null,             -- deterministic: applicant email domain = website domain
  free_mail boolean not null,                -- applicant used a free-mail provider
  rejection_source text check (rejection_source in ('admin', 'company_contact')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reason text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);
create unique index company_one_pending_idx on public.company_verifications(brand_id) where status = 'pending';
create index company_queue_idx on public.company_verifications(status, created_at desc);
alter table public.company_verifications enable row level security;
revoke all on public.company_verifications from anon, authenticated;

create table public.company_contact_suggestions (
  id uuid primary key default gen_random_uuid(),
  company_verification_id uuid not null references public.company_verifications(id) on delete cascade,
  source text not null check (source in ('gemini', 'demo_directory', 'manual')),
  name text check (char_length(name) <= 120),
  role text not null check (char_length(role) between 1 and 120),
  source_url text check (source_url ~ '^https?://' and char_length(source_url) <= 1000),
  source_title text check (char_length(source_title) <= 200),
  public_business_email text check (char_length(public_business_email) <= 254),
  note text check (char_length(note) <= 500),
  selected boolean not null default false,
  created_at timestamptz not null default now()
);
create index company_suggestions_idx on public.company_contact_suggestions(company_verification_id, created_at);
alter table public.company_contact_suggestions enable row level security;
revoke all on public.company_contact_suggestions from anon, authenticated;

-- Demo source (simulated) for the judges' walkthrough, or when AI discovery finds nothing / is off
create table public.demo_company_directory (
  id serial primary key,
  domain text not null,
  name text,
  role text not null,
  public_business_email text,
  source_url text not null,
  source_title text not null,
  note text not null default 'Demo source, simulated'
);
alter table public.demo_company_directory enable row level security;
revoke all on public.demo_company_directory from anon, authenticated;
insert into public.demo_company_directory (domain, name, role, public_business_email, source_url, source_title) values
  ('ateliernova.example', 'Claire Dubois', 'Head of Brand Partnerships', 'partnerships@ateliernova.example', 'https://ateliernova.example/contact', 'Atelier Nova — Contact (demo)'),
  ('orbitone.example', null, 'Press & Partnerships team', 'press@orbitone.example', 'https://orbitone.example/press', 'Orbitone — Press (demo)'),
  ('tidewell.example', 'Sam Okoye', 'Marketing Director', 'hello@tidewell.example', 'https://tidewell.example/about', 'Tidewell — About us (demo)'),
  ('northpeak.example', null, 'Legal & Compliance', 'legal@northpeak.example', 'https://northpeak.example/legal', 'Northpeak Studios — Legal (demo)');

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_verification_id uuid not null references public.company_verifications(id) on delete cascade,
  suggestion_id uuid references public.company_contact_suggestions(id) on delete set null,
  contact_name text check (char_length(contact_name) <= 120),
  contact_role text check (char_length(contact_role) <= 120),
  contact_email text not null check (char_length(contact_email) <= 254),
  token_hash text not null unique check (char_length(token_hash) = 64),   -- the raw token is never stored
  email_mode text not null check (email_mode in ('demo', 'live')),
  status text not null default 'sent' check (status in ('sent', 'approved', 'rejected', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  responded_at timestamptz,
  comment text check (char_length(comment) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index company_invitations_idx on public.company_invitations(company_verification_id, created_at desc);
alter table public.company_invitations enable row level security;
revoke all on public.company_invitations from anon, authenticated;

create or replace function public.verification_submit_company(p_user uuid, p_company_name text, p_website text, p_website_domain text,
  p_company_email text, p_email_domain text, p_registration text, p_address text, p_industry text, p_applicant_name text,
  p_applicant_role text, p_relationship text, p_domain_match boolean, p_free_mail boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_type text; v_phone text; v_id uuid;
begin
  select bd.brand_type into v_type from public.profiles p join public.brand_details bd on bd.profile_id = p.id
  where p.id = p_user and p.role = 'brand' and not p.is_suspended;
  if v_type is distinct from 'company' then raise exception 'Company verification is for Company / Organization accounts' using errcode = '42501'; end if;
  select phone_hash into v_phone from public.verified_phones where user_id = p_user;
  if v_phone is null then raise exception 'Verify your phone number first' using errcode = '23514'; end if;
  if exists (select 1 from public.brand_details where profile_id = p_user and company_verified_at is not null) then
    raise exception 'Your company is already verified' using errcode = '23514';
  end if;
  insert into public.company_verifications (brand_id, company_name, website, website_domain, company_email, email_domain,
    registration_number, address, industry, applicant_name, applicant_role, relationship, phone_hash, domain_match, free_mail)
  values (p_user, trim(p_company_name), p_website, p_website_domain, lower(p_company_email), p_email_domain,
    nullif(trim(p_registration), ''), trim(p_address), nullif(trim(p_industry), ''), trim(p_applicant_name),
    trim(p_applicant_role), trim(p_relationship), v_phone, p_domain_match, p_free_mail)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (p_user, 'company_submitted', 'company_verification', v_id::text, jsonb_build_object('domain_match', p_domain_match, 'free_mail', p_free_mail));
  perform public.notify(p_user, null, 'verification', 'verification', v_id, jsonb_build_object('event', 'company_pending'));
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 7. What a user may see about their own verification (status only)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_verification()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', p.role,
    'brand_type', bd.brand_type,
    'phone', (select jsonb_build_object('verified', true, 'masked', v.phone_masked, 'method', v.method, 'verified_at', v.verified_at)
              from public.verified_phones v where v.user_id = p.id),
    'identity', (select jsonb_build_object('status', i.status, 'reason', i.reason, 'submitted_at', i.created_at, 'reviewed_at', i.reviewed_at,
                   'mock_result', i.mock_check->>'result')
                 from public.identity_verifications i where i.user_id = p.id order by i.created_at desc limit 1),
    'identity_verified', p.identity_verified_at is not null,
    'identity_attempts_left', greatest((private.setting('identity_max_attempts', '3'::jsonb))::int
                                       - (select count(*) from public.identity_verifications where user_id = p.id)::int, 0),
    'company', (select jsonb_build_object('status', c.status, 'company_name', c.company_name, 'submitted_at', c.created_at,
                  'reviewed_at', c.reviewed_at, 'domain_match', c.domain_match,
                  -- the applicant sees a neutral outcome; the impersonation signal is admin-only
                  'reason', case when c.rejection_source = 'company_contact' then null else c.reason end)
                from public.company_verifications c where c.brand_id = p.id order by c.created_at desc limit 1),
    'company_verified', bd.company_verified_at is not null,
    'verification_required', coalesce(bd.verification_required, false),
    'can_operate', case when p.role = 'brand' then public.brand_can_operate(p.id) else true end)
  from public.profiles p left join public.brand_details bd on bd.profile_id = p.id
  where p.id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- 8. Admin queue (permission-checked; sensitive fields stay server-side)
-- ---------------------------------------------------------------------------
create or replace function private.notify_verifiers(p_permission text, p_entity uuid, p_data jsonb)
returns void language sql security definer set search_path = public as $$
  select public.notify(a.user_id, null, 'verification', 'verification', p_entity, p_data)
  from public.admin_permissions a join public.profiles p on p.id = a.user_id
  where a.permission = p_permission and p.role = 'admin' and not p.is_suspended;
$$;

create or replace function private.identity_permission(p_kind text)
returns text language sql immutable as $$ select case p_kind when 'creator' then 'verify_creators' else 'verify_brands' end $$;

create or replace function public.admin_list_identity_verifications(p_kind text, p_status text default 'pending',
  p_query text default null, p_limit int default 20, p_offset int default 0)
returns table (item jsonb, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_admin_permission(private.identity_permission(p_kind)) then
    raise exception 'You don''t have permission to review these verifications' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object('id', i.id, 'kind', i.kind, 'status', i.status, 'full_name', i.full_name, 'id_type', i.id_type,
           'id_last4', i.id_last4, 'created_at', i.created_at, 'reviewed_at', i.reviewed_at,
           'mock_result', i.mock_check->>'result', 'user', public.mini_profile_json(i.user_id)),
         count(*) over ()
  from public.identity_verifications i join public.profiles p on p.id = i.user_id
  where i.kind = p_kind and (p_status is null or i.status = p_status)
    and (p_query is null or i.full_name ilike '%' || p_query || '%' or p.username ilike '%' || p_query || '%')
  order by i.created_at desc
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_get_identity_verification(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.identity_verifications;
begin
  select * into v from public.identity_verifications where id = p_id;
  if v.id is null or not public.has_admin_permission(private.identity_permission(v.kind)) then
    raise exception 'Not found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'id', v.id, 'kind', v.kind, 'status', v.status, 'full_name', v.full_name, 'id_type', v.id_type, 'id_last4', v.id_last4,
    'dob', v.dob, 'has_image', v.id_image_path is not null and v.image_deleted_at is null, 'image_deleted_at', v.image_deleted_at,
    'consent_at', v.consent_at, 'mock_check', v.mock_check, 'reason', v.reason, 'reviewed_at', v.reviewed_at,
    'reviewed_by', public.mini_profile_json(v.reviewed_by), 'delete_after', v.delete_after, 'created_at', v.created_at,
    'user', public.mini_profile_json(v.user_id) || public.trust_badges(v.user_id),
    'phone', (select jsonb_build_object('masked', ph.phone_masked, 'method', ph.method, 'verified_at', ph.verified_at,
                'same_number', ph.phone_hash = v.phone_hash) from public.verified_phones ph where ph.user_id = v.user_id),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'created_at', h.created_at,
                  'reviewed_at', h.reviewed_at, 'reason', h.reason) order by h.created_at desc)
                from public.identity_verifications h where h.user_id = v.user_id and h.id <> v.id), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'actor', public.mini_profile_json(l.actor_id))
                  order by l.created_at desc)
                from public.audit_logs l where l.target_type = 'identity_verification' and l.target_id = v.id::text), '[]'::jsonb));
end $$;

create or replace function public.admin_decide_identity(p_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v public.identity_verifications; v_reason text := nullif(trim(p_reason), '');
begin
  select * into v from public.identity_verifications where id = p_id for update;
  if v.id is null or not public.has_admin_permission(private.identity_permission(v.kind)) then
    raise exception 'Not found' using errcode = '42501';
  end if;
  if v.status <> 'pending' then raise exception 'This verification was already decided' using errcode = '23514'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'Invalid decision' using errcode = '23514'; end if;
  if p_decision = 'rejected' and char_length(coalesce(v_reason, '')) < 5 then
    raise exception 'Give a reason for the rejection' using errcode = '23514';
  end if;
  update public.identity_verifications set status = p_decision, reason = v_reason, reviewed_by = v_me, reviewed_at = now(),
    delete_after = now() + make_interval(days => (private.setting('id_retention_days', '30'::jsonb))::int)
  where id = p_id;
  if p_decision = 'verified' then
    update public.profiles set identity_verified_at = now() where id = v.user_id;
  end if;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (v_me, 'identity_' || p_decision, 'identity_verification', p_id::text, jsonb_build_object('kind', v.kind));
  perform public.notify(v.user_id, v_me, 'verification', 'verification', p_id,
    jsonb_build_object('event', 'identity_' || p_decision, 'reason', v_reason));
end $$;

create or replace function public.admin_list_company_verifications(p_status text default 'pending', p_query text default null,
  p_limit int default 20, p_offset int default 0)
returns table (item jsonb, total_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_admin_permission('verify_brands') then
    raise exception 'You don''t have permission to review these verifications' using errcode = '42501';
  end if;
  return query
  select jsonb_build_object('id', c.id, 'status', c.status, 'company_name', c.company_name, 'website_domain', c.website_domain,
           'applicant_name', c.applicant_name, 'applicant_role', c.applicant_role, 'domain_match', c.domain_match,
           'free_mail', c.free_mail, 'rejection_source', c.rejection_source, 'created_at', c.created_at,
           'invitation', (select jsonb_build_object('status', case when ci.status = 'sent' and ci.expires_at < now() then 'expired' else ci.status end,
                            'expires_at', ci.expires_at)
                          from public.company_invitations ci where ci.company_verification_id = c.id order by ci.created_at desc limit 1),
           'user', public.mini_profile_json(c.brand_id)),
         count(*) over ()
  from public.company_verifications c
  where (p_status is null or c.status = p_status)
    and (p_query is null or c.company_name ilike '%' || p_query || '%' or c.website_domain ilike '%' || p_query || '%')
  order by c.created_at desc
  limit greatest(least(p_limit, 50), 1) offset greatest(p_offset, 0);
end $$;

create or replace function public.admin_get_company_verification(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.company_verifications;
begin
  if not public.has_admin_permission('verify_brands') then raise exception 'Not found' using errcode = '42501'; end if;
  select * into c from public.company_verifications where id = p_id;
  if c.id is null then raise exception 'Not found' using errcode = '42501'; end if;
  return to_jsonb(c) - 'phone_hash' || jsonb_build_object(
    'user', public.mini_profile_json(c.brand_id) || public.trust_badges(c.brand_id),
    'reviewed_by', public.mini_profile_json(c.reviewed_by),
    'phone', (select jsonb_build_object('masked', ph.phone_masked, 'method', ph.method, 'verified_at', ph.verified_at,
                'same_number', ph.phone_hash = c.phone_hash) from public.verified_phones ph where ph.user_id = c.brand_id),
    'suggestions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at) from public.company_contact_suggestions s
                    where s.company_verification_id = c.id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg((to_jsonb(ci) - 'token_hash') || jsonb_build_object('status',
                      case when ci.status = 'sent' and ci.expires_at < now() then 'expired' else ci.status end) order by ci.created_at desc)
                    from public.company_invitations ci where ci.company_verification_id = c.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'created_at', h.created_at, 'reason', h.reason)
                  order by h.created_at desc) from public.company_verifications h where h.brand_id = c.brand_id and h.id <> c.id), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'actor', public.mini_profile_json(l.actor_id), 'meta', l.meta)
                  order by l.created_at desc)
                from public.audit_logs l where l.target_type = 'company_verification' and l.target_id = c.id::text), '[]'::jsonb));
end $$;

create or replace function private.decide_company(p_id uuid, p_decision text, p_reason text, p_actor uuid, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.company_verifications;
begin
  select * into c from public.company_verifications where id = p_id for update;
  if c.status <> 'pending' then raise exception 'This verification was already decided' using errcode = '23514'; end if;
  update public.company_verifications set status = p_decision, reason = p_reason, reviewed_by = p_actor, reviewed_at = now(),
    rejection_source = case when p_decision = 'rejected' then p_source end
  where id = p_id;
  if p_decision = 'verified' then
    update public.brand_details set company_verified_at = now() where profile_id = c.brand_id;
  end if;
  update public.company_invitations set status = 'cancelled' where company_verification_id = p_id and status = 'sent';
  perform public.notify(c.brand_id, null, 'verification', 'verification', p_id,
    jsonb_build_object('event', 'company_' || p_decision, 'company_name', c.company_name));
end $$;

create or replace function public.admin_decide_company(p_id uuid, p_decision text, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_reason text := nullif(trim(p_reason), '');
begin
  if not public.has_admin_permission('verify_brands') then raise exception 'Not found' using errcode = '42501'; end if;
  if p_decision not in ('verified', 'rejected') then raise exception 'Invalid decision' using errcode = '23514'; end if;
  if p_decision = 'rejected' and char_length(coalesce(v_reason, '')) < 5 then
    raise exception 'Give a reason for the rejection' using errcode = '23514';
  end if;
  perform private.decide_company(p_id, p_decision, v_reason, v_me, 'admin');
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (v_me, 'company_' || p_decision, 'company_verification', p_id::text, jsonb_build_object('by', 'admin'));
end $$;

-- Contacts: suggestions (AI / demo directory, added by the server job) and manual entries by the admin
create or replace function public.admin_add_contact(p_company uuid, p_name text, p_role text, p_email text, p_source_url text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_id uuid;
begin
  if not public.has_admin_permission('verify_brands') then raise exception 'Not found' using errcode = '42501'; end if;
  insert into public.company_contact_suggestions (company_verification_id, source, name, role, source_url, source_title, public_business_email, note)
  values (p_company, 'manual', nullif(trim(p_name), ''), trim(p_role), nullif(trim(p_source_url), ''), 'Entered by an admin',
          nullif(lower(trim(p_email)), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (v_me, 'company_contact_added', 'company_verification', p_company::text, jsonb_build_object('source', 'manual'));
  return v_id;
end $$;

-- The admin confirmed "You are about to email X": record the invitation (the server keeps the raw token)
create or replace function public.admin_create_invitation(p_company uuid, p_suggestion uuid, p_name text, p_role text, p_email text,
  p_token_hash text, p_mode text, p_days int default 7)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_me uuid := private.assert_active(); v_id uuid; c public.company_verifications;
begin
  if not public.has_admin_permission('verify_brands') then raise exception 'Not found' using errcode = '42501'; end if;
  select * into c from public.company_verifications where id = p_company for update;
  if c.status <> 'pending' then raise exception 'This verification is no longer pending' using errcode = '23514'; end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  update public.company_invitations set status = 'cancelled' where company_verification_id = p_company and status = 'sent';
  update public.company_contact_suggestions set selected = (id = p_suggestion) where company_verification_id = p_company;
  insert into public.company_invitations (company_verification_id, suggestion_id, contact_name, contact_role, contact_email,
    token_hash, email_mode, expires_at, created_by)
  values (p_company, p_suggestion, nullif(trim(p_name), ''), nullif(trim(p_role), ''), lower(trim(p_email)), p_token_hash, p_mode,
          now() + make_interval(days => greatest(least(p_days, 30), 1)), v_me)
  returning id into v_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (v_me, 'company_invitation_sent', 'company_verification', p_company::text, jsonb_build_object('mode', p_mode, 'invitation', v_id));
  return v_id;
end $$;

-- Public page (server route with the service role): what the invited contact sees
create or replace function public.company_invitation_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', case when ci.status = 'sent' and ci.expires_at < now() then 'expired' else ci.status end,
    'company_name', c.company_name, 'website_domain', c.website_domain, 'applicant_name', c.applicant_name,
    'applicant_role', c.applicant_role, 'expires_at', ci.expires_at)
  from public.company_invitations ci join public.company_verifications c on c.id = ci.company_verification_id
  where ci.token_hash = p_token_hash;
$$;

create or replace function public.company_invitation_respond(p_token_hash text, p_decision text, p_comment text)
returns text language plpgsql security definer set search_path = public as $$
declare ci public.company_invitations; c public.company_verifications; v_comment text := nullif(left(trim(p_comment), 1000), '');
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'Invalid response' using errcode = '23514'; end if;
  select * into ci from public.company_invitations where token_hash = p_token_hash for update;
  if ci.id is null then raise exception 'This link is not valid' using errcode = '42501'; end if;
  if ci.status = 'sent' and ci.expires_at < now() then
    update public.company_invitations set status = 'expired' where id = ci.id;
    insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
    values (null, 'company_invitation_expired', 'company_verification', ci.company_verification_id::text, jsonb_build_object('invitation', ci.id));
    return 'expired';
  end if;
  if ci.status <> 'sent' then return ci.status; end if;   -- single use
  select * into c from public.company_verifications where id = ci.company_verification_id for update;
  update public.company_invitations set status = p_decision, responded_at = now(), comment = v_comment where id = ci.id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (null, 'company_contact_' || p_decision, 'company_verification', c.id::text,
          jsonb_build_object('invitation', ci.id, 'contact_email', ci.contact_email, 'comment', v_comment));
  if c.status <> 'pending' then return p_decision; end if;
  if p_decision = 'approved' then
    perform private.decide_company(c.id, 'verified', null, ci.created_by, 'company_contact');
  else
    perform private.decide_company(c.id, 'rejected', 'The company contact did not confirm this applicant.', ci.created_by, 'company_contact');
    -- High-priority report for the admins; never an automatic suspension
    insert into public.reports (reporter_id, target_type, target_id, reason, details, priority)
    values (coalesce(ci.created_by, (select user_id from public.admin_permissions where permission = 'verify_brands' limit 1)),
            'profile', c.brand_id, 'impersonation',
            left(format('Potential impersonation: %s (%s) was not confirmed by %s for %s.%s', c.applicant_name, c.applicant_role,
                        ci.contact_email, c.company_name, coalesce(' Comment: ' || v_comment, '')), 1000), 'high');
    perform private.notify_verifiers('verify_brands', c.id, jsonb_build_object('event', 'company_impersonation', 'company_name', c.company_name));
  end if;
  return p_decision;
end $$;

-- Retention: ID images due for deletion (server job; ID_RETENTION_DAYS days after the decision), then marked deleted
create or replace function public.identity_images_due(p_days int, p_limit int default 50)
returns table (id uuid, id_image_path text)
language sql stable security definer set search_path = public as $$
  select i.id, i.id_image_path from public.identity_verifications i
  where i.id_image_path is not null and i.image_deleted_at is null and i.status <> 'pending'
    and i.reviewed_at + make_interval(days => greatest(p_days, 0)) < now()
  order by i.reviewed_at limit greatest(least(p_limit, 200), 1);
$$;
create or replace function public.identity_image_purged(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.identity_verifications set image_deleted_at = now(), id_image_path = null where id = p_id;
  insert into public.audit_logs (actor_id, action, target_type, target_id, meta)
  values (null, 'identity_image_deleted', 'identity_verification', p_id::text, '{"reason": "retention"}'::jsonb);
$$;

-- ---------------------------------------------------------------------------
-- 9. Reports: priority + impersonation; job log type for contact discovery
-- ---------------------------------------------------------------------------
alter table public.reports add column priority text not null default 'normal' check (priority in ('normal', 'high'));
alter table public.reports drop constraint reports_reason_check;
alter table public.reports add constraint reports_reason_check check (reason in
  ('spam', 'harassment', 'ip_infringement', 'misleading', 'inappropriate', 'other', 'impersonation'));
alter table public.ai_job_logs drop constraint ai_job_logs_job_check;
alter table public.ai_job_logs add constraint ai_job_logs_job_check check (job in
  ('submission_review', 'watermark', 'certificate', 'ai_match', 'ai_match_reason', 'creator_embeddings', 'contact_discovery'));

-- ---------------------------------------------------------------------------
-- 10. Retire tool / workflow verification (rows kept until 0027)
-- ---------------------------------------------------------------------------
alter table public.verifications drop constraint verifications_type_check;
alter table public.verifications add constraint verifications_type_check check (type in ('past_work', 'identity')) not valid;

-- ---------------------------------------------------------------------------
-- 11. Private bucket for ID images (no client policies: only the server role reads or writes it)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('identity-documents', 'identity-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 12. Read models: trust badges everywhere a person is shown; tool / workflow verification no longer read
-- ---------------------------------------------------------------------------
-- creator_card: badges; tool verification retired; verified_count = verified past work
CREATE OR REPLACE FUNCTION public.creator_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', p.id,
    'username', p.username,
    'display_name', p.display_name,
    'avatar_url', p.avatar_url,
    'headline', p.headline,
    'location', p.location,
    'is_verified', p.is_verified,
    'experience_level', cd.experience_level,
    'availability', cd.availability,
    'followers_count', coalesce(s.followers_count, 0),
    'posts_count', coalesce(s.posts_count, 0),
    'likes_count', coalesce(s.likes_received_count, 0),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
               'verified', false)
             order by t.sort, t.name)
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = p.id), '[]'::jsonb),
    'skills', coalesce((
      select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name) order by k.sort, k.name)
      from public.creator_skills cs join public.skills k on k.id = cs.skill_id
      where cs.creator_id = p.id), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.sort, c.name)
      from public.creator_categories cc join public.categories c on c.id = cc.category_id
      where cc.creator_id = p.id), '[]'::jsonb),
    'verified_count', (select count(*) from public.verifications v
                       where v.creator_id = p.id and v.status = 'approved' and v.type = 'past_work'),
    'badges', public.trust_badges(p.id),
    'preview', coalesce((
      select jsonb_agg(q.item order by q.ord)
      from (
        select row_number() over (order by po.likes_count desc, po.created_at desc) as ord,
               jsonb_build_object('id', po.id, 'media_type', po.media_type,
                 'url', coalesce(po.thumbnail_url, po.media_url), 'title', po.title,
                 'aspect_ratio', po.aspect_ratio) as item
        from public.posts po
        where po.creator_id = p.id and not po.is_removed
        order by po.likes_count desc, po.created_at desc
        limit 4
      ) q), '[]'::jsonb),
    'is_following', exists (select 1 from public.follows f
                            where f.follower_id = auth.uid() and f.following_id = p.id)
  )
  from public.profiles p
  left join public.creator_details cd on cd.profile_id = p.id
  left join public.profile_stats s on s.profile_id = p.id
  where p.id = p_id;
$function$;

-- post_card: badges; workflow verification retired
CREATE OR REPLACE FUNCTION public.post_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'media_type', p.media_type,
    'media_url', p.media_url,
    'thumbnail_url', p.thumbnail_url,
    'source_link', p.source_link,
    'embed_provider', p.embed_provider,
    'aspect_ratio', p.aspect_ratio,
    'commercial_use_cleared', p.commercial_use_cleared,
    'workflow_notes', p.workflow_notes,
    'workflow_steps', coalesce((
      select jsonb_agg(jsonb_build_object('tool_id', t.id, 'tool', t.name, 'step', w.e->>'step')
             order by w.ord)
      from jsonb_array_elements(p.workflow_steps) with ordinality as w(e, ord)
      left join public.ai_tools t on t.id = nullif(w.e->>'tool_id', '')::int), '[]'::jsonb),
    'likes_count', p.likes_count,
    'comments_count', p.comments_count,
    'saves_count', p.saves_count,
    'is_removed', p.is_removed,
    'created_at', p.created_at,
    'content_type', (select jsonb_build_object('id', x.id, 'name', x.name)
                     from public.content_types x where x.id = p.content_type_id),
    'style', (select jsonb_build_object('id', x.id, 'name', x.name)
              from public.styles x where x.id = p.style_id),
    'category', (select jsonb_build_object('id', x.id, 'name', x.name)
                 from public.categories x where x.id = p.category_id),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.sort, t.name)
      from public.post_tools pt join public.ai_tools t on t.id = pt.tool_id
      where pt.post_id = p.id), '[]'::jsonb),
    'creator', jsonb_build_object('id', u.id, 'username', u.username, 'display_name', u.display_name,
                 'avatar_url', u.avatar_url, 'is_verified', u.is_verified, 'headline', u.headline, 'badges', public.trust_badges(u.id)),
    'liked', exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid()),
    'saved', exists (select 1 from public.saves s where s.post_id = p.id and s.user_id = auth.uid()),
    'workflow_verified', false
  )
  from public.posts p
  join public.profiles u on u.id = p.creator_id
  where p.id = p_id;
$function$;

-- get_profile: badges; only past-work verifications listed
CREATE OR REPLACE FUNCTION public.get_profile(p_username text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'username', p.username, 'display_name', p.display_name,
    'avatar_url', p.avatar_url, 'cover_url', p.cover_url, 'headline', p.headline, 'bio', p.bio,
    'location', p.location, 'website', p.website, 'links', p.links,
    'is_verified', p.is_verified, 'is_suspended', p.is_suspended, 'onboarded', p.onboarded,
    'created_at', p.created_at,
    'stats', jsonb_build_object(
      'followers', coalesce(s.followers_count, 0), 'following', coalesce(s.following_count, 0),
      'posts', coalesce(s.posts_count, 0), 'likes', coalesce(s.likes_received_count, 0)),
    'creator', (select jsonb_build_object('experience_level', cd.experience_level,
                  'availability', cd.availability, 'years_experience', cd.years_experience,
                  'rate_min', cd.rate_min, 'rate_max', cd.rate_max, 'currency', cd.currency,
                  'workflow_overview', cd.workflow_overview)
                from public.creator_details cd where cd.profile_id = p.id),
    'brand', (select jsonb_build_object('company_name', bd.company_name, 'industry', bd.industry,
                'company_size', bd.company_size, 'description', bd.description)
              from public.brand_details bd where bd.profile_id = p.id),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'category', t.category,
               'proficiency', ct.proficiency,
               'verified', false)
             order by t.sort, t.name)
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = p.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.creator_skills j join public.skills x on x.id = j.skill_id
               where j.creator_id = p.id), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                   from public.creator_categories j join public.categories x on x.id = j.category_id
                   where j.creator_id = p.id), '[]'::jsonb),
    'content_types', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                      from public.creator_content_types j join public.content_types x on x.id = j.content_type_id
                      where j.creator_id = p.id), '[]'::jsonb),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.creator_styles j join public.styles x on x.id = j.style_id
               where j.creator_id = p.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                  from public.creator_languages j join public.languages x on x.id = j.language_id
                  where j.creator_id = p.id), '[]'::jsonb),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
                  from public.creator_platforms j join public.platforms x on x.id = j.platform_id
                  where j.creator_id = p.id), '[]'::jsonb),
    'experiences', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'brand_name', e.brand_name,
               'project_title', e.project_title, 'year', e.year, 'description', e.description,
               'link', e.link,
               'verified', exists (select 1 from public.verifications v
                                   where v.experience_id = e.id and v.status = 'approved'))
             order by e.year desc nulls last, e.created_at desc)
      from public.creator_experiences e where e.creator_id = p.id), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', v.id, 'type', v.type, 'title', v.title,
               'status', v.status, 'evidence_url', v.evidence_url, 'evidence_notes', v.evidence_notes,
               'tool_id', v.tool_id, 'post_id', v.post_id, 'experience_id', v.experience_id,
               'reviewed_at', v.reviewed_at, 'created_at', v.created_at)
             order by v.created_at desc)
      from public.verifications v where v.creator_id = p.id and v.type = 'past_work'), '[]'::jsonb),
    'badges', public.trust_badges(p.id),
    'is_me', p.id = auth.uid(),
    'is_following', exists (select 1 from public.follows f where f.follower_id = auth.uid() and f.following_id = p.id),
    'follows_you', exists (select 1 from public.follows f where f.follower_id = p.id and f.following_id = auth.uid())
  )
  from public.profiles p
  left join public.profile_stats s on s.profile_id = p.id
  where p.username = p_username::extensions.citext;
$function$;

-- mini_profile_json: badges (chat, projects, collaborators, admin lists)
CREATE OR REPLACE FUNCTION public.mini_profile_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
           'avatar_url', p.avatar_url, 'is_verified', p.is_verified, 'role', p.role,
           'company_name', bd.company_name, 'badges', public.trust_badges(p.id))
  from public.profiles p left join public.brand_details bd on bd.profile_id = p.id where p.id = p_id;
$function$;

-- campaign_card: brand badges (briefs, opportunities)
CREATE OR REPLACE FUNCTION public.campaign_card(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select to_jsonb(c) - 'search' - (case when c.brand_id = auth.uid() then '{}'::text[]
                                   else array['source_idea', 'source_url', 'source_summary', 'studio_step'] end) || jsonb_build_object(
    'brand', jsonb_build_object('id', b.id, 'username', b.username, 'display_name', b.display_name,
               'avatar_url', b.avatar_url, 'is_verified', b.is_verified, 'badges', public.trust_badges(b.id),
               'company_name', bd.company_name, 'industry', bd.industry),
    'content_type', (select jsonb_build_object('id', x.id, 'name', x.name)
                     from public.content_types x where x.id = c.content_type_id),
    'style', (select jsonb_build_object('id', x.id, 'name', x.name) from public.styles x where x.id = c.style_id),
    'category', (select jsonb_build_object('id', x.id, 'name', x.name) from public.categories x where x.id = c.category_id),
    'platforms', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort)
                  from public.campaign_platforms j join public.platforms x on x.id = j.platform_id
                  where j.campaign_id = c.id), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
              from public.campaign_tools j join public.ai_tools x on x.id = j.tool_id
              where j.campaign_id = c.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort, x.name)
               from public.campaign_skills j join public.skills x on x.id = j.skill_id
               where j.campaign_id = c.id), '[]'::jsonb),
    'languages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.sort)
                  from public.campaign_languages j join public.languages x on x.id = j.language_id
                  where j.campaign_id = c.id), '[]'::jsonb),
    'stats', (select jsonb_build_object('applications', st.applications_count,
                'shortlisted', st.shortlisted_count, 'selected', st.selected_count)
              from public.campaign_stats st where st.campaign_id = c.id),
    'my_application', (select jsonb_build_object('id', a.id, 'status', a.status, 'created_at', a.created_at)
                       from public.campaign_applications a
                       where a.campaign_id = c.id and a.creator_id = auth.uid()),
    'my_shortlisted', exists (select 1 from public.campaign_shortlists s
                              where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'my_selected', exists (select 1 from public.campaign_creators s
                           where s.campaign_id = c.id and s.creator_id = auth.uid() and s.hired_at is not null),
    'my_project', (select jsonb_build_object('id', s.id, 'status', s.status) from public.campaign_creators s
                   where s.campaign_id = c.id and s.creator_id = auth.uid()),
    'sprint_closed', c.is_sprint and c.sprint_deadline <= now(),
    'saved', exists (select 1 from public.saved_opportunities so
                     where so.campaign_id = c.id and so.creator_id = auth.uid())
  )
  from public.campaigns c
  join public.profiles b on b.id = c.brand_id
  left join public.brand_details bd on bd.profile_id = b.id
  where c.id = p_id;
$function$;

-- get_inbox: badges on the other person
CREATE OR REPLACE FUNCTION public.get_inbox(p_other_role text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0)
 RETURNS TABLE(conversation_id uuid, last_message_at timestamp with time zone, last_message_preview text, last_sender_id uuid, unread_count integer, other jsonb, total_count bigint, conversation_type text, campaign jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select c.*, me.last_read_at, me.user_id as me_id from public.conversation_participants me
    join public.conversations c on c.id = me.conversation_id
    where me.user_id = auth.uid()
  ), rows as (
    select m.id, coalesce(m.last_message_at, m.created_at) as at, m.last_message_preview, m.last_sender_id, m.type,
      (select count(*) from public.messages x where x.conversation_id = m.id and x.created_at > m.last_read_at and x.sender_id <> m.me_id)::int as unread,
      case when m.type = 'group' then
        jsonb_build_object('id', cp.id, 'username', null, 'display_name', cp.title || ' · group',
          'avatar_url', b.avatar_url, 'role', 'group', 'is_verified', false,
          'headline', (select count(*) from public.conversation_participants g where g.conversation_id = m.id) || ' members')
      else
        (select jsonb_build_object('id', o.id, 'username', o.username, 'display_name', o.display_name,
                  'avatar_url', o.avatar_url, 'role', o.role, 'is_verified', o.is_verified, 'headline', o.headline, 'badges', public.trust_badges(o.id))
         from public.conversation_participants op join public.profiles o on o.id = op.user_id
         where op.conversation_id = m.id and op.user_id <> m.me_id limit 1)
      end as other,
      case when cp.id is not null then jsonb_build_object('id', cp.id, 'title', cp.title, 'status', cp.status) end as campaign
    from mine m
    left join public.campaigns cp on cp.id = m.campaign_id
    left join public.profiles b on b.id = cp.brand_id
  )
  select r.id, r.at, r.last_message_preview, r.last_sender_id, r.unread, r.other, count(*) over (), r.type, r.campaign
  from rows r
  where r.other is not null
    and (p_other_role is null or r.other->>'role' = p_other_role
         or (p_other_role = 'brand' and r.other->>'role' in ('admin', 'group')))
    and (nullif(trim(p_query), '') is null
         or r.other->>'display_name' ilike '%' || trim(p_query) || '%'
         or coalesce(r.other->>'username', '') ilike '%' || trim(p_query) || '%'
         or r.campaign->>'title' ilike '%' || trim(p_query) || '%'
         or r.last_message_preview ilike '%' || trim(p_query) || '%')
  order by r.at desc, r.id
  limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0);
$function$;

-- get_conversation: badges in the chat header
CREATE OR REPLACE FUNCTION public.get_conversation(p_conversation uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', c.id, 'type', c.type,
    'campaign', (select jsonb_build_object('id', x.id, 'title', x.title, 'status', x.status, 'brand_id', x.brand_id)
                 from public.campaigns x where x.id = c.campaign_id),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'username', p.username, 'display_name', p.display_name,
                           'avatar_url', p.avatar_url, 'role', p.role, 'is_verified', p.is_verified, 'badges', public.trust_badges(p.id)) order by p.role, p.display_name)
                         from public.conversation_participants cp join public.profiles p on p.id = cp.user_id
                         where cp.conversation_id = c.id), '[]'::jsonb))
  from public.conversations c
  where c.id = p_conversation and public.is_participant(c.id);
$function$;

-- rank_creators_for_campaign: no 'Verified on <tool>' input or reason
CREATE OR REPLACE FUNCTION public.rank_creators_for_campaign(p_campaign_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0, p_exclude_swiped boolean DEFAULT false, p_only uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(creator jsonb, score integer, breakdown jsonb, reasons text[], total_count bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  c public.campaigns%rowtype;
  v_tools int[];
  v_skills int[];
  v_platforms int[];
  v_langs int[];
  v_dims int;
begin
  select * into c from public.campaigns where id = p_campaign_id;   -- RLS applies
  if not found then
    raise exception 'Campaign not found' using errcode = 'P0002';
  end if;

  select coalesce(array_agg(tool_id), '{}') into v_tools from public.campaign_tools where campaign_id = c.id;
  select coalesce(array_agg(skill_id), '{}') into v_skills from public.campaign_skills where campaign_id = c.id;
  select coalesce(array_agg(platform_id), '{}') into v_platforms from public.campaign_platforms where campaign_id = c.id;
  select coalesce(array_agg(language_id), '{}') into v_langs from public.campaign_languages where campaign_id = c.id;
  v_dims := (c.content_type_id is not null)::int + (c.style_id is not null)::int
          + (c.category_id is not null)::int + (cardinality(c.aspect_ratios) > 0)::int
          + (cardinality(v_tools) > 0)::int;

  return query
  with base as (
    select p.id, p.is_verified, cd.availability, coalesce(s.followers_count, 0) as followers
    from public.profiles p
    join public.creator_details cd on cd.profile_id = p.id
    left join public.profile_stats s on s.profile_id = p.id
    where p.role = 'creator' and not p.is_suspended
      and (p_only is not null or p.id is distinct from auth.uid())   -- explicit lists may include the caller ("your relevance")
      and (p_only is null or p.id = any(p_only))
      and (not p_exclude_swiped or not exists (
            select 1 from public.interactions i
            where i.user_id = auth.uid() and i.target_type = 'profile' and i.target_id = p.id
              and i.action in ('swipe_left', 'swipe_right')))
  ),
  f as (
    select b.*,
      coalesce(mt.names, '{}') as tool_names,
      coalesce(ms.names, '{}') as skill_names,
      coalesce(mp.names, '{}') as platform_names,
      coalesce(ml.names, '{}') as language_names,
      exists (select 1 from public.creator_categories x where x.creator_id = b.id and x.category_id = c.category_id) as cat_match,
      (exists (select 1 from public.creator_content_types x where x.creator_id = b.id and x.content_type_id = c.content_type_id)
        or exists (select 1 from public.posts x where x.creator_id = b.id and not x.is_removed
                   and x.content_type_id = c.content_type_id)) as ct_match,
      coalesce((select avg(r) from unnest(pr.rels[1:3]) r), 0) as relevance,
      coalesce((select count(*) from unnest(pr.rels) r where r >= 0.5), 0) as match_posts,
      (select count(*) from public.creator_experiences e where e.creator_id = b.id)
        + (select count(*) from public.campaign_creators x where x.creator_id = b.id and x.hired_at is not null) as exp_count,
      exists (select 1 from public.verifications v
              where v.creator_id = b.id and v.type = 'past_work' and v.status = 'approved') as verified_past
    from base b
    left join lateral (
      select array_agg(t.name order by t.sort, t.name) as names
      from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
      where ct.creator_id = b.id and ct.tool_id = any(v_tools)) mt on true
    left join lateral (
      select array_agg(k.name order by k.sort, k.name) as names
      from public.creator_skills cs join public.skills k on k.id = cs.skill_id
      where cs.creator_id = b.id and cs.skill_id = any(v_skills)) ms on true
    left join lateral (
      select array_agg(x.name order by x.sort) as names
      from public.creator_platforms cp join public.platforms x on x.id = cp.platform_id
      where cp.creator_id = b.id and cp.platform_id = any(v_platforms)) mp on true
    left join lateral (
      select array_agg(x.name order by x.sort) as names
      from public.creator_languages cl join public.languages x on x.id = cl.language_id
      where cl.creator_id = b.id and cl.language_id = any(v_langs)) ml on true
    left join lateral (
      select array_agg(q.rel order by q.rel desc) as rels
      from (
        select (
            (case when c.content_type_id is not null and po.content_type_id = c.content_type_id then 1 else 0 end)
          + (case when c.style_id is not null and po.style_id = c.style_id then 1 else 0 end)
          + (case when c.category_id is not null and po.category_id = c.category_id then 1 else 0 end)
          + (case when cardinality(c.aspect_ratios) > 0 and po.aspect_ratio = any(c.aspect_ratios) then 1 else 0 end)
          + (case when cardinality(v_tools) > 0 and exists (
                select 1 from public.post_tools pt where pt.post_id = po.id and pt.tool_id = any(v_tools)) then 1 else 0 end)
          )::numeric / greatest(v_dims, 1) as rel
        from public.posts po
        where po.creator_id = b.id and not po.is_removed
      ) q) pr on true
  ),
  s as (
    select f.*,
      case when cardinality(v_tools) = 0 then 12.5
           else 25.0 * cardinality(f.tool_names) / cardinality(v_tools) end as s_tools,
      case when cardinality(v_skills) = 0 then 10.0
           else 20.0 * cardinality(f.skill_names) / cardinality(v_skills) end as s_skills,
      case when v_dims = 0 then 12.5 else 25.0 * f.relevance end as s_portfolio,
      case when f.verified_past then 10 when f.exp_count >= 2 then 8 when f.exp_count = 1 then 5 else 0 end as s_experience,
      ( case when cardinality(v_platforms) = 0 then 2.0
             else 4.0 * cardinality(f.platform_names) / cardinality(v_platforms) end
      + case when cardinality(v_langs) = 0 then 1.5
             else 3.0 * cardinality(f.language_names) / cardinality(v_langs) end
      + case when c.category_id is null then 0.75 when f.cat_match then 1.5 else 0 end
      + case when c.content_type_id is null then 0.75 when f.ct_match then 1.5 else 0 end) as s_fit,
      case f.availability when 'open' then 10 when 'limited' then 5 else 0 end as s_avail
    from f
  ),
  scored as (
    select s.*,
      least(100, round(s.s_tools + s.s_skills + s.s_portfolio + s.s_experience + s.s_fit + s.s_avail))::int as total_score,
      array_remove(array[
        case when cardinality(s.tool_names) > 0 then
          format('Uses %s (%s/%s required tools)', array_to_string(s.tool_names[1:3], ', '),
                 cardinality(s.tool_names), cardinality(v_tools)) end,
        case when cardinality(s.skill_names) > 0 then
          format('Skilled in %s', array_to_string(s.skill_names[1:3], ', ')) end,
        case when s.match_posts > 0 then
          format('%s portfolio %s this brief''s format & style', s.match_posts,
                 case when s.match_posts = 1 then 'piece matches' else 'pieces match' end) end,
        case when s.verified_past then 'Verified past brand collaboration'
             when s.exp_count > 0 then format('%s past brand project%s', s.exp_count,
                 case when s.exp_count = 1 then '' else 's' end) end,
        case when cardinality(s.platform_names) > 0 then
          format('Creates for %s', array_to_string(s.platform_names[1:3], ', ')) end,
        case when cardinality(s.language_names) > 0 then
          format('Works in %s', array_to_string(s.language_names, ', ')) end,
        case s.availability when 'open' then 'Available now' when 'limited' then 'Limited availability' end,
        case when s.is_verified then 'Verified creator' end
      ], null) as why
    from s
  ),
  page as (
    select sc.*, count(*) over () as total
    from scored sc
    order by sc.total_score desc, sc.followers desc, sc.id
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.creator_card(page.id),
         page.total_score,
         jsonb_build_object(
           'tools', jsonb_build_object('score', round(page.s_tools, 1), 'max', 25),
           'skills', jsonb_build_object('score', round(page.s_skills, 1), 'max', 20),
           'portfolio', jsonb_build_object('score', round(page.s_portfolio, 1), 'max', 25),
           'experience', jsonb_build_object('score', page.s_experience, 'max', 10),
           'fit', jsonb_build_object('score', round(page.s_fit, 1), 'max', 10),
           'availability', jsonb_build_object('score', page.s_avail, 'max', 10)),
         page.why,
         page.total
  from page
  order by page.total_score desc, page.followers desc, page.id;
end $function$;

-- ai_match_evidence: verified items = verified past work
CREATE OR REPLACE FUNCTION public.ai_match_evidence(p_search uuid, p_creator uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'idea', s.idea,
    'requirements', s.requirements,
    'score', r.score, 'breakdown', r.breakdown,
    'creator', jsonb_build_object('name', p.display_name, 'headline', p.headline, 'bio', left(p.bio, 600), 'location', p.location,
      'experience_level', d.experience_level, 'years_experience', d.years_experience, 'availability', d.availability,
      'verified', p.is_verified),
    'tools', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_tools j join public.ai_tools t on t.id = j.tool_id where j.creator_id = p.id), '[]'),
    'skills', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_skills j join public.skills t on t.id = j.skill_id where j.creator_id = p.id), '[]'),
    'specializations', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_categories j join public.categories t on t.id = j.category_id where j.creator_id = p.id), '[]'),
    'styles', coalesce((select jsonb_agg(t.name order by t.name) from public.creator_styles j join public.styles t on t.id = j.style_id where j.creator_id = p.id), '[]'),
    'posts', coalesce((select jsonb_agg(q.j) from (
        select jsonb_build_object('title', po.title, 'description', left(po.description, 240), 'content_type', ct.name, 'style', st.name,
                 'tools', (select jsonb_agg(t.name) from public.post_tools pt join public.ai_tools t on t.id = pt.tool_id where pt.post_id = po.id)) as j
        from public.posts po
        left join public.content_types ct on ct.id = po.content_type_id
        left join public.styles st on st.id = po.style_id
        where po.creator_id = p.id and not po.is_removed
        order by (coalesce((po.content_type_id::text = s.requirements->>'content_type_id')::int, 0)
                  + coalesce((po.style_id::text = s.requirements->>'style_id')::int, 0)
                  + (select count(*) from public.post_tools pt where pt.post_id = po.id
                     and pt.tool_id::text in (select jsonb_array_elements_text(coalesce(s.requirements->'tool_ids', '[]'))))) desc nulls last,
                 po.likes_count desc, po.created_at desc
        limit 6) q), '[]'),
    'completed_projects', (select count(*) from public.campaign_creators x where x.creator_id = p.id and x.status = 'completed'),
    'verified_items', (select count(*) from public.verifications v where v.creator_id = p.id and v.status = 'approved' and v.type = 'past_work'))
  from public.ai_match_searches s
  join public.ai_match_results r on r.search_id = s.id and r.creator_id = p_creator
  join public.profiles p on p.id = p_creator
  left join public.creator_details d on d.profile_id = p.id
  where s.id = p_search and s.brand_id = auth.uid();
$function$;

-- admin_list_verifications: past work (and legacy identity requests) only
CREATE OR REPLACE FUNCTION public.admin_list_verifications(p_status text DEFAULT 'pending'::text)
 RETURNS TABLE(id uuid, type text, title text, status text, evidence_url text, evidence_notes text, created_at timestamp with time zone, reviewed_at timestamp with time zone, creator jsonb, subject text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_admin();
  return query
  select v.id, v.type, v.title, v.status, v.evidence_url, v.evidence_notes, v.created_at, v.reviewed_at,
         public.mini_profile(v.creator_id),
         coalesce((select e.brand_name || ' — ' || e.project_title from public.creator_experiences e where e.id = v.experience_id),
                  'Identity')
  from public.verifications v
  where (p_status is null or v.status = p_status) and v.type in ('past_work', 'identity')
  order by v.created_at desc;
end $function$;

-- admin_stats: pending = past work + ID + company
CREATE OR REPLACE FUNCTION public.admin_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'creators', (select count(*) from public.profiles where role = 'creator'),
    'brands', (select count(*) from public.profiles where role = 'brand'),
    'admins', (select count(*) from public.profiles where role = 'admin'),
    'suspended', (select count(*) from public.profiles where is_suspended),
    'verified_creators', (select count(*) from public.profiles where role = 'creator' and is_verified),
    'posts', (select count(*) from public.posts where not is_removed),
    'removed_posts', (select count(*) from public.posts where is_removed),
    'campaigns', jsonb_build_object(
      'draft', (select count(*) from public.campaigns where status = 'draft'),
      'active', (select count(*) from public.campaigns where status = 'active'),
      'completed', (select count(*) from public.campaigns where status = 'completed')),
    'applications', (select count(*) from public.campaign_applications),
    'messages', (select count(*) from public.messages),
    'likes', (select count(*) from public.likes),
    'follows', (select count(*) from public.follows),
    'pending_verifications', (select count(*) from public.verifications where status = 'pending' and type in ('past_work', 'identity'))
                              + (select count(*) from public.identity_verifications where status = 'pending')
                              + (select count(*) from public.company_verifications where status = 'pending'),
    'open_reports', (select count(*) from public.reports where status = 'open'),
    'signups_14d', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'count',
               (select count(*) from public.profiles p where p.created_at::date = d::date)) order by d)
      from generate_series(current_date - 13, current_date, interval '1 day') d), '[]'::jsonb),
    'top_tools', coalesce((
      select jsonb_agg(x order by (x->>'count')::int desc)
      from (select jsonb_build_object('name', t.name, 'count', count(*)) as x
            from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
            group by t.name order by count(*) desc limit 8) q), '[]'::jsonb)
  );
end $function$;

-- do_hire: unverified (gated) brands can't hire
CREATE OR REPLACE FUNCTION private.do_hire(p_actor uuid, p_campaign uuid, p_creator uuid, p_amount integer, p_currency text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_me uuid := p_actor;
  v_c public.campaigns;
  v_x public.campaign_creators;
  v_cur text;
  v_e public.escrow_payments;
  v_label text;
begin
  select * into v_c from public.campaigns where id = p_campaign;
  if found and v_c.brand_id = v_me and not public.brand_can_operate(v_me) then
    raise exception 'Verify your brand account before hiring (Verification page).' using errcode = '42501';
  end if;
  if not found or v_c.brand_id <> v_me then
    raise exception 'Only the brand that owns this campaign can hire for it' using errcode = '42501';
  end if;
  if v_c.status = 'completed' then raise exception 'This campaign is already completed'; end if;
  if not exists (select 1 from public.profiles where id = p_creator and role = 'creator' and not is_suspended) then
    raise exception 'Creator not found';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 10000000 then
    raise exception 'Enter an agreed amount greater than zero' using errcode = '23514';
  end if;
  v_cur := upper(coalesce(nullif(trim(p_currency), ''), v_c.currency));
  if v_cur !~ '^[A-Z]{3}$' then raise exception 'Invalid currency'; end if;
  v_label := private.money(p_amount, v_cur);

  select * into v_x from public.campaign_creators where campaign_id = p_campaign and creator_id = p_creator for update;
  if exists (select 1 from public.escrow_payments where campaign_creator_id = v_x.id and status <> 'unfunded') then
    raise exception 'Escrow is already funded — the agreed amount is locked' using errcode = '23514';
  end if;

  perform private.set_context(v_me, null, jsonb_build_object('amount', p_amount, 'currency', v_cur, 'amount_label', v_label));
  if v_x.id is null then
    insert into public.campaign_creators (campaign_id, creator_id, status, hired_at, agreed_amount, currency)
    values (p_campaign, p_creator, 'awaiting_funding', now(), p_amount, v_cur) returning * into v_x;
  else
    if v_x.status in ('approved', 'completed', 'rejected', 'cancelled') then
      raise exception 'This project is already %', replace(v_x.status, '_', ' ');
    end if;
    update public.campaign_creators set agreed_amount = p_amount, currency = v_cur, hired_at = coalesce(hired_at, now())
      where id = v_x.id;
    -- New hires wait for the brand to fund the escrow before work starts (0023)
    if v_x.status in ('applied', 'shortlisted', 'hired') then
      update public.campaign_creators set status = 'awaiting_funding' where id = v_x.id;
    elsif v_x.hired_at is null then
      -- A sprint entrant who already submitted: hiring doesn't change where their work is in review
      insert into public.project_events (project_id, actor_id, kind, event, data)
      values (v_x.id, v_me, 'status', 'hired', private.ctx_data());
    end if;
  end if;

  select * into v_e from public.escrow_payments where campaign_creator_id = v_x.id;
  if v_e.id is null then
    insert into public.escrow_payments (campaign_creator_id, amount, currency, platform_fee)
    values (v_x.id, p_amount, v_cur, ceil(p_amount * 0.08)::int) returning * into v_e;
    insert into public.payment_events (escrow_id, actor_id, event, from_status, to_status, amount, currency, note)
    values (v_e.id, v_me, 'created', null, 'unfunded', p_amount, v_cur, 'Escrow opened on hire (test mode)');
  elsif v_e.amount <> p_amount or v_e.currency <> v_cur then
    update public.escrow_payments set amount = p_amount, currency = v_cur, platform_fee = ceil(p_amount * 0.08)::int where id = v_e.id;
    insert into public.payment_events (escrow_id, actor_id, event, from_status, to_status, amount, currency)
    values (v_e.id, v_me, 'amount_set', 'unfunded', 'unfunded', p_amount, v_cur);
  end if;
  return v_x.id;
end $function$;

-- handle_new_user: brand type chosen at signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_role text := coalesce(new.raw_user_meta_data->>'role', 'creator');
  v_name text := nullif(trim(new.raw_user_meta_data->>'display_name'), '');
  v_base text;
  v_username text;
  v_i int := 0;
begin
  if v_role not in ('creator', 'brand') then
    v_role := 'creator';
  end if;

  v_base := lower(regexp_replace(
    coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1), 'user'),
    '[^a-zA-Z0-9_.]', '', 'g'));
  if char_length(v_base) < 3 then
    v_base := v_base || 'user';
  end if;
  v_base := left(v_base, 24);
  v_username := v_base;
  while exists (select 1 from public.profiles where username = v_username) loop
    v_i := v_i + 1;
    v_username := v_base || v_i::text;
  end loop;

  insert into public.profiles (id, role, username, display_name)
  values (new.id, v_role, v_username, coalesce(left(v_name, 80), v_username));

  insert into public.profile_stats (profile_id) values (new.id);

  if v_role = 'creator' then
    insert into public.creator_details (profile_id) values (new.id);
  else
    insert into public.brand_details (profile_id, company_name, brand_type)
    values (new.id, coalesce(left(v_name, 120), v_username),
            case when new.raw_user_meta_data->>'brand_type' in ('individual', 'company') then new.raw_user_meta_data->>'brand_type' end);
  end if;

  return new;
end $function$;

drop function public.search_creators(text, integer[], integer[], integer[], integer[], integer[], text[], text[], integer[], boolean, text, text, uuid[], integer, integer);
-- search_creators: Phone verified / Identity verified filters
CREATE OR REPLACE FUNCTION public.search_creators(p_query text DEFAULT NULL::text, p_skills integer[] DEFAULT NULL::integer[], p_categories integer[] DEFAULT NULL::integer[], p_tools integer[] DEFAULT NULL::integer[], p_content_types integer[] DEFAULT NULL::integer[], p_styles integer[] DEFAULT NULL::integer[], p_experience text[] DEFAULT NULL::text[], p_availability text[] DEFAULT NULL::text[], p_languages integer[] DEFAULT NULL::integer[], p_verified_only boolean DEFAULT false, p_sort text DEFAULT 'best'::text, p_match text DEFAULT 'all'::text, p_exclude uuid[] DEFAULT NULL::uuid[], p_limit integer DEFAULT 24, p_offset integer DEFAULT 0, p_phone_verified boolean DEFAULT false, p_identity_verified boolean DEFAULT false)
 RETURNS TABLE(creator jsonb, score real, matched_groups integer, total_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with f as (
    select * from public.creator_search_flags(p_query, p_skills, p_categories, p_tools, p_content_types,
      p_styles, p_experience, p_availability, p_languages, p_verified_only)
  ),
  g as (
    select f.*,
      ( (f.m_query is true)::int + (f.m_skills is true)::int + (f.m_categories is true)::int
      + (f.m_tools is true)::int + (f.m_content_types is true)::int + (f.m_styles is true)::int
      + (f.m_experience is true)::int + (f.m_availability is true)::int
      + (f.m_languages is true)::int + (f.m_verified is true)::int) as hits,
      ( (f.m_query is not null)::int + (f.m_skills is not null)::int + (f.m_categories is not null)::int
      + (f.m_tools is not null)::int + (f.m_content_types is not null)::int + (f.m_styles is not null)::int
      + (f.m_experience is not null)::int + (f.m_availability is not null)::int
      + (f.m_languages is not null)::int + (f.m_verified is not null)::int) as active
    from f
    where (p_exclude is null or f.id <> all(p_exclude))
      and (not coalesce(p_phone_verified, false) or exists (select 1 from public.profiles x where x.id = f.id and x.phone_verified_at is not null))
      and (not coalesce(p_identity_verified, false) or exists (select 1 from public.profiles x where x.id = f.id and x.identity_verified_at is not null))
  ),
  m as (
    select g.*, (g.text_score * 3 + g.hits * 2 + g.overlap * 0.5 + ln(1 + g.followers) * 0.3)::real as sc
    from g
    where case when p_match = 'any' then g.active = 0 or g.hits > 0
          else coalesce(g.m_query, true) and coalesce(g.m_skills, true) and coalesce(g.m_categories, true)
           and coalesce(g.m_tools, true) and coalesce(g.m_content_types, true) and coalesce(g.m_styles, true)
           and coalesce(g.m_experience, true) and coalesce(g.m_availability, true)
           and coalesce(g.m_languages, true) and coalesce(g.m_verified, true) end
  ),
  page as (
    select m.id, m.sc, m.hits, count(*) over () as total,
      case p_sort
        when 'newest' then extract(epoch from m.created_at)::float8
        when 'followers' then m.followers::float8
        else m.sc::float8 end as sort_key
    from m
    order by sort_key desc, m.id
    limit greatest(least(p_limit, 60), 1) offset greatest(p_offset, 0)
  )
  select public.creator_card(page.id), page.sc, page.hits, page.total
  from page
  order by page.sort_key desc, page.id;
$function$;

drop function public.get_swipe_deck(uuid, integer, boolean);
-- get_swipe_deck: Phone verified / Identity verified filters
CREATE OR REPLACE FUNCTION public.get_swipe_deck(p_campaign_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 15, p_include_seen boolean DEFAULT false, p_phone_verified boolean DEFAULT false, p_identity_verified boolean DEFAULT false)
 RETURNS TABLE(creator jsonb, score integer, reasons text[], campaign_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_campaign uuid := p_campaign_id;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if v_campaign is null and public.current_app_role() = 'brand' then
    select c.id into v_campaign from public.campaigns c
    where c.brand_id = v_uid and c.status = 'active'
    order by c.created_at desc limit 1;
  end if;

  if v_campaign is not null then
    return query
      select r.creator, r.score, r.reasons, v_campaign
      from public.rank_creators_for_campaign(v_campaign, 60, 0, false) r
      where (p_include_seen or not public.creator_seen((r.creator->>'id')::uuid))
        and (not coalesce(p_phone_verified, false) or (r.creator->'badges'->>'phone_verified')::boolean)
        and (not coalesce(p_identity_verified, false) or (r.creator->'badges'->>'identity_verified')::boolean)
      order by r.score desc
      limit greatest(least(p_limit, 40), 1);
    return;
  end if;

  return query
  with my_tools as (
    select tool_id from public.creator_tools where creator_id = v_uid
    union select pt.tool_id from public.likes l join public.post_tools pt on pt.post_id = l.post_id where l.user_id = v_uid
    union select pt.tool_id from public.saves sv join public.post_tools pt on pt.post_id = sv.post_id where sv.user_id = v_uid
    union select pt.tool_id from public.interactions i join public.post_tools pt on pt.post_id = i.target_id
          where i.user_id = v_uid and i.target_type = 'post' and i.action = 'watch'
            and coalesce((i.context->>'ms')::int, 0) >= 3000
  ),
  my_cats as (
    select category_id from public.creator_categories where creator_id = v_uid
    union select po.category_id from public.likes l join public.posts po on po.id = l.post_id
          where l.user_id = v_uid and po.category_id is not null
  ),
  cand as (
    select p.id, p.is_verified, coalesce(st.followers_count, 0) as followers,
      array(select t.name from public.creator_tools ct join public.ai_tools t on t.id = ct.tool_id
            where ct.creator_id = p.id and ct.tool_id in (select tool_id from my_tools) order by t.sort, t.name) as shared_tools,
      array(select c.name from public.creator_categories cc join public.categories c on c.id = cc.category_id
            where cc.creator_id = p.id and cc.category_id in (select category_id from my_cats) order by c.sort) as shared_cats,
      (select count(*) from public.posts po where po.creator_id = p.id and not po.is_removed) as n_posts,
      (select max(po.created_at) from public.posts po where po.creator_id = p.id and not po.is_removed) as last_post
    from public.profiles p
    left join public.profile_stats st on st.profile_id = p.id
    where p.role = 'creator' and not p.is_suspended and p.id <> v_uid
      and (p_include_seen or not public.creator_seen(p.id))
      and (not coalesce(p_phone_verified, false) or p.phone_verified_at is not null)
      and (not coalesce(p_identity_verified, false) or p.identity_verified_at is not null)
      and (p_include_seen or not exists (select 1 from public.follows f where f.follower_id = v_uid and f.following_id = p.id))
  ),
  scored as (
    select cand.*,
      least(100, round(
          least(cardinality(shared_tools), 4) * 10
        + least(cardinality(shared_cats), 2) * 12
        + least(ln(1 + followers) * 5, 15)
        + case when is_verified then 10 else 0 end
        + least(n_posts, 6) * 2
        + case when last_post > now() - interval '30 days' then 9 else 0 end))::int as sc,
      array_remove(array[
        case when cardinality(shared_tools) > 0 then
          format('Shares your tools: %s', array_to_string(shared_tools[1:3], ', ')) end,
        case when cardinality(shared_cats) > 0 then
          format('Works in %s', array_to_string(shared_cats[1:2], ' & ')) end,
        case when is_verified then 'Verified creator' end,
        case when n_posts > 0 then format('%s portfolio piece%s', n_posts, case when n_posts = 1 then '' else 's' end) end,
        case when last_post > now() - interval '30 days' then 'Posted recently' end,
        case when followers > 0 then format('%s follower%s', followers, case when followers = 1 then '' else 's' end) end
      ], null) as why
    from cand
  )
  select public.creator_card(scored.id), scored.sc, scored.why, null::uuid
  from scored
  order by scored.sc desc, scored.id
  limit greatest(least(p_limit, 40), 1);
end $function$;

drop function public.admin_list_reports(text);
-- admin_list_reports: priority (impersonation reports first)
CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'open'::text)
 RETURNS TABLE(id uuid, target_type text, target_id uuid, reason text, details text, status text, created_at timestamp with time zone, reporter jsonb, target_label text, target_removed boolean, priority text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.assert_admin();
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at,
         public.mini_profile(r.reporter_id),
         case r.target_type
           when 'post' then (select po.title from public.posts po where po.id = r.target_id)
           when 'profile' then (select pr.display_name from public.profiles pr where pr.id = r.target_id)
           when 'campaign' then (select c.title from public.campaigns c where c.id = r.target_id)
           when 'comment' then (select left(c.body, 80) from public.comments c where c.id = r.target_id)
           else null end,
         case when r.target_type = 'post' then (select po.is_removed from public.posts po where po.id = r.target_id) end,
         r.priority
  from public.reports r
  where p_status is null or r.status = p_status
  order by (r.priority = 'high') desc, r.created_at desc;
end $function$;

revoke execute on function public.admin_list_reports(text) from anon;

-- ---------------------------------------------------------------------------
-- 13. Privileges
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema private from public, anon, authenticated;
-- Server routes only (service role): phone / ID / company submissions, invitations, retention
revoke all on function public.verification_record_phone(uuid, text, text, text, text),
  public.verification_submit_identity(uuid, text, text, text, text, text, date, text, boolean),
  public.verification_set_mock_check(uuid, jsonb),
  public.verification_submit_company(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean),
  public.company_invitation_lookup(text), public.company_invitation_respond(text, text, text),
  public.identity_images_due(int, int), public.identity_image_purged(uuid),
  public.tg_campaign_publish_gate()
  from public, anon, authenticated;
grant execute on function public.verification_record_phone(uuid, text, text, text, text),
  public.verification_submit_identity(uuid, text, text, text, text, text, date, text, boolean),
  public.verification_set_mock_check(uuid, jsonb),
  public.verification_submit_company(uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean),
  public.company_invitation_lookup(text), public.company_invitation_respond(text, text, text),
  public.identity_images_due(int, int), public.identity_image_purged(uuid)
  to service_role;
-- Signed-in users (each checks the caller inside)
revoke all on function public.get_my_verification(), public.set_brand_type(text), public.has_admin_permission(text),
  public.brand_can_operate(uuid), public.trust_badges(uuid),
  public.admin_list_identity_verifications(text, text, text, int, int), public.admin_get_identity_verification(uuid),
  public.admin_decide_identity(uuid, text, text), public.admin_list_company_verifications(text, text, int, int),
  public.admin_get_company_verification(uuid), public.admin_decide_company(uuid, text, text),
  public.admin_add_contact(uuid, text, text, text, text, text),
  public.admin_create_invitation(uuid, uuid, text, text, text, text, text, int)
  from public, anon;
grant execute on function public.get_my_verification(), public.set_brand_type(text), public.has_admin_permission(text),
  public.brand_can_operate(uuid), public.trust_badges(uuid),
  public.admin_list_identity_verifications(text, text, text, int, int), public.admin_get_identity_verification(uuid),
  public.admin_decide_identity(uuid, text, text), public.admin_list_company_verifications(text, text, int, int),
  public.admin_get_company_verification(uuid), public.admin_decide_company(uuid, text, text),
  public.admin_add_contact(uuid, text, text, text, text, text),
  public.admin_create_invitation(uuid, uuid, text, text, text, text, text, int)
  to authenticated, service_role;
-- Cards are public (signed-out landing page): badges are booleans only
grant execute on function public.trust_badges(uuid) to anon;
