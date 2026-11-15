import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('includes application directories during Vercel traversal while pruning private inputs', async () => {
  const require = createRequire(import.meta.url);
  const ignore = createRequire(require.resolve('eslint/package.json'))('ignore') as () => {add(text:string): {ignores(path:string):boolean}};
  const root = resolve('.');
  const rules = ignore().add(await readFile('.vercelignore','utf8'));
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
  expect(included.filter(path=>/^(?:\.local\/|\.env|tests\/|fixtures\/|tools\/|\.git\/|contracts\/(?!runtime\/))/.test(path))).toEqual([]);
  expect(included.filter(path=>/\.(?:xlsx|csv|log|dump)$/.test(path))).toEqual([]);
});
