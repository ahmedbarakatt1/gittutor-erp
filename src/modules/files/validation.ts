import { createHash } from 'node:crypto';
import { crc32,inflateRawSync } from 'node:zlib';
import { FileRpcError,fileFilenameSchema,type PublicFilePurpose } from './commands';
export type FileDeclaration={purpose:PublicFilePurpose;filename:string;declared_type:string;size_bytes:number;checksum_sha256:string};
const pptx='application/vnd.openxmlformats-officedocument.presentationml.presentation';
export const fileLimits={receiptBytes:5242880,materialBytes:26214400,archiveEntries:2000,archiveExpandedBytes:104857600,archiveEntryBytes:20971520}as const;
function invalid(code:string):never{throw new FileRpcError(code);}
/** ZIP central-directory inspection with actual bounded inflate; no extraction to disk. */
function validatePresentation(bytes:Buffer){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)invalid('FILE_ARCHIVE_INVALID');
 const count=bytes.readUInt16LE(end+10),size=bytes.readUInt32LE(end+12),start=bytes.readUInt32LE(end+16);
 if(!count||count>fileLimits.archiveEntries||start+size!==end||bytes.readUInt16LE(end+8)!==count)invalid('FILE_ARCHIVE_INVALID');
 let offset=start,total=0;const names=new Set<string>();
 for(let i=0;i<count;i++){
  if(offset+46>end||bytes.readUInt32LE(offset)!==0x02014b50)invalid('FILE_ARCHIVE_INVALID');
  const flags=bytes.readUInt16LE(offset+8),method=bytes.readUInt16LE(offset+10),compressed=bytes.readUInt32LE(offset+20),expanded=bytes.readUInt32LE(offset+24),n=bytes.readUInt16LE(offset+28),extra=bytes.readUInt16LE(offset+30),comment=bytes.readUInt16LE(offset+32),local=bytes.readUInt32LE(offset+42);
  const name=bytes.subarray(offset+46,offset+46+n).toString('utf8');total+=expanded;
  if(flags&1||![0,8].includes(method)||expanded>fileLimits.archiveEntryBytes||total>fileLimits.archiveExpandedBytes||compressed===0&&expanded>0||expanded>Math.max(1,compressed)*200||!n||/\\|(^|\/)\.\.?($|\/)|^[\/]|:|\x00/.test(name)||names.has(name)||/vbaProject|\.bin$|macros/i.test(name)||offset+46+n+extra+comment>end||local+30>start||bytes.readUInt32LE(local)!==0x04034b50)invalid('FILE_ARCHIVE_INVALID');
  names.add(name);const ln=bytes.readUInt16LE(local+26),le=bytes.readUInt16LE(local+28),data=local+30+ln+le;
  if(bytes.subarray(local+30,local+30+ln).toString('utf8')!==name||bytes.readUInt16LE(local+8)!==method||bytes.readUInt16LE(local+6)&1||data+compressed>start)invalid('FILE_ARCHIVE_INVALID');
  let unpacked:Buffer;try{unpacked=method===0?bytes.subarray(data,data+compressed):inflateRawSync(bytes.subarray(data,data+compressed),{maxOutputLength:fileLimits.archiveEntryBytes});}catch{invalid('FILE_ARCHIVE_INVALID');}
  if(unpacked.length!==expanded||crc32(unpacked)!==bytes.readUInt32LE(offset+16))invalid('FILE_ARCHIVE_INVALID');
  if(/\.rels$/i.test(name)&&(/TargetMode\s*=\s*["']External["']/i.test(unpacked.toString('utf8'))||/<!DOCTYPE|<!ENTITY/i.test(unpacked.toString('utf8'))))invalid('FILE_ARCHIVE_INVALID');
  offset+=46+n+extra+comment;
 }
 if(offset!==end||!names.has('[Content_Types].xml')||!names.has('ppt/presentation.xml')||!names.has('_rels/.rels'))invalid('FILE_ARCHIVE_INVALID');
}
export function validateFileBytes(declaration:FileDeclaration,value:Uint8Array){
 if(!fileFilenameSchema.safeParse(declaration.filename).success)invalid('VALIDATION_ERROR');
 const bytes=Buffer.from(value),max=['receipt','review_evidence'].includes(declaration.purpose)?fileLimits.receiptBytes:fileLimits.materialBytes;
 if(bytes.length>max||declaration.size_bytes>max)invalid('FILE_TOO_LARGE');if(bytes.length<1||bytes.length!==declaration.size_bytes)invalid('FILE_SIZE_MISMATCH');
 const hash=createHash('sha256').update(bytes).digest('hex');if(hash!==declaration.checksum_sha256)invalid('FILE_CHECKSUM_MISMATCH');
 let detected:string|null=null;
 if(bytes.subarray(0,5).toString('ascii')==='%PDF-'&&bytes.subarray(Math.max(0,bytes.length-1024)).includes(Buffer.from('%%EOF')))detected='application/pdf';
 else if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(12,16).toString('ascii')==='IHDR')detected='image/png';
 else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217)detected='image/jpeg';
 else if(bytes.length>=16&&bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length)detected='image/webp';
 else if(bytes.length>=4&&bytes.readUInt32LE(0)===0x04034b50){validatePresentation(bytes);detected=pptx;}
 else if(declaration.purpose==='statement_evidence'&&declaration.declared_type==='text/csv'){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!text.includes('\0')&&!/<(?:html|script|!doctype)/i.test(text))detected='text/csv';}catch{/* invalid UTF8 is not CSV */}}
 const allowed=declaration.purpose==='statement_evidence'?['application/pdf','text/csv']:['application/pdf','image/png','image/jpeg','image/webp',...(['private_preparation','shared_handout','request_material'].includes(declaration.purpose)?[pptx]:[])];
 if(!detected||detected!==declaration.declared_type||!allowed.includes(detected))invalid('FILE_TYPE_INVALID');
 return{size_bytes:bytes.length,checksum_sha256:hash,detected_type:detected};
}
