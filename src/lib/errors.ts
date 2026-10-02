// Traduz erros do banco (códigos lançados pelas funções SQL) em mensagens para o usuário.
// Detalhes técnicos nunca chegam à interface.

const MESSAGES: Record<string, string> = {
  HORARIO_INDISPONIVEL:
    "Este horário acabou de ficar indisponível. Escolha outro horário — a lista foi atualizada.",
  PRAZO_CANCELAMENTO_EXPIRADO:
    "Cancelamentos e reagendamentos pelo app são permitidos até 2 horas antes do horário. Entre em contato com a barbearia.",
  AGENDAMENTO_INEXISTENTE: "Agendamento não encontrado.",
  AGENDAMENTO_NAO_CANCELAVEL: "Este agendamento já foi cancelado ou concluído.",
  SERVICO_INVALIDO: "Serviço indisponível. Escolha outro serviço.",
  PERFIL_INEXISTENTE: "Sua conta ainda não está vinculada a esta barbearia.",
  NAO_AUTENTICADO: "Sua sessão expirou. Entre novamente.",
  SEM_PERMISSAO: "Você não tem permissão para esta ação.",
  DESFECHO_NAO_PERMITIDO: "Só é possível registrar o desfecho depois do horário do atendimento.",
  STATUS_INVALIDO: "Status inválido.",
  INTERVALO_INVALIDO: "O horário final precisa ser depois do inicial.",
};

export const GENERIC_ERROR = "Não foi possível concluir a ação. Tente novamente em instantes.";

export function friendlyDbError(error: { message?: string; code?: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  const key = Object.keys(MESSAGES).find((k) => error.message?.includes(k));
  if (key) return MESSAGES[key];
  if (error.code === "42501") return MESSAGES.SEM_PERMISSAO;
  return GENERIC_ERROR;
}

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_not_confirmed: "Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.",
  user_already_exists: "Já existe uma conta com este e-mail.",
  weak_password: "Senha fraca. Use ao menos 8 caracteres, com letras e números.",
  over_request_rate_limit: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
  over_email_send_rate_limit: "Muitos e-mails enviados. Aguarde alguns minutos e tente novamente.",
};

export function friendlyAuthError(error: { code?: string; message?: string } | null | undefined): string {
  if (!error) return GENERIC_ERROR;
  return (error.code && AUTH_MESSAGES[error.code]) || GENERIC_ERROR;
}
