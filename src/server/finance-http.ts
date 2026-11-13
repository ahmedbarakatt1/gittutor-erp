import type {IdentityRpcClient} from '../modules/identity/commands';
import {financeCommands,getFinanceSummary,listFinanceEntries,listExpenses,listFinanceCashAccounts} from '../modules/analytics/finance';
type Route={family:'finance';pattern:RegExp;rpc:keyof typeof financeCommands;fields:string[];pathArgument?:string};
export const financeCommandRoutes:Route[]=[
 {family:'finance',pattern:/^expenses$/,rpc:'record_expense',fields:['category','amount_minor','currency','incurred_at','description','evidence_file_id']},
 {family:'finance',pattern:/^expenses\/([^/]+)\/settlements$/,rpc:'record_expense_settlement',pathArgument:'expense_id',fields:['amount_minor','receiving_account_id','external_reference','settled_at','evidence_file_id','expected_version']},
 {family:'finance',pattern:/^finance\/cash-reconciliations$/,rpc:'record_cash_reconciliation',fields:['receiving_account_id','observed_balance_minor','balance_at','evidence_file_id','reason']},
];
const prefixed=(input:Record<string,unknown>)=>Object.fromEntries(Object.entries(input).map(([key,value])=>[`p_${key}`,value]));
export function findFinanceReadRoute(path:string):{fields:string[];run:(client:IdentityRpcClient,options:Record<string,unknown>)=>Promise<unknown>}|undefined{
 if(path==='finance/summary')return{fields:['from','to','as_of'],run:(client,options)=>getFinanceSummary(client,prefixed(options))};
 if(path==='finance/entries')return{fields:['from','to','as_of','account_codes','cursor','limit'],run:(client,options)=>listFinanceEntries(client,{...prefixed(options),p_account_codes:typeof options.account_codes==='string'?options.account_codes.split(','):[]})};
 if(path==='expenses')return{fields:['cursor','limit'],run:(client,options)=>listExpenses(client,prefixed(options))};
 if(path==='finance/cash-accounts')return{fields:[],run:client=>listFinanceCashAccounts(client)};
}
