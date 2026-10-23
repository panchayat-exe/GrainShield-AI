-- =============================================================
-- Migration 002: Auth Triggers — Profile auto-creation and role helpers
-- Fully Idempotent: safe to run multiple times.
-- =============================================================

-- -----------------------------------------------
-- Function: create profile on new user signup
-- Called by the auth.users INSERT trigger.
-- -----------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Insert a profile if one does not already exist (idempotent).
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', null),
    'user'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- Attach trigger to auth.users (drop if exists first)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------
-- Function: get current user's role (trusted helper for RLS)
-- -----------------------------------------------
create or replace function public.get_my_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role
  from public.profiles
  where id = auth.uid();
  return coalesce(v_role, 'user');
end;
$$;

-- -----------------------------------------------
-- Function: check if current user is an admin or super_admin
-- -----------------------------------------------
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return public.get_my_role() in ('admin', 'super_admin');
end;
$$;

-- -----------------------------------------------
-- Function: promote a user to a role.
-- -----------------------------------------------
create or replace function public.set_user_role(
  target_user_id uuid,
  new_role       user_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only super_admins can call this function
  if public.get_my_role() <> 'super_admin' then
    raise exception 'Only super_admins can assign roles.';
  end if;

  update public.profiles
  set role = new_role
  where id = target_user_id;
end;
$$;

revoke all on function public.set_user_role(uuid, user_role) from public, anon, authenticated;
