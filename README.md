# Navalha de Ouro — agendamento online para barbearias

> Projeto de portfólio com **dados fictícios**, desenvolvido com assistência de IA (Claude Code).
> Não há clientes, barbearias ou agendamentos reais.

**Demonstração:** [navalha-de-ouro-agendamento.vercel.app](https://navalha-de-ouro-agendamento.vercel.app) (contas de demonstração em configuração) · **Status do CI:** ver aba Actions

<!-- Screenshots reais serão adicionadas após o deploy (docs/screenshots/). -->

## O problema

Barbearias pequenas costumam agendar por mensagens e caderno. Isso gera horários duplicados,
faltas sem aviso e nenhuma visão do faturamento. O cliente não sabe quais horários estão livres
sem perguntar.

**Público:** clientes que querem marcar sozinhos, barbeiros que precisam ver e bloquear a própria
agenda e o gerente que acompanha a operação.

## Funcionalidades

| Perfil | O que faz |
|---|---|
| Cliente | Cadastro/login, agendamento em etapas (serviço → profissional → dia → horário), cancelamento e reagendamento até 2 h antes, histórico, e-mails recebidos |
| Profissional | Agenda semanal, expediente por dia da semana, bloqueios (folga, almoço), registro de “concluído” / “não compareceu” |
| Gerente | Tudo do profissional para toda a equipe, indicadores (agendamentos, taxa de cancelamento, faturamento previsto e realizado), cadastro de serviços com preço e duração |

E-mails de **confirmação**, **lembrete 24 h antes** e **cancelamento**, sem duplicidade.

### Contas de demonstração (permissões limitadas à barbearia fictícia)

| Perfil | E-mail | Senha |
|---|---|---|
| Cliente | `cliente@demo.test` | `demo12345` |
| Barbeiro | `barbeiro@demo.test` | `demo12345` |
| Gerente | `gerente@demo.test` | `demo12345` |

Os dados e as senhas são redefinidos diariamente (workflow `Redefinir demonstração`).

## Decisões técnicas

### 1. Reservas simultâneas: o banco decide
Duas pessoas clicando no mesmo horário ao mesmo tempo é uma condição de corrida clássica.
Verificar na aplicação (“está livre?” → “insere”) não resolve, porque as duas verificações podem
passar antes de qualquer inserção. A solução é uma **restrição de exclusão** no PostgreSQL:

```sql
constraint bookings_no_overlap
  exclude using gist (professional_id with =, period with &&)
  where (status <> 'cancelled')
```

`period` é um `tstzrange` semiaberto `[início, fim)`. O Postgres garante que nenhum par de
agendamentos ativos do mesmo profissional se sobreponha; a segunda transação recebe o erro
`23P01`, traduzido para “Este horário acabou de ficar indisponível”.
Verificado por `pnpm test:concorrencia` (N sessões reservando o mesmo horário → exatamente 1 sucesso).

### 2. Fuso horário
Tudo é gravado em UTC (`timestamptz`). O expediente é guardado em hora local (`time` + dia da
semana) e convertido **no banco**, na data consultada, com o fuso da barbearia
(`(data + hora) at time zone 'America/Sao_Paulo'`). Assim, mudanças de horário de verão são
respeitadas e o fuso do servidor ou do navegador não interfere. A interface exibe sempre no fuso da
barbearia, com testes cobrindo datas perto da meia-noite.

### 3. Lembretes sem duplicidade
Fila `notification_outbox` (padrão *transactional outbox*):
- `unique (booking_id, kind)` → cada agendamento tem no máximo um e-mail de cada tipo;
- o envio reivindica itens com `FOR UPDATE SKIP LOCKED` → execuções paralelas não pegam o mesmo item;
- `Idempotency-Key` no Resend → reprocessar após falha parcial não reenvia;
- lembrete de agendamento cancelado é descartado antes do envio.

O agendador é o **pg_cron + pg_net** do Supabase (a cada 5 min), porque o cron do plano gratuito da
Vercel roda no máximo uma vez por dia.

### 4. Regras e permissões no banco
- **RLS** em todas as tabelas: cliente vê só os próprios agendamentos; profissional, só a própria
  agenda; gerente, a barbearia inteira.
- Clientes **não** inserem nem alteram agendamentos diretamente: só via funções
  (`book_appointment`, `cancel_booking`) que aplicam disponibilidade, prazos e permissões numa transação.
- O papel do usuário nunca vem do cadastro: o trigger sempre cria perfil de **cliente**.
- Preço é **congelado** na reserva (mudar o preço do serviço não altera agendamentos feitos).
- Valores monetários em **centavos inteiros**.

### 5. Infraestrutura compartilhada
O plano gratuito do Supabase permite 2 projetos ativos, e o portfólio tem 6 aplicações. Este app
usa o schema **`barbearia`** num projeto Supabase compartilhado com outras demos. O isolamento é
explícito: perfis próprios por schema, políticas que exigem perfil **neste** app, migrações
separadas e um teste automatizado garantindo que um usuário de outro app não enxerga nada daqui.

## Design

Identidade visual baseada no sistema `luxury` do [open-design](https://github.com/nexu-io/open-design)
(licença Apache-2.0): preto laqueado e dourado, títulos em serifa didone (Playfair Display). Os tokens foram adaptados em `src/app/globals.css`, com
tons de texto ajustados para contraste AA (WCAG 4,5:1) e a cor da marca separada em preenchimento
(botões) e texto (links e foco). Cada app do portfólio usa um sistema diferente.

## Arquitetura

```
Navegador ──► Next.js 16 (App Router, Server Components, Server Actions) ──► Supabase
                 │  proxy.ts renova a sessão                                   ├─ Auth
                 │  validação com Zod                                          ├─ Postgres (schema barbearia, RLS, funções)
                 └─ /api/cron/emails ◄── pg_cron + pg_net (a cada 5 min)      └─ Vault (segredo do cron)
                         └──► Resend (e-mail)          Sentry (erros, sem dados pessoais)
```

**Tecnologias:** Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth,
RLS, pg_cron) · Zod · Resend · Sentry · Vitest · PGlite · GitHub Actions · Vercel.

## Como executar

Requisitos: Node 20.9+ (recomendado 24), pnpm, um projeto Supabase.

```bash
pnpm install
cp .env.example .env.local   # preencha com as chaves do seu projeto
```

1. No Supabase: **Project Settings → API → Exposed schemas**, adicione `barbearia`.
2. Aplique as migrações de `supabase/migrations/` (SQL Editor ou `supabase db push`) e depois `supabase/seed.sql`.
3. Crie as contas e os dados de demonstração: `pnpm seed:demo`
4. `pnpm dev` e acesse http://localhost:3000
5. (Opcional) Lembretes automáticos: execute `supabase/cron.sql` após o deploy.

## Testes

```bash
pnpm test              # regras de negócio + banco (PGlite) — não precisa de Docker
pnpm test:concorrencia # reservas simultâneas contra um Supabase real
pnpm lint && pnpm typecheck && pnpm build
```

Os testes de banco aplicam as migrações reais num **PGlite** (Postgres em WebAssembly) com um stub
mínimo do Supabase (`auth.users`, `auth.uid()`, papéis `anon`/`authenticated`/`service_role`). Eles
cobrem: sobreposição, fuso, bloqueios, prazos de cancelamento, reagendamento atômico, RLS,
isolamento entre apps, fila de e-mails e redefinição da demo.
O teste de concorrência roda contra o Supabase real porque o PGlite tem uma única conexão.

## Limitações conhecidas

- **E-mails:** sem domínio verificado, o Resend só entrega ao e-mail do dono da conta. Na demo, o
  conteúdo de cada mensagem aparece em **E-mails** no app.
- Pagamento não faz parte do escopo (valor pago na barbearia).
- Uma barbearia por instalação (o modelo de dados já suporta várias via `shop_id`).
- O projeto Supabase gratuito pausa após 7 dias sem uso.
- Os tipos do banco não são gerados automaticamente (próximo passo: `supabase gen types`).

## Melhorias futuras

- Lista de espera quando o dia está lotado.
- Lembrete por WhatsApp.
- Testes de ponta a ponta com Playwright no CI.
- Política de faltas (bloquear reservas após N “não compareceu”).

## Guia de estudo

Veja [docs/guia-de-estudo.md](docs/guia-de-estudo.md) para revisar o projeto e explicar suas decisões
em entrevistas.

## Transparência sobre o uso de IA

O código, os testes e a documentação foram produzidos com assistência do Claude Code (Anthropic),
sob minha direção e revisão. As decisões estão registradas neste README e no histórico de commits.
