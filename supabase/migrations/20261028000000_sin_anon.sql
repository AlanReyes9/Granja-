-- Supabase concede por defecto permisos al rol anon en las tablas y funciones nuevas de public.
-- RLS ya lo bloquea, pero se quitan para que la clave pública no tenga ningún acceso directo.
revoke execute on function public.es_admin() from anon;
revoke all on public.licencias, public.clientes, public.admins from anon;
