import {z} from 'zod';
import type {IdentityRpcClient} from '../identity/commands';
import {paymentRpc} from '../payments/commands';
const financeRpc=async(...args:Parameters<typeof paymentRpc>)=>(await paymentRpc(...args)).data;
const id=z.uuid(),version=z.number().int().positive(),instant=z.iso.datetime({offset:true}),signed=z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),positive=signed.positive(),currency=z.literal('EGP'),key=z.string().min(1).max(200),reason=z.string().trim().min(1).max(2000),common=z.object({command_id:id,resource_id:id,version});
export const expenseCategory=z.enum(['teaching','marketing','software','rent','administration','other']);
export const financeAccountCodes=['channel_cash','receivable','unapplied_customer_funds','deferred_tuition','deferred_package_obligation','deferred_cancellation_obligation','tuition_revenue','tutor_expense','tutor_payable','operating_expense','expense_payable','promotional_subsidy_expense'] as const;
const accountCode=z.enum(financeAccountCodes);
export const financeCommands={
 record_expense:{input:z.object({p_category:expenseCategory,p_amount_minor:positive,p_currency:currency,p_incurred_at:instant,p_description:reason,p_evidence_file_id:id,p_idempotency_key:key}).strict(),output:common.extend({expense_id:id,payable_minor:signed}).strict()},
 record_expense_settlement:{input:z.object({p_expense_id:id,p_amount_minor:positive,p_receiving_account_id:id,p_external_reference:z.string().trim().min(1).max(200),p_settled_at:instant,p_evidence_file_id:id,p_expected_version:version,p_idempotency_key:key}).strict(),output:common.extend({settlement_id:id,remaining_payable_minor:signed}).strict()},
 record_cash_reconciliation:{input:z.object({p_receiving_account_id:id,p_observed_balance_minor:signed,p_balance_at:instant,p_evidence_file_id:id,p_reason:reason,p_idempotency_key:key}).strict(),output:common.extend({reconciliation_id:id,ledger_balance_minor:signed,difference_minor:signed,state:z.enum(['matched','difference'])}).strict()},
};
export async function invokeFinanceCommand(client:IdentityRpcClient,name:keyof typeof financeCommands,input:unknown){const command=financeCommands[name];return{data:command.output.parse(await financeRpc(client,name,command.input.parse(input))),status:200};}
const range=z.object({p_from:z.iso.date(),p_to:z.iso.date(),p_as_of:instant}).strict().refine(value=>value.p_from<=value.p_to);
const exactAmount=z.union([signed,z.string().regex(/^-?(?:0|[1-9]\d{0,99})$/)]);
const period=z.object({earned_revenue_minor:exactAmount,tutor_expense_minor:exactAmount,operating_expense_minor:exactAmount,promotional_subsidy_minor:exactAmount,operating_profit_minor:exactAmount,cash_inflow_minor:exactAmount,cash_outflow_minor:exactAmount,net_cash_movement_minor:exactAmount}).strict();
const balances=z.object({cash_minor:exactAmount,receivable_minor:exactAmount,customer_credit_minor:exactAmount,deferred_tuition_minor:exactAmount,package_obligation_minor:exactAmount,cancellation_obligation_minor:exactAmount,tutor_payable_minor:exactAmount,expense_payable_minor:exactAmount}).strict();
export const financeSummarySchema=z.object({from:z.iso.date(),to:z.iso.date(),as_of:instant,currency,time_zone:z.literal('Africa/Cairo'),grain:z.literal('ledger_line'),period,balances,ledger_balanced:z.boolean(),source_entry_count:z.number().int().nonnegative()}).strict();
export type FinanceSummary=z.infer<typeof financeSummarySchema>;
export const financeEntrySchema=z.object({line_id:id,transaction_id:id,source_type:z.string(),source_id:id,account_code:accountCode,signed_minor:signed,currency,effective_at:instant,recorded_at:instant,charge_id:id.nullable(),enrollment_id:id.nullable(),receiving_account_id:id.nullable()}).strict();
export type FinanceEntry=z.infer<typeof financeEntrySchema>;
const expenseSchema=z.object({expense_id:id,category:expenseCategory,amount_minor:positive,currency,incurred_at:instant,description:z.string(),evidence_file_id:id,paid_minor:signed,payable_minor:signed,state:z.enum(['unpaid','partially_paid','paid']),version,created_at:instant}).strict();
export type Expense=z.infer<typeof expenseSchema>;
const cashSchema=z.object({receiving_account_id:id,channel:z.enum(['instapay','vodafone_cash']),label:z.string(),enabled:z.boolean(),balance_minor:signed,last_reconciliation:z.object({reconciliation_id:id,balance_at:instant,observed_balance_minor:signed,ledger_balance_minor:signed,difference_minor:signed,state:z.enum(['matched','difference'])}).strict().nullable()}).strict();
export type FinanceCashAccount=z.infer<typeof cashSchema>;
const pagination=z.object({p_limit:z.number().int().min(1).max(100).default(25),p_cursor:id.nullable().default(null)});
export async function getFinanceSummary(client:IdentityRpcClient,input:unknown){return financeSummarySchema.parse(await financeRpc(client,'get_finance_summary',range.parse(input)));}
export async function listFinanceEntries(client:IdentityRpcClient,input:unknown){const args=range.safeExtend({...pagination.shape,p_account_codes:z.array(accountCode).max(12).default([])}).parse(input);return z.object({items:z.array(financeEntrySchema),next_cursor:id.nullable()}).strict().parse(await financeRpc(client,'list_finance_entries',args));}
export async function listExpenses(client:IdentityRpcClient,input:unknown={}){return z.object({items:z.array(expenseSchema),next_cursor:id.nullable()}).strict().parse(await financeRpc(client,'list_expenses',pagination.strict().parse(input)));}
export async function listFinanceCashAccounts(client:IdentityRpcClient){return z.object({items:z.array(cashSchema)}).strict().parse(await financeRpc(client,'list_finance_cash_accounts'));}
