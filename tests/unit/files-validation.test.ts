import { createHash } from 'node:crypto';
import { expect,test } from 'vitest';
import { crc32 } from 'node:zlib';
import { validateFileBytes } from '../../src/modules/files/validation';
const bytes=Buffer.from('%PDF-1.4\n% Synthetic\n%%EOF\n');
const declaration={purpose:'receipt' as const,filename:'proof.pdf',declared_type:'application/pdf',size_bytes:bytes.length,checksum_sha256:createHash('sha256').update(bytes).digest('hex')};
test('actual PDF bytes match bounded immutable declaration',()=>{expect(validateFileBytes(declaration,bytes)).toEqual({size_bytes:bytes.length,checksum_sha256:declaration.checksum_sha256,detected_type:'application/pdf'});});
test('declared MIME cannot turn active HTML into a PDF',()=>{const html=Buffer.from('<script>alert(1)</script>');expect(()=>validateFileBytes({...declaration,size_bytes:html.length,checksum_sha256:createHash('sha256').update(html).digest('hex')},html)).toThrow('FILE_TYPE_INVALID');});
test('hash, size, filename and purpose limits are checked',()=>{expect(()=>validateFileBytes({...declaration,checksum_sha256:'0'.repeat(64)},bytes)).toThrow('FILE_CHECKSUM_MISMATCH');expect(()=>validateFileBytes({...declaration,size_bytes:1},bytes)).toThrow('FILE_SIZE_MISMATCH');expect(()=>validateFileBytes({...declaration,filename:'../proof.pdf'},bytes)).toThrow('VALIDATION_ERROR');expect(()=>validateFileBytes({...declaration,size_bytes:5*1024*1024+1},Buffer.alloc(5*1024*1024+1))).toThrow('FILE_TOO_LARGE');});
function zip(entries:Record<string,string>){const local:Buffer[]=[],central:Buffer[]=[];let offset=0;for(const[name,text]of Object.entries(entries)){const n=Buffer.from(name),data=Buffer.from(text),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt32LE(crc32(data),14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt32LE(crc32(data),16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);local.push(h,n,data);central.push(c,n);offset+=h.length+n.length+data.length;}const dir=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(Object.keys(entries).length,8);end.writeUInt16LE(Object.keys(entries).length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,dir,end]);}
const presentation={'[Content_Types].xml':'<Types/>','ppt/presentation.xml':'<presentation/>','_rels/.rels':'<Relationships/>'};
function pptx(data:Buffer){return validateFileBytes({...declaration,purpose:'shared_handout',filename:'slides.pptx',declared_type:'application/vnd.openxmlformats-officedocument.presentationml.presentation',size_bytes:data.length,checksum_sha256:createHash('sha256').update(data).digest('hex')},data);}
test('bounded PPTX central directory and actual CRC/inflate are checked before scanner',()=>{expect(pptx(zip(presentation)).detected_type).toContain('presentationml');const malicious:Record<string,string>[]=[{'../escape.xml':'x'},{'ppt/vbaProject.bin':'x'},{'ppt/_rels/slides.rels':'<Relationship TargetMode="External" Target="https://example.test"/>'}];for(const extra of malicious)expect(()=>pptx(zip({...presentation,...extra}))).toThrow('FILE_ARCHIVE_INVALID');const corrupt=zip(presentation);corrupt[31+'[Content_Types].xml'.length]^=1;expect(()=>pptx(corrupt)).toThrow('FILE_ARCHIVE_INVALID');});

test('request materials can include a validated lecture presentation', () => {
  const slides = zip(presentation);
  expect(validateFileBytes({
    purpose: 'request_material', filename: 'lecture.pptx',
    declared_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    size_bytes: slides.length, checksum_sha256: createHash('sha256').update(slides).digest('hex'),
  }, slides).detected_type).toContain('presentationml');
});
