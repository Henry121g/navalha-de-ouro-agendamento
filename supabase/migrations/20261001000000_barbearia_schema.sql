-- Projeto 1 — Agendamento para barbearias
-- Schema isolado `barbearia` (o projeto Supabase é compartilhado com outras demos; ver PLANO.md).
-- Regras críticas ficam no banco: conflito de horário (restrição de exclusão), prazos de
-- cancelamento, permissões (RLS) e fila de e-mails sem duplicidade.

create extension if not exists btree_gist with schema extensions;
create schema if not exists barbearia;

create type barbearia.user_role as enum ('admin', 'professional', 'client');
create type barbearia.booking_status as enum ('confirmed', 'cancelled', 'completed', 'no_show');

create or replace function barbearia.is_valid_timezone(tz text)
returns boolean language plpgsql stable set search_path = '' as $$
begin
  perform now() at time zone tz;
  return true;
exception when others then
  return false;
end $$;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

create table barbearia.shops (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique check (slug ~ '^[a-z0-9-]{3,40}$'),
  name               text not null check (char_length(name) between 2 and 80),
  timezone           text not null default 'America/Sao_Paulo' check (barbearia.is_valid_timezone(timezone)),
  min_advance        interval not null default '30 minutes',
  max_horizon        interval not null default '30 days',
  cancel_deadline    interval not null default '2 hours',
  slot_step_minutes  int not null default 15 check (slot_step_minutes between 5 and 60),
  created_at         timestamptz not null default now()
);

create table barbearia.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  shop_id     uuid not null references barbearia.shops (id),
  role        barbearia.user_role not null default 'client',
  full_name   text not null check (char_length(full_name) between 2 and 100),
  phone       text check (phone is null or phone ~ '^[0-9 ()+-]{8,20}$'),
  created_at  timestamptz not null default now()
);
create index on barbearia.profiles (shop_id, role);

create table barbearia.professionals (
  id            uuid primary key references barbearia.profiles (id) on delete cascade,
  shop_id       uuid not null references barbearia.shops (id),
  display_name  text not null check (char_length(display_name) between 2 and 60),
  bio           text check (char_length(bio) <= 300),
  active        boolean not null default true
);

create table barbearia.services (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references barbearia.shops (id),
  name              text not null check (char_length(name) between 2 and 60),
  description       text check (char_length(description) <= 300),
  price_cents       int not null check (price_cents >= 0),
  duration_minutes  int not null check (duration_minutes between 5 and 480 and duration_minutes % 5 = 0),
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);

create table barbearia.professional_services (
  professional_id  uuid not null references barbearia.professionals (id) on delete cascade,
  service_id       uuid not null references barbearia.services (id) on delete cascade,
  primary key (professional_id, service_id)
);

-- Expediente em hora local da barbearia; convertido para UTC na data consultada.
create table barbearia.working_hours (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references barbearia.professionals (id) on delete cascade,
  weekday          smallint not null check (weekday between 0 and 6), -- 0 = domingo
  start_time       time not null,
  end_time         time not null,
  check (end_time > start_time)
);
create index on barbearia.working_hours (professional_id, weekday);

create table barbearia.time_off (
  id               uuid primary key default gen_random_uuid(),
  professional_id  uuid not null references barbearia.professionals (id) on delete cascade,
  period           tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  reason           text check (char_length(reason) <= 120),
  created_at       timestamptz not null default now()
);
create index on barbearia.time_off using gist (professional_id, period);

create table barbearia.bookings (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references barbearia.shops (id),
  professional_id   uuid not null references barbearia.professionals (id),
  client_id         uuid not null references barbearia.profiles (id),
  service_id        uuid not null references barbearia.services (id),
  period            tstzrange not null check (not isempty(period) and lower_inc(period) and not upper_inc(period)),
  price_cents       int not null check (price_cents >= 0), -- preço congelado no momento da reserva
  status            barbearia.booking_status not null default 'confirmed',
  cancelled_at      timestamptz,
  cancelled_by      uuid references barbearia.profiles (id),
  cancel_reason     text check (char_length(cancel_reason) <= 300),
  rescheduled_from  uuid references barbearia.bookings (id),
  created_at        timestamptz not null default now(),
  -- Critério essencial: o banco rejeita sobreposição para o mesmo profissional,
  -- inclusive entre transações simultâneas (a segunda recebe 23P01).
  constraint bookings_no_overlap
    exclude using gist (professional_id with =, period with &&)
    where (status <> 'cancelled')
);
create index on barbearia.bookings (client_id, lower(period));
create index on barbearia.bookings (shop_id, lower(period));

