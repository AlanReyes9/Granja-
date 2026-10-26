-- Panel de administración de Nexus Farmer: clientes, administradores y permisos.
-- Solo los usuarios de Supabase Auth cuyo email esté en public.admins pueden ver o cambiar datos.

create table if not exists public.clientes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  email       text not null default '',
  telefono    text not null default '',
  notas       text not null default '',
  created_at  timestamptz not null default now()
);

alter table public.licencias
  add column if not exists client_id uuid references public.clientes(id) on delete set null;
create index if not exists licencias_client_id_idx on public.licencias(client_id);

create table if not exists public.admins (
  email       text primary key,
  created_at  timestamptz not null default now()
);

-- ¿El usuario que hace la petición es administrador? (security definer: puede leer admins aunque RLS lo oculte)
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.es_admin() from public;
grant execute on function public.es_admin() to authenticated;

alter table public.clientes enable row level security;
alter table public.admins enable row level security;
-- (licencias ya tenía RLS activado en la migración anterior)

drop policy if exists "admins gestionan clientes" on public.clientes;
create policy "admins gestionan clientes" on public.clientes
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admins gestionan licencias" on public.licencias;
create policy "admins gestionan licencias" on public.licencias
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

drop policy if exists "admins se ven a sí mismos" on public.admins;
create policy "admins se ven a sí mismos" on public.admins
  for select to authenticated using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

grant select, insert, update, delete on public.clientes, public.licencias to authenticated;
grant select on public.admins to authenticated;

-- El panel solo crea seriales en línea; esta comprobación impide además seriales con formato incorrecto.
alter table public.licencias drop constraint if exists licencias_formato_serial;
alter table public.licencias add constraint licencias_formato_serial
  check (serial ~ '^NXF(-[0-9A-Z]{5}){4}$');

-- Para dar acceso a un administrador (después de crear su usuario en Authentication → Users):
--   insert into public.admins (email) values ('tu-correo@ejemplo.com');
