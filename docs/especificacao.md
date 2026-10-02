# Projeto 1 — Sistema de agendamento para barbearias

## Problema
Barbearias pequenas agendam por WhatsApp e caderno: horários duplicados, faltas sem aviso e
nenhuma visão do faturamento. O cliente não sabe quais horários estão livres sem perguntar.

## Público
- **Cliente**: agenda, cancela e reagenda sozinho.
- **Profissional (barbeiro)**: vê a própria agenda, cadastra bloqueios (folga, almoço).
- **Administrador (dono)**: gerencia serviços, profissionais, horários e acompanha indicadores.

## Regras de negócio
| Regra | Valor padrão (configurável por barbearia) |
|---|---|
| Fuso horário | Da barbearia (`America/Sao_Paulo`); tudo gravado em UTC |
| Antecedência mínima para agendar | 30 min |
| Janela máxima de agendamento | 30 dias |
| Granularidade dos horários oferecidos | 15 min |
| Cancelar/reagendar (cliente) | Até 2 h antes do início |
| Cancelar (admin/profissional) | A qualquer momento, com motivo |
| Lembrete | 24 h antes; enviado no máximo uma vez por agendamento |
| Preço | Copiado do serviço no momento da reserva (mudanças futuras não alteram reservas) |

- Um agendamento ocupa `[início, início + duração)` do profissional. Intervalos semiabertos:
  um serviço terminando às 10:00 não conflita com outro começando às 10:00.
- Agendamentos não cancelados bloqueiam a agenda. Cancelados liberam o horário.
- Reagendar = cancelar o antigo + criar o novo **na mesma transação**; se o novo horário falhar,
  o antigo permanece intacto.

## Critério essencial — concorrência
Restrição de exclusão no Postgres (`EXCLUDE USING gist (professional_id WITH =, period WITH &&)
WHERE status <> 'cancelled'`). Duas transações simultâneas no mesmo horário: o banco aceita uma e
rejeita a outra com erro `23P01`, que a aplicação traduz para "Este horário acabou de ser reservado".
A garantia não depende da aplicação verificar antes de inserir.

## Fuso horário
- Horários de trabalho guardados como hora local (`time`) + dia da semana; convertidos para UTC
  usando o fuso da barbearia **na data específica** (respeita eventuais mudanças de horário de verão).
- A interface sempre exibe no fuso da barbearia, com o fuso indicado.

## Lembretes sem duplicidade
Tabela `notification_outbox` com `unique (booking_id, kind)`. O agendador (pg_cron, a cada 5 min)
insere lembretes devidos com `on conflict do nothing`; o envio reivindica linhas com
`for update skip locked` e marca `sent_at`. Reexecuções e envios paralelos não duplicam e-mails.
Lembrete de agendamento cancelado é descartado antes do envio.

## Critérios de aceite
1. Cliente cria conta, escolhe serviço, profissional e horário livre e recebe confirmação.
2. Horários exibidos respeitam expediente, bloqueios, agendamentos existentes, antecedência e duração.
3. Teste automatizado com N requisições simultâneas ao mesmo horário resulta em exatamente 1 reserva.
4. Cliente não cancela a menos de 2 h; admin cancela a qualquer momento.
5. Reagendamento falho não perde o agendamento original.
6. Cliente vê apenas os próprios agendamentos; profissional vê só a própria agenda; admin vê todos.
   Verificado por testes de RLS.
7. Lembrete de 24 h enviado exatamente uma vez, mesmo com o job executado várias vezes.
8. Painel do admin: agendamentos do dia/semana, taxa de cancelamento, faturamento previsto e realizado.
9. Interface responsiva, navegável por teclado, com estados de carregamento, erro, sucesso e vazio.

## Fora do escopo
Pagamentos, múltiplas unidades por conta, notificações por WhatsApp/SMS.
