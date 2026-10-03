# Guia de estudo — Navalha de Ouro

Roteiro para revisar o projeto e explicar as decisões com segurança. Leia o código indicado em
cada item; a explicação deve ser sua, nas suas palavras.

## 1. Pitch de 30 segundos
“É um sistema de agendamento para barbearias com três perfis. O ponto central é que duas pessoas
nunca conseguem reservar o mesmo horário, mesmo clicando ao mesmo tempo, porque a regra está no
banco, não só na aplicação. Também tratei fuso horário, prazos de cancelamento e lembretes por
e-mail sem duplicidade.”

## 2. Onde está cada coisa
| Assunto | Arquivo |
|---|---|
| Tabelas, regras, RLS | `supabase/migrations/20261001000000_barbearia_schema.sql` |
| Dados de demonstração | `supabase/migrations/20261002000000_barbearia_demo_reset.sql`, `scripts/seed-demo.ts` |
| Fluxo de agendamento | `src/app/agendar/page.tsx`, `src/app/agendar/actions.ts` |
| Sessão e proteção de rotas | `src/proxy.ts`, `src/lib/auth.ts` |
| Fila de e-mails | `src/lib/outbox.ts`, `src/app/api/cron/emails/route.ts` |
| Testes de banco | `tests/db/agendamento.test.ts`, `tests/db/harness.ts` |

## 3. Perguntas prováveis e o que mostrar

**“Como você evita reserva duplicada?”**
Restrição de exclusão (`EXCLUDE USING gist`) sobre `(professional_id, period)`. Explique por que
“verificar e depois inserir” falha sob concorrência (duas transações leem “livre” ao mesmo tempo) e
por que o banco resolve: ele serializa o conflito e a segunda recebe erro `23P01`. Mostre o teste
`scripts/concurrency-test.ts`.

**“Por que `tstzrange` com `[)`?”**
Intervalo semiaberto: um corte que termina às 10:00 não conflita com outro que começa às 10:00.
O operador `&&` (sobreposição) já trata isso corretamente.

**“Como trata fuso horário?”**
Armazena UTC; expediente em hora local; conversão no banco com o fuso da barbearia e a data
específica. Pergunta de acompanhamento comum: “e o horário de verão?” → por isso a conversão usa a
data, não um deslocamento fixo.

**“Como garante que o lembrete não vai duas vezes?”**
Três camadas: `unique(booking_id, kind)`, `FOR UPDATE SKIP LOCKED` e `Idempotency-Key`. Saiba dizer o
que cada uma protege (duplicar na fila / dois workers / reenvio após falha parcial).

**“Por que a regra de negócio está em funções SQL e não no Next.js?”**
Porque precisa ser atômica (reagendar = cancelar + reservar na mesma transação) e porque a API do
Supabase é acessível diretamente pelo navegador: qualquer regra só no front-end pode ser ignorada.
RLS + funções `security definer` com `search_path` vazio garantem a regra em qualquer caminho.
Contraponto honesto: lógica em SQL é mais difícil de testar e versionar — por isso os testes com PGlite.

**“O que é `security definer` e qual o risco?”**
A função roda com as permissões do dono, não do usuário. Risco: injeção via `search_path` e
exposição de dados. Mitigação: `set search_path = ''`, nomes qualificados, `revoke ... from public`
e validação de `auth.uid()` dentro da função.

**“Por que não usar o cron da Vercel?”**
O plano gratuito permite execução diária; lembretes precisam de minutos. O pg_cron do Supabase chama
uma rota protegida por segredo guardado no Vault.

**“Como as seis demos compartilham um banco?”**
Um schema por app, perfis próprios, políticas exigindo perfil naquele app e teste de isolamento.

## 4. Limitações que você deve assumir
E-mail só para o dono da conta Resend (sem domínio), sem pagamentos, uma barbearia por instalação,
tipos do banco escritos à mão. Saber dizer o próximo passo de cada uma mostra maturidade.

## 5. Exercícios para fixar
1. Rode `pnpm test` e quebre de propósito a restrição de exclusão (comente-a): quais testes falham?
2. Mude o prazo de cancelamento para 4 h em `shops.cancel_deadline` e ajuste o teste.
3. Explique em voz alta o caminho de um clique em “Confirmar agendamento” até o `insert`.
