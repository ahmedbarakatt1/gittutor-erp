import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('includes application directories during Vercel traversal while pruning private inputs', async () => {
  const require = createRequire(import.meta.url);
  const ignore = createRequire(require.resolve('eslint/package.json'))('ignore') as () => {add(text:string): {ignores(path:string):boolean}};
  const root = resolve('.');
  const rules = ignore().add(await readFile('.vercelignore','utf8'));
  expect(rules.ignores('deploy/vercel-scanner/.env.production')).toBe(true);
  const included: string[] = [];
  async function walk(directory:string) {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const absolute=join(directory,entry.name), local=relative(root,absolute);
      // Vercel tests directory names without a trailing slash before descending.
      if(rules.ignores(local)) continue;
      if(entry.isDirectory()) await walk(absolute);
      else if(entry.isFile()) included.push(local.replaceAll('\\','/'));
    }
  }
  await walk(root);
  expect(included).toEqual(expect.arrayContaining(['src/app/page.tsx','src/worker/index.ts','public/brand/git-tutor-instagram.jpg','contracts/runtime/supabase-root-2021.crt']));
  expect(included.filter(path=>path.startsWith('deploy/')).sort()).toEqual([
    'deploy/vercel-scanner/Dockerfile','deploy/vercel-scanner/clamd.conf','deploy/vercel-scanner/freshclam.conf','deploy/vercel-scanner/supervise.mjs',
  ]);
  expect(included.filter(path=>/^(?:\.local\/|\.env|tests\/|fixtures\/|tools\/|\.git\/|contracts\/(?!runtime\/))/.test(path))).toEqual([]);
  expect(included.filter(path=>/\.(?:xlsx|csv|log|dump)$/.test(path))).toEqual([]);
});

it('keeps the larger private scanner opt-in and confines its ClamD listener to the worker', async () => {
  const json = async (path:string) => JSON.parse(await readFile(path,'utf8'));
  expect((await json('vercel.json')).daemons).toBeUndefined();
  const config = (await json('deploy/vercel-private-scanner.example.json')).daemons['git-tutor-worker'];
  expect(config).toMatchObject({ entrypoint:'deploy/vercel-scanner/Dockerfile',instances:{fra1:0},resources:{requests:{memory:'8Gi'}} });
  expect((await json('deploy/vercel-daemon.example.json')).daemons['git-tutor-worker'].resources.requests.memory).toBe('1Gi');
  expect((await readFile('deploy/vercel-scanner/clamd.conf','utf8')).match(/^TCPAddr .+$/gm)).toEqual(['TCPAddr 127.0.0.1']);
});
