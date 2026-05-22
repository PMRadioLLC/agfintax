-- AG FinTax landing page — leads + pageviews schema.
-- Run this once in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- Leads (form submissions)
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  first_name      text not null,
  last_name       text not null,
  email           text not null,
  phone           text,
  interest        text,
  message         text,
  ip_address      inet,
  user_agent      text,
  referrer        text,
  landing_page    text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  sa_click_id     text,
  status          text not null default 'new'  -- new | contacted | meeting_booked | won | lost
);

create index if not exists leads_created_at_idx   on public.leads (created_at desc);
create index if not exists leads_email_idx        on public.leads (email);
create index if not exists leads_utm_source_idx   on public.leads (utm_source);
create index if not exists leads_utm_campaign_idx on public.leads (utm_campaign);

-- Pageviews (every visit to the landing page)
create table if not exists public.pageviews (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  ip_address      inet,
  user_agent      text,
  referrer        text,
  path            text,
  query_string    text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  sa_click_id     text
);

create index if not exists pageviews_created_at_idx   on public.pageviews (created_at desc);
create index if not exists pageviews_ip_idx           on public.pageviews (ip_address);
create index if not exists pageviews_utm_source_idx   on public.pageviews (utm_source);
create index if not exists pageviews_utm_campaign_idx on public.pageviews (utm_campaign);

-- Lock these tables down. The API uses the service-role key, which bypasses RLS.
-- No client-side (anon) writes or reads should be possible.
alter table public.leads      enable row level security;
alter table public.pageviews  enable row level security;

-- Intentionally no policies for anon/authenticated roles.
-- If you want analytics dashboards via Supabase Studio with your own user, add
-- policies for the authenticated role manually, e.g.:
--   create policy "owners can read leads" on public.leads
--     for select to authenticated using (auth.jwt()->>'role' = 'admin');
