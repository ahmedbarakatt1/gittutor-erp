export const exportSchemas={
 own_account:['learner_id','display_name','enrollment_id','occurrence_id','start_at','state','customer_charge_minor','allocated_cash_minor','balance_minor','currency'],
 own_tutor_statement:['earning_id','occurrence_id','source_type','earned_minor','adjustment_minor','net_earned_minor','settled_minor','reserved_minor','owed_minor','available_minor','currency','effective_at'],
 admin_customers:['learner_id','account_id','display_name','email','phone','archived','balance_minor','currency'],
 admin_sessions:['occurrence_id','title','start_at','end_at','state','format','tutor_id','learner_count','tuition_total_minor','tutor_fee_minor','currency'],
 admin_finance:['allocation_id','transfer_id','payer_account_id','charge_id','learner_id','enrollment_id','occurrence_id','amount_minor','reversed_minor','net_allocated_minor','currency','effective_at'],
}as const;
export type ExportKind=keyof typeof exportSchemas;
const numericColumn=(column:string)=>column.endsWith('_minor')||column==='learner_count';
/** Fixed-schema, trusted generated CSV. No arbitrary keys, formulas or raw provider content. */
export function encodeCsv(kind:ExportKind,columns:readonly string[],rows:readonly Record<string,unknown>[]){
 if(!Object.hasOwn(exportSchemas,kind)||!columns.length||new Set(columns).size!==columns.length||columns.some(c=>!(exportSchemas[kind]as readonly string[]).includes(c))||rows.length>10000)throw new Error('VALIDATION_ERROR');
 const quoted=(value:string)=>`"${value.replaceAll('"','""')}"`;
 const lines=[columns.map(quoted).join(',')];
 for(const row of rows){lines.push(columns.map(column=>{const value=row[column];if(value===null||value===undefined)return '""';if(numericColumn(column)){if(!(typeof value==='number'&&Number.isSafeInteger(value))&&!(typeof value==='string'&&/^-?(0|[1-9][0-9]{0,126})$/.test(value)))throw new Error('VALIDATION_ERROR');return quoted(String(value));}if(typeof value!=='string'&&typeof value!=='boolean')throw new Error('VALIDATION_ERROR');let text=String(value);if(text.length>4096)throw new Error('EXPORT_LIMIT_EXCEEDED');if(/^[\s\u0000-\u001f\u007f]*[=+\-@]/u.test(text)||/^[\t\r\n]/.test(text))text=`'${text}`;return quoted(text);}).join(','));}
 const csv=`\uFEFF${lines.join('\r\n')}\r\n`;if(new TextEncoder().encode(csv).byteLength>25*1024*1024)throw new Error('EXPORT_LIMIT_EXCEEDED');return csv;
}
