-- Agendamento da fila de e-mails (executar UMA vez no SQL Editor do Supabase, após o deploy).
-- Não é migração porque depende de segredos e da URL do deploy. Requer as extensões
-- pg_cron e pg_net (Database → Extensions).

-- 1) Guarde a URL e o segredo no Vault (substitua os valores):
select vault.create_secret('https://SEU-APP.vercel.app/api/cron/emails', 'barbearia_cron_url');
select vault.create_secret('MESMO-VALOR-DO-CRON_SECRET', 'barbearia_cron_secret');

-- 2) A cada 5 minutos, chama a rota que processa a fila (lembretes 24 h, confirmações, cancelamentos):
select cron.schedule(
  'barbearia-emails',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'barbearia_cron_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barbearia_cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $$
);

-- Conferir execuções: select * from cron.job_run_details order by start_time desc limit 10;
-- Remover: select cron.unschedule('barbearia-emails');