-- Fila de e-mails. unique(booking_id, kind) impede lembretes duplicados.
create table barbearia.notification_outbox (
  id                   bigint generated always as identity primary key,
  booking_id           uuid not null references barbearia.bookings (id) on delete cascade,
  kind                 text not null check (kind in ('confirmation', 'reminder_24h', 'cancellation')),
  send_after           timestamptz not null default now(),
  status               text not null default 'pending'
                         check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts             int not null default 0,
  locked_at            timestamptz,
  sent_at              timestamptz,
  provider_message_id  text,
  last_error           text,
  created_at           timestamptz not null default now(),
  unique (booking_id, kind)
);
create index on barbearia.notification_outbox (status, send_after);

-- ---------------------------------------------------------------------------
-- Auxiliares de permissão (security definer evita recursão nas políticas)
-- ---------------------------------------------------------------------------

create or replace function barbearia.my_shop()
returns uuid language sql stable security definer set search_path = '' as $$
  select shop_id from barbearia.profiles where id = auth.uid()
$$;

create or replace function barbearia.is_admin_of(p_shop uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from barbearia.profiles
    where id = auth.uid() and shop_id = p_shop and role = 'admin'
  )
$$;

create or replace function barbearia.is_professional_self(p_professional uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() = p_professional and exists (
    select 1 from barbearia.profiles where id = auth.uid() and role = 'professional'
  )
$$;

-- ---------------------------------------------------------------------------
-- Novo usuário: cria perfil de cliente somente para cadastros feitos por este app.
-- O papel nunca vem dos metadados enviados pelo cliente.
-- ---------------------------------------------------------------------------

create or replace function barbearia.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
  v_name text;
begin
  if new.raw_user_meta_data ->> 'app' is distinct from 'barbearia' then
    return new;
  end if;
  select id into v_shop from barbearia.shops
  where slug = coalesce(new.raw_user_meta_data ->> 'shop', 'barbearia-demo');
  if v_shop is null then
    return new;
  end if;
  v_name := left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100);
  if char_length(v_name) < 2 then
    v_name := 'Cliente';
  end if;
  insert into barbearia.profiles (id, shop_id, role, full_name)
  values (new.id, v_shop, 'client', v_name);
  return new;
end $$;

create trigger barbearia_on_auth_user_created
  after insert on auth.users
  for each row execute function barbearia.handle_new_user();

-- ---------------------------------------------------------------------------
-- Disponibilidade
-- ---------------------------------------------------------------------------

