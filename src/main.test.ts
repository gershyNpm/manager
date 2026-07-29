import { assertEqual, testRunner } from '../build/utils.test.ts';
import { convertImportsTsToJs } from './util.ts';

// Type testing
(async () => {
  
  type Enforce<Provided, Expected extends Provided> = { provided: Provided, expected: Expected };
  
  type Tests = {
    1: Enforce<{ x: 'y' }, { x: 'y' }>,
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

testRunner([
  
  { name: 'ts to js extension conversion', fn: async () => {
    
    assertEqual(
      convertImportsTsToJs(String[cl.baseline](`
        | import './my/cool/module.ts';
        | import './side/effect.d.ts';
        | import boychik from 'https://resource.com/module.ts';
        | import { stuff } from './my/really/cool/module.ts';
        | import defaultThings from '../../../../import.ts';
        | console.log('An import looks like \`import things from \\'./some/import/path.ts\\';\` - capiche??');
        | export * from './my/cool/module.ts';
      `)),
      String[cl.baseline](`
        | import './my/cool/module.js';
        | import './side/effect.d.ts';
        | import boychik from 'https://resource.com/module.ts';
        | import { stuff } from './my/really/cool/module.js';
        | import defaultThings from '../../../../import.js';
        | console.log('An import looks like \`import things from \\'./some/import/path.ts\\';\` - capiche??');
        | export * from './my/cool/module.js';
      `)
    );
    
  }}
  
]);