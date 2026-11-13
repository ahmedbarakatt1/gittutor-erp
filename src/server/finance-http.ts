import type {IdentityRpcClient} from '../modules/identity/commands';
import {financeCommands,getFinanceSummary,listFinanceEntries,listExpenses,listFinanceCashAccounts,listCashReconciliations,listCashReconciliationSources,listTutorObligations,listTutorObligationEntries} from '../modules/analytics/finance';
type Route={family:'finance';pattern:RegExp;rpc:keyof typeof financeCommands;fields:string[];pathArgument?:string};
export const financeCommandRoutes:Route[]=[
 {family:'finance',pattern:/^expenses$/,rpc:'record_expense',fields:['category','amount_minor','currency','incurred_at','description','evidence_file_id']},
 {family:'finance',pattern:/^expenses\/([^/]+)\/settlements$/,rpc:'record_expense_settlement',pathArgument:'expense_id',fields:['amount_minor','receiving_account_id','external_reference','settled_at','evidence_file_id','expected_version']},
 {family:'finance',pattern:/^finance\/cash-reconciliations$/,rpc:'record_cash_reconciliation',fields:['receiving_account_id','observed_balance_minor','balance_at','evidence_file_id','reason']},
 {family:'finance',pattern:/^finance\/cash-reconciliations\/([^/]+)\/resolve$/,rpc:'resolve_cash_reconciliation',pathArgument:'reconciliation_id',fields:['correction_transaction_ids','evidence_file_id','reason','expected_version']},
];
const prefixed=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).map(([key,value])=>[`p_${key}`,value]));
export function findFinanceReadRoute(path:string):{fields:string[];run:(client:IdentityRpcClient,options:Record<string,unknown>)=>Promise<unknown>}|undefined{
 if(path==='finance/summary')return{fields:['from','to','as_of'],run:(client,options)=>getFinanceSummary(client,prefixed(options))};
 if(path==='finance/entries')return{fields:['from','to','as_of','account_codes','cursor','limit'],run:(client,options)=>listFinanceEntries(client,{...prefixed(options),p_account_codes:typeof options.account_codes==='string'?options.account_codes.split(','):[]})};
 if(path==='expenses')return{fields:['cursor','limit'],run:(client,options)=>listExpenses(client,prefixed(options))};
 if(path==='finance/cash-accounts')return{fields:[],run:client=>listFinanceCashAccounts(client)};
 if(path==='finance/cash-reconciliations')return{fields:['receiving_account_id','state','cursor','limit'],run:(client,options)=>listCashReconciliations(client,prefixed(options))};
 const cashSources=path.match(/^finance\/cash-reconciliations\/([^/]+)\/sources$/);if(cashSources)return{fields:['cursor','limit'],run:(client,options)=>listCashReconciliationSources(client,{...prefixed(options),p_reconciliation_id:cashSources[1]})};
 if(path==='finance/tutor-obligations')return{fields:['from','to','as_of','tutor_id','side','cursor','limit'],run:(client,options)=>listTutorObligations(client,prefixed(options))};
 const tutorEntries=path.match(/^finance\/tutor-obligations\/([^/]+)\/entries$/);if(tutorEntries)return{fields:['from','to','as_of','cursor','limit'],run:(client,options)=>listTutorObligationEntries(client,{...prefixed(options),p_tutor_id:tutorEntries[1]})};
}
