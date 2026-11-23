export function accountScope(account: { account_id: string; roles: string[]; authorized_learner_ids: string[] }) {
  return JSON.stringify([account.account_id, [...account.roles].sort(), [...account.authorized_learner_ids].sort()]);
}
