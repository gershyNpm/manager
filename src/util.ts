export const recurseTree = async function*<T>({ node, getKids, chain = [] }: { node: T, getKids: (node: T) => Promise<Obj<T>>, chain?: string[] }): AsyncGenerator<{ chain: string[], node: T }> {
  
  // Consider: Provide this functionality in @gershy/clearing?
  
  yield { node, chain };
  
  const kids = await getKids(node);
  for (const [ k, node ] of kids[cl.walk]())
    yield* recurseTree({ node, getKids, chain: [ ...chain, k ] });
  
};
export const convertImportsTsToJs = (file: string) => {
  
  const lines = file.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    
    const rep = (() => {
      
      const sideMatch = lines[i].match(/^import ['"`]([^'"`]+)['"`];$/);
      if (sideMatch) return { template: `import '###';`, importUrl: sideMatch[1] };
      
      const impMatch = lines[i].match(/^(import|export) (.*) from ['"`]([^'"`]+)['"`];$/);
      if (impMatch) return { template: `${impMatch[1]} ${impMatch[2]} from '###';`, importUrl: impMatch[3] };
      
      return null;
      
    })();
    
    if (!rep) continue;
    
    const { template, importUrl } = rep;
    const convertTsToJs = true
      && importUrl[cl.hasHead]('.')       // Target relative paths only
      && importUrl[cl.hasTail]('.ts')     // Target .ts imports
      && !importUrl[cl.hasTail]('.d.ts'); // Skip .d.ts imports
    if (convertTsToJs) 
      lines[i] = template.replace('###', importUrl.replace(/[.]ts$/, '.js'));
    
  }
  
  return lines.join('\n');
  
};