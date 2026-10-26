-- Tabla de seriales de Nexus Farmer. Solo la función "licencias" (con la service role key) puede leerla:
-- RLS activado y sin políticas, así que las claves públicas (anon) no ven nada.
create table if not exists public.licencias (
  serial        text primary key,
  client        text not null default '',
  plan          text not null default '',
  days          integer,                 -- duración en días desde la activación (si no es permanente)
  expires_at    timestamptz,             -- fecha fija de caducidad (se rellena al activar si se usa days)
  permanent     boolean not null default false,
  machine_id    text,                    -- equipo al que está atado (null = libre)
  activated_at  timestamptz,
  last_seen_at  timestamptz,
  app_version   text,
  revoked       boolean not null default false,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  constraint licencias_duracion check (permanent or days is not null or expires_at is not null)
);

alter table public.licencias enable row level security;