create or replace function barbearia.available_slots(p_professional uuid, p_service uuid, p_day date)
returns table (starts_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with shop as (
    select s.* from barbearia.shops s
    join barbearia.professionals p on p.shop_id = s.id
    where p.id = p_professional and p.active
  ),
  svc as (
    select sv.duration_minutes from barbearia.services sv
    join barbearia.professional_services ps on ps.service_id = sv.id
    join shop on shop.id = sv.shop_id
    where sv.id = p_service and ps.professional_id = p_professional and sv.active
  ),
  windows as (
    -- (data + hora local) interpretada no fuso da barbearia → instante UTC correto na data.
    select (p_day + w.start_time) at time zone shop.timezone as ws,
           (p_day + w.end_time)   at time zone shop.timezone as we
    from barbearia.working_hours w, shop
    where w.professional_id = p_professional
      and w.weekday = extract(dow from p_day)
  ),
  candidates as (
    select g as st, g + make_interval(mins => svc.duration_minutes) as en
    from windows, shop, svc,
         generate_series(windows.ws,
                         windows.we - make_interval(mins => svc.duration_minutes),
                         make_interval(mins => shop.slot_step_minutes)) g
  )
  select distinct c.st
  from candidates c, shop
  where c.st >= now() + shop.min_advance
    and c.st <= now() + shop.max_horizon
    and not exists (
      select 1 from barbearia.bookings b
      where b.professional_id = p_professional
        and b.status <> 'cancelled'
        and b.period && tstzrange(c.st, c.en, '[)'))
    and not exists (
      select 1 from barbearia.time_off t
      where t.professional_id = p_professional
        and t.period && tstzrange(c.st, c.en, '[)'))
  order by c.st
$$;

-- ---------------------------------------------------------------------------
-- Cancelamento (interno: recebe o ator explicitamente; não exposto a clientes)
-- ---------------------------------------------------------------------------

create or replace function barbearia._cancel_booking(p_booking uuid, p_actor uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_b      barbearia.bookings;
  v_actor  barbearia.profiles;
  v_shop   barbearia.shops;
begin
  select * into v_b from barbearia.bookings where id = p_booking for update;
  select * into v_actor from barbearia.profiles where id = p_actor;
  -- Mesmo erro para "não existe" e "não é seu": não revela agendamentos de terceiros.
  if v_b.id is null or v_actor.id is null or v_actor.shop_id <> v_b.shop_id then
    raise exception 'AGENDAMENTO_INEXISTENTE' using errcode = 'P0002';
  end if;
  select * into v_shop from barbearia.shops where id = v_b.shop_id;

  if v_actor.role = 'admin' or (v_actor.role = 'professional' and v_b.professional_id = p_actor) then
    null; -- equipe cancela a qualquer momento
  elsif v_b.client_id = p_actor then
    if now() > lower(v_b.period) - v_shop.cancel_deadline then
      raise exception 'PRAZO_CANCELAMENTO_EXPIRADO' using errcode = 'P0001';
    end if;
  else
    raise exception 'AGENDAMENTO_INEXISTENTE' using errcode = 'P0002';
  end if;

  if v_b.status <> 'confirmed' then
    raise exception 'AGENDAMENTO_NAO_CANCELAVEL' using errcode = 'P0001';
  end if;

  update barbearia.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor,
      cancel_reason = left(nullif(trim(p_reason), ''), 300)
  where id = p_booking;

  insert into barbearia.notification_outbox (booking_id, kind)
  values (p_booking, 'cancellation')
  on conflict (booking_id, kind) do nothing;
end $$;

create or replace function barbearia.cancel_booking(p_booking uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'NAO_AUTENTICADO' using errcode = '28000';
  end if;
  perform barbearia._cancel_booking(p_booking, auth.uid(), p_reason);
end $$;

-- ---------------------------------------------------------------------------
-- Agendar / reagendar (atômico: falha no novo horário mantém o original)
-- ---------------------------------------------------------------------------

create or replace function barbearia.book_appointment(
  p_professional uuid,
  p_service uuid,
  p_start timestamptz,
  p_reschedule_from uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_profile  barbearia.profiles;
  v_service  barbearia.services;
  v_shop     barbearia.shops;
  v_id       uuid;
begin
  if v_uid is null then
    raise exception 'NAO_AUTENTICADO' using errcode = '28000';
  end if;
  select * into v_profile from barbearia.profiles where id = v_uid;
  if not found then
    raise exception 'PERFIL_INEXISTENTE' using errcode = '42501';
  end if;
  select * into v_service from barbearia.services
  where id = p_service and active and shop_id = v_profile.shop_id;
  if not found then
    raise exception 'SERVICO_INVALIDO' using errcode = '22023';
  end if;
  select * into v_shop from barbearia.shops where id = v_profile.shop_id;

  if p_reschedule_from is not null then
    if not exists (select 1 from barbearia.bookings where id = p_reschedule_from and client_id = v_uid) then
      raise exception 'AGENDAMENTO_INEXISTENTE' using errcode = 'P0002';
    end if;
    perform barbearia._cancel_booking(p_reschedule_from, v_uid, 'Reagendado pelo cliente');
  end if;

  if not exists (
    select 1 from barbearia.available_slots(p_professional, p_service,
                                            (p_start at time zone v_shop.timezone)::date) s
    where s.starts_at = p_start
  ) then
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
  end if;

  begin
    insert into barbearia.bookings
      (shop_id, professional_id, client_id, service_id, period, price_cents, rescheduled_from)
    values
      (v_shop.id, p_professional, v_uid, p_service,
       tstzrange(p_start, p_start + make_interval(mins => v_service.duration_minutes), '[)'),
       v_service.price_cents, p_reschedule_from)
    returning id into v_id;
  exception when exclusion_violation then
    -- Outra transação reservou o mesmo horário entre a verificação e a inserção.
    raise exception 'HORARIO_INDISPONIVEL' using errcode = 'P0001';
  end;

  insert into barbearia.notification_outbox (booking_id, kind) values (v_id, 'confirmation');
  if p_start - interval '24 hours' > now() then
    insert into barbearia.notification_outbox (booking_id, kind, send_after)
    values (v_id, 'reminder_24h', p_start - interval '24 hours');
  end if;

  return v_id;
end $$;

-- Equipe registra o desfecho depois do horário.
create or replace function barbearia.set_booking_outcome(p_booking uuid, p_status barbearia.booking_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_b barbearia.bookings;
begin
  if p_status not in ('completed', 'no_show') then
    raise exception 'STATUS_INVALIDO' using errcode = '22023';
  end if;
  select * into v_b from barbearia.bookings where id = p_booking for update;
  if v_b.id is null or not (barbearia.is_admin_of(v_b.shop_id) or barbearia.is_professional_self(v_b.professional_id)) then
    raise exception 'AGENDAMENTO_INEXISTENTE' using errcode = 'P0002';
  end if;
  if v_b.status <> 'confirmed' or lower(v_b.period) > now() then
    raise exception 'DESFECHO_NAO_PERMITIDO' using errcode = 'P0001';
  end if;
  update barbearia.bookings set status = p_status where id = p_booking;
end $$;

-- ---------------------------------------------------------------------------
-- Indicadores do painel (somente admin)
-- ---------------------------------------------------------------------------

create or replace function barbearia.dashboard_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  total_bookings        bigint,
  cancelled             bigint,
  completed             bigint,
  no_show               bigint,
  expected_revenue_cents bigint,
  realized_revenue_cents bigint
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_shop uuid := barbearia.my_shop();
begin
  if v_shop is null or not barbearia.is_admin_of(v_shop) then
    raise exception 'SEM_PERMISSAO' using errcode = '42501';
  end if;
  return query
  select count(*),
         count(*) filter (where b.status = 'cancelled'),
         count(*) filter (where b.status = 'completed'),
         count(*) filter (where b.status = 'no_show'),
         coalesce(sum(b.price_cents) filter (where b.status in ('confirmed', 'completed')), 0)::bigint,
         coalesce(sum(b.price_cents) filter (where b.status = 'completed'), 0)::bigint
  from barbearia.bookings b
  where b.shop_id = v_shop and lower(b.period) >= p_from and lower(b.period) < p_to;
end $$;

-- ---------------------------------------------------------------------------
-- Fila de e-mails (somente service_role, usado pela rota de envio)
-- ---------------------------------------------------------------------------

create or replace function barbearia.claim_outbox(p_limit int default 20)
returns setof barbearia.notification_outbox
language sql security definer set search_path = '' as $$
  update barbearia.notification_outbox o
  set status = 'processing', locked_at = now(), attempts = o.attempts + 1
  where o.id in (
    select id from barbearia.notification_outbox
    where attempts < 5
      and ((status = 'pending' and send_after <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes'))
    order by send_after
    for update skip locked
    limit p_limit
  )
  returning o.*
$$;

create or replace function barbearia.finish_outbox(
  p_id bigint, p_status text, p_provider_message_id text default null, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update barbearia.notification_outbox
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      last_error = left(p_error, 500),
      locked_at = null
  where id = p_id and status = 'processing'
$$;

-- ---------------------------------------------------------------------------
-- Privilégios e RLS
-- ---------------------------------------------------------------------------

grant usage on schema barbearia to anon, authenticated, service_role;
revoke all on all functions in schema barbearia from public;
revoke all on all tables in schema barbearia from anon, authenticated;

grant select on barbearia.shops, barbearia.services, barbearia.professionals,
                barbearia.professional_services, barbearia.working_hours to anon, authenticated;
grant select on barbearia.profiles, barbearia.time_off, barbearia.bookings,
                barbearia.notification_outbox to authenticated;
grant update (full_name, phone) on barbearia.profiles to authenticated;
grant insert, update, delete on barbearia.services, barbearia.professionals,
                barbearia.professional_services, barbearia.working_hours, barbearia.time_off to authenticated;
grant all on all tables in schema barbearia to service_role;

grant execute on function barbearia.available_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function barbearia.book_appointment(uuid, uuid, timestamptz, uuid) to authenticated;
grant execute on function barbearia.cancel_booking(uuid, text) to authenticated;
grant execute on function barbearia.set_booking_outcome(uuid, barbearia.booking_status) to authenticated;
grant execute on function barbearia.dashboard_metrics(timestamptz, timestamptz) to authenticated;
-- As políticas chamam estas funções, inclusive para visitantes anônimos no catálogo.
grant execute on function barbearia.my_shop(), barbearia.is_admin_of(uuid),
                          barbearia.is_professional_self(uuid) to anon, authenticated;
grant execute on function barbearia.is_valid_timezone(text) to authenticated, service_role;
grant execute on function barbearia.claim_outbox(int), barbearia.finish_outbox(bigint, text, text, text) to service_role;

alter table barbearia.shops                 enable row level security;
alter table barbearia.profiles              enable row level security;
alter table barbearia.professionals         enable row level security;
alter table barbearia.services              enable row level security;
alter table barbearia.professional_services enable row level security;
alter table barbearia.working_hours         enable row level security;
alter table barbearia.time_off              enable row level security;
alter table barbearia.bookings              enable row level security;
alter table barbearia.notification_outbox   enable row level security;

-- Catálogo público (permite ver serviços antes do login).
create policy "catálogo: barbearias" on barbearia.shops for select using (true);
create policy "catálogo: serviços ativos" on barbearia.services for select
  using (active or barbearia.is_admin_of(shop_id));
create policy "catálogo: profissionais ativos" on barbearia.professionals for select
  using (active or barbearia.is_admin_of(shop_id));
create policy "catálogo: serviços por profissional" on barbearia.professional_services for select using (true);
create policy "catálogo: expediente" on barbearia.working_hours for select using (true);

-- Perfis: o próprio, o admin da barbearia e o profissional que atende o cliente.
create policy "perfis: leitura" on barbearia.profiles for select to authenticated using (
  id = auth.uid()
  or barbearia.is_admin_of(shop_id)
  or exists (select 1 from barbearia.bookings b
             where b.client_id = profiles.id and b.professional_id = auth.uid())
  or (shop_id = barbearia.my_shop()
      and exists (select 1 from barbearia.professionals p where p.id = profiles.id))
);
create policy "perfis: edita o próprio" on barbearia.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Gestão: só admin da própria barbearia.
create policy "admin: serviços" on barbearia.services for all to authenticated
  using (barbearia.is_admin_of(shop_id)) with check (barbearia.is_admin_of(shop_id));
create policy "admin: profissionais" on barbearia.professionals for all to authenticated
  using (barbearia.is_admin_of(shop_id)) with check (barbearia.is_admin_of(shop_id));
create policy "admin: serviços por profissional" on barbearia.professional_services for all to authenticated
  using (exists (select 1 from barbearia.professionals p
                 where p.id = professional_id and barbearia.is_admin_of(p.shop_id)))
  with check (exists (select 1 from barbearia.professionals p join barbearia.services s on s.shop_id = p.shop_id
                      where p.id = professional_id and s.id = service_id and barbearia.is_admin_of(p.shop_id)));

-- Expediente e bloqueios: admin ou o próprio profissional.
create policy "agenda: expediente (escrita)" on barbearia.working_hours for all to authenticated
  using (barbearia.is_professional_self(professional_id)
         or exists (select 1 from barbearia.professionals p where p.id = professional_id and barbearia.is_admin_of(p.shop_id)))
  with check (barbearia.is_professional_self(professional_id)
         or exists (select 1 from barbearia.professionals p where p.id = professional_id and barbearia.is_admin_of(p.shop_id)));
create policy "agenda: bloqueios" on barbearia.time_off for all to authenticated
  using (barbearia.is_professional_self(professional_id)
         or exists (select 1 from barbearia.professionals p where p.id = professional_id and barbearia.is_admin_of(p.shop_id)))
  with check (barbearia.is_professional_self(professional_id)
         or exists (select 1 from barbearia.professionals p where p.id = professional_id and barbearia.is_admin_of(p.shop_id)));

-- Agendamentos: leitura restrita; escrita somente pelas funções acima.
create policy "agendamentos: leitura" on barbearia.bookings for select to authenticated using (
  client_id = auth.uid()
  or professional_id = auth.uid()
  or barbearia.is_admin_of(shop_id)
);

-- Caixa de saída visível para quem enxerga o agendamento (demonstra os e-mails na demo pública).
create policy "e-mails: leitura" on barbearia.notification_outbox for select to authenticated using (
  exists (select 1 from barbearia.bookings b where b.id = booking_id)
);
