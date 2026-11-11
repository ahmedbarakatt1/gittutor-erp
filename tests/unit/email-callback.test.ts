import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSign,randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {verifyEmailCallback,snsStringToSign} from '../../src/server/email-callback';
const topic='arn:aws:sns:us-east-1:123456789012:synthetic-delivery';
test('SNS verification binds signed body, exact topic and fixed AWS certificate URL',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'git-tutor-sns-')),keyPath=join(directory,'synthetic.key'),certPath=join(directory,'synthetic.pem');
 const configPath=join(directory,'synthetic.cnf');await writeFile(configPath,'[req]\ndistinguished_name=dn\n[dn]\n');
 execFileSync('openssl',['req','-config',configPath,'-x509','-newkey','rsa:2048','-keyout',keyPath,'-out',certPath,'-sha256','-days','1','-nodes','-subj','/CN=synthetic.test'],{stdio:'ignore'});
 const key=await readFile(keyPath),cert=await readFile(certPath,'utf8'),attempt=randomUUID();
 const value={Type:'Notification' as const,MessageId:randomUUID(),TopicArn:topic,Message:JSON.stringify({eventType:'Delivery',mail:{messageId:'synthetic-provider-1',timestamp:new Date().toISOString(),tags:{git_tutor_attempt:[attempt]}}}),Timestamp:new Date().toISOString(),SignatureVersion:'2' as const,Signature:'',SigningCertURL:`https://sns.us-east-1.amazonaws.com/SimpleNotificationService-${randomUUID().replaceAll('-','')}.pem`};
 const signer=createSign('RSA-SHA256');signer.update(snsStringToSign(value));signer.end();value.Signature=signer.sign(key,'base64');
 const http=vi.fn(async()=>new Response(cert));expect(await verifyEmailCallback(value,{region:'us-east-1',topic_arn:topic},http)).toMatchObject({kind:'observation',attempt_id:attempt,outcome:'delivered',provider_message_id:'synthetic-provider-1'});expect(http).toHaveBeenCalledTimes(1);
 for(const change of [{Message:value.Message.replace('Delivery','Bounce')},{TopicArn:`${topic}-wrong`},{SigningCertURL:'https://attacker.example.test/cert.pem'},{SigningCertURL:'http://sns.us-east-1.amazonaws.com/SimpleNotificationService-A.pem'}])await expect(verifyEmailCallback({...value,...change},{region:'us-east-1',topic_arn:topic},http)).rejects.toThrow();
});
