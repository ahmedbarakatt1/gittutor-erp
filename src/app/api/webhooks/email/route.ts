import {NextRequest,NextResponse} from 'next/server';
import {parseServerConfig} from '@/server/config';
import {verifyEmailCallback} from '@/server/email-callback';
import {createDatabasePool,databaseUrl} from '@/server/database';
export const runtime='nodejs';
let pool:ReturnType<typeof createDatabasePool>|undefined;
export async function POST(request:NextRequest){try{
 const config=parseServerConfig(process.env);if(config.providers.email!=='ses'||!config.email)return NextResponse.json({code:'NOT_CONFIGURED'},{status:503});
 const reader=request.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let size=0;for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>65536){await reader.cancel();throw new Error();}chunks.push(item.value);}
 const message=await verifyEmailCallback(JSON.parse(Buffer.concat(chunks).toString('utf8')),config.email);
 if(message.kind==='subscription')return NextResponse.json({state:'operator_confirmation_required'},{status:202});
 if(message.kind==='observation'){pool??=createDatabasePool(databaseUrl('worker'));await pool.query('select app_private.record_email_callback($1,$2,$3,$4,$5)',[message.attempt_id,message.provider_message_id,message.callback_id,message.outcome,message.observed_at]);}
 return NextResponse.json({received:true},{headers:{'Cache-Control':'no-store'}});
 }catch{return NextResponse.json({code:'CALLBACK_REJECTED'},{status:400,headers:{'Cache-Control':'no-store'}});}}
