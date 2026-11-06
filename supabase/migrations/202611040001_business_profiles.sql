-- Run in your Supabase SQL editor; safe to run again. No service-role key is used by Bol-Bill.
create table if not exists public.bolbill_business_profiles (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  business_name text not null check (char_length(btrim(business_name)) between 1 and 100),
  owner_name text not null check (char_length(btrim(owner_name)) between 1 and 80),
  address text not null check (char_length(btrim(address)) between 5 and 300),
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  receipt_footer text not null default 'Dhanyavaad! Phir aaiye.' check (char_length(receipt_footer) <= 160)
);

alter table public.bolbill_business_profiles enable row level security;
-- Supabase grants ALL (TRUNCATE included, which RLS does not cover) by default: grant exactly what the app uses.
revoke all on public.bolbill_business_profiles from public, anon, authenticated;
grant select, insert, update on public.bolbill_business_profiles to authenticated;

drop policy if exists "Owner reads business profile" on public.bolbill_business_profiles;
drop policy if exists "Owner creates business profile" on public.bolbill_business_profiles;
drop policy if exists "Owner updates business profile" on public.bolbill_business_profiles;

create policy "Owner reads business profile" on public.bolbill_business_profiles
  for select to authenticated using ((select auth.uid()) = owner_id);
create policy "Owner creates business profile" on public.bolbill_business_profiles
  for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "Owner updates business profile" on public.bolbill_business_profiles
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
