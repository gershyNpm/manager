import { assertEqual, testRunner } from '../build/utils.test.ts';
import './main.ts';

// Type testing
(async () => {
  
  type Assert<V extends true> = V;
  
  type Tests = {
    1: Assert<Equal<{ x: 'y' }, { x: 'y' }>>
  };
  if (0) ((v?: Tests) => void 0)();
  
})();

testRunner([
  
  { name: 'not implemented', fn: async () => {
    
    // TODO: Implement!
    assertEqual(null, null);
    
  }}
  
]);