-- Dados fictícios reproduzíveis (IDs fixos). Usuários de demonstração são criados por
-- `pnpm seed:demo` (API admin do Supabase), pois o cadastro passa pelo Supabase Auth.
insert into barbearia.shops (id, slug, name, timezone)
values ('00000000-0000-4000-8000-000000000001', 'barbearia-demo', 'Barbearia Navalha de Ouro (demo)', 'America/Sao_Paulo')
on conflict (id) do nothing;

insert into barbearia.services (id, shop_id, name, description, price_cents, duration_minutes) values
  ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000001',
   'Corte masculino', 'Corte na tesoura ou máquina, com lavagem.', 4500, 30),
  ('00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000001',
   'Barba', 'Barba com toalha quente e navalha.', 3500, 30),
  ('00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000001',
   'Corte + barba', 'Combo completo.', 7000, 60),
  ('00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000001',
   'Pigmentação', 'Pigmentação de barba ou cabelo.', 5000, 45)
on conflict (id) do nothing;
