-- Redefinição dos dados de demonstração (executada pelo seed e diariamente via pg_cron).
-- Recria serviços, expediente e agendamentos fictícios relativos à data atual, de forma
-- determinística. Contas de usuário são preservadas. Executável apenas por service_role.

create or replace function barbearia.reset_demo_data(p_shop_slug text default 'barbearia-demo')
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_shop      barbearia.shops;
  v_today     date;
  v_clients   uuid[];
  v_pros      uuid[];
  v_services  barbearia.services[];
  v_svc       barbearia.services;
  v_day       date;
  v_start     timestamptz;
  v_status    barbearia.booking_status;
  v_hour      int;
  v_count     int := 0;
  p           int;
  k           int;
begin
  select * into v_shop from barbearia.shops where slug = p_shop_slug;
  if not found then
    raise exception 'BARBEARIA_INEXISTENTE' using errcode = 'P0002';
  end if;
  v_today := (now() at time zone v_shop.timezone)::date;

  delete from barbearia.bookings where shop_id = v_shop.id; -- e-mails da fila caem em cascata
  delete from barbearia.time_off t using barbearia.professionals pr
    where pr.id = t.professional_id and pr.shop_id = v_shop.id;
  delete from barbearia.working_hours w using barbearia.professionals pr
    where pr.id = w.professional_id and pr.shop_id = v_shop.id;

  -- Serviços voltam aos valores do seed (supabase/seed.sql).
  delete from barbearia.services
    where shop_id = v_shop.id
      and id not in ('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102',
                     '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000104');
  insert into barbearia.services (id, shop_id, name, description, price_cents, duration_minutes, active) values
    ('00000000-0000-4000-8000-000000000101', v_shop.id, 'Corte masculino', 'Corte na tesoura ou máquina, com lavagem.', 4500, 30, true),
    ('00000000-0000-4000-8000-000000000102', v_shop.id, 'Barba', 'Barba com toalha quente e navalha.', 3500, 30, true),
    ('00000000-0000-4000-8000-000000000103', v_shop.id, 'Corte + barba', 'Combo completo.', 7000, 60, true),
    ('00000000-0000-4000-8000-000000000104', v_shop.id, 'Pigmentação', 'Pigmentação de barba ou cabelo.', 5000, 45, true)
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, price_cents = excluded.price_cents,
    duration_minutes = excluded.duration_minutes, active = true;

  update barbearia.professionals set active = true where shop_id = v_shop.id;
  insert into barbearia.professional_services (professional_id, service_id)
    select pr.id, s.id from barbearia.professionals pr
    join barbearia.services s on s.shop_id = pr.shop_id
    where pr.shop_id = v_shop.id
  on conflict do nothing;
  insert into barbearia.working_hours (professional_id, weekday, start_time, end_time)
    select pr.id, wd, '09:00', '18:00'
    from barbearia.professionals pr, generate_series(1, 6) wd
    where pr.shop_id = v_shop.id;

  select array_agg(id order by full_name) into v_clients
    from barbearia.profiles where shop_id = v_shop.id and role = 'client';
  select array_agg(id order by display_name) into v_pros
    from barbearia.professionals where shop_id = v_shop.id;
  select array_agg(s order by s.price_cents) into v_services
    from barbearia.services s where s.shop_id = v_shop.id;
  if v_clients is null or v_pros is null then
    return 0;
  end if;

  -- Últimas 2 semanas (para indicadores) e próximos 6 dias; domingos sem expediente.
  for v_day in
    select g::date from generate_series(v_today - 14, v_today + 6, interval '1 day') g
  loop
    continue when extract(dow from v_day) = 0;
    for p in 1 .. array_length(v_pros, 1) loop
      for k in 0 .. 2 loop
        -- Horários espaçados de 2 h por profissional: nunca se sobrepõem (serviços ≤ 60 min).
        v_hour := 9 + ((extract(doy from v_day)::int + p + k * 2) % 8);
        v_start := (v_day + make_time(v_hour, 0, 0)) at time zone v_shop.timezone;
        v_svc := v_services[1 + (v_count % array_length(v_services, 1))];
        v_status := case
          when v_start < now() then
            case when v_count % 9 = 0 then 'no_show' when v_count % 5 = 0 then 'cancelled' else 'completed' end
          else
            case when v_count % 7 = 0 then 'cancelled' else 'confirmed' end
        end::barbearia.booking_status;

        insert into barbearia.bookings
          (shop_id, professional_id, client_id, service_id, period, price_cents, status, cancelled_at, cancel_reason)
        values
          (v_shop.id, v_pros[p], v_clients[1 + (v_count % array_length(v_clients, 1))], v_svc.id,
           tstzrange(v_start, v_start + make_interval(mins => v_svc.duration_minutes), '[)'),
           v_svc.price_cents, v_status,
           case when v_status = 'cancelled' then v_start - interval '1 day' end,
           case when v_status = 'cancelled' then 'Dado de demonstração' end);
        v_count := v_count + 1;
      end loop;
    end loop;
  end loop;
  return v_count;
end $$;

revoke all on function barbearia.reset_demo_data(text) from public;
grant execute on function barbearia.reset_demo_data(text) to service_role;
