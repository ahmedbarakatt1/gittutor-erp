import{expect,test}from'vitest';
import{formatFinanceAmount}from'../../src/modules/shared/format';
test('large aggregate reports and negative cents retain exact integer digits',()=>{expect(formatFinanceAmount('153122387540883446','en-US')).toBe('EGP 1,531,223,875,408,834.46');expect(formatFinanceAmount('-1','en-US')).toBe('-EGP 0.01');expect(()=>formatFinanceAmount('1.5')).toThrow();});
