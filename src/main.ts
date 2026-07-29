import '@gershy/clearing';
import { rootFact } from '@gershy/disk';
import http from '@gershy/util-http';
import '@gershy/clearing';
import procRaw from '@gershy/nodejs-proc';
import tryWithHealing from '@gershy/util-try-with-healing';
import tsc from 'typescript';
import esbuild from 'esbuild';
import { entry } from '@gershy/entry';
import { convertImportsTsToJs, recurseTree } from './util.ts';

// TODO: TRANSFER REPOS TO "gershyNpm"...
// - Transfer manually in UI
// - Run `git remote set-url origin git@github.com:gershyNpm/{{repo}}.git`
// - Update package.json with new git urls

// TODO: Accidental use of npm "dependencies" (i.e. "runtime" dependency):
// - A dependency should only be "runtime" (appearing in package.json's "dependencies") if it's
//   used for a non-type import in a bundled (non-.test.ts) file!
// - Typescript settings for `import type ...` to be used
// - Some other tool (something custom) can search all imports for all @gershy dependencies and
//   determine for each if it's a dev or runtime dependency

const { skip } = clearing;
const map:      typeof clearing.map      = clearing.map;
const mapk:     typeof clearing.mapk     = clearing.mapk;
const has:      typeof clearing.has      = clearing.has;
const allArr:   typeof clearing.allArr   = clearing.allArr;
const merge:    typeof clearing.merge    = clearing.merge;
const toArr:    typeof clearing.toArr    = clearing.toArr;
const hasHead:  typeof clearing.hasHead  = clearing.hasHead;
const allObj:   typeof clearing.allObj   = clearing.allObj;
const upper:    typeof clearing.upper    = clearing.upper;
const mod:      typeof clearing.mod      = clearing.mod;
const slice:    typeof clearing.slice    = clearing.slice;
const empty:    typeof clearing.empty    = clearing.empty;
const walk:     typeof clearing.walk     = clearing.walk;
const slash:    typeof clearing.slash    = clearing.slash;
const hasTail:  typeof clearing.hasTail  = clearing.hasTail;
const fire:     typeof clearing.fire     = clearing.fire;
const limn:     typeof clearing.limn     = clearing.limn;
const count:    typeof clearing.count    = clearing.count;
const toObj:    typeof clearing.toObj    = clearing.toObj;
const baseline: typeof clearing.baseline = clearing.baseline;

const codec = {
  type: 'rec',
  loose: true,
  props: {
    act: { type: 'str' }
  }
} as const;
entry({ name: 'manager', codec, inp: { act: 'help' }, fn: async (logger, inp) => {
  
  const manageFact = rootFact.kid([ import.meta.dirname ]).par();
  const gershyFact = manageFact.par(); // References the "@gershy" directory
  
  const { proc, githubOwner, githubToken, npmToken } = await (async () => {
    
    const config: { [K in 'git' | 'npm']: { token: string, expiry: string } } = await manageFact.kid([ 'config.json' ]).getData('json') as any;
    
    const proc: typeof procRaw = ((cmd, opts: { env?: Obj<string> } = {}) => {
      return procRaw(cmd, {
        cwd: rootFact,
        ...opts,
        env: { ...process.env, ...(opts.env ?? {}) }
      });
    }) as any;
    
    const githubOwner: { type: 'user' | 'org', name: string } = { type: 'org', name: 'gershyNpm' };
    const githubToken = config.git.token; // TODO - obtain via `gh auth token`??
    const githubTokenExpiry = config.git.expiry;
    const githubExpiryMs = +(new Date(githubTokenExpiry)) - +(new Date());
    if (githubExpiryMs < 1000 * 60 * 60 * 24 * 3) logger.log(`Github token expires in ${ (githubExpiryMs / (1000 * 60 * 60)).toFixed(2) } hours!`);
    
    const npmToken = config.npm.token;
    const npmTokenExpiry = config.npm.expiry;
    const npmExpiryMs = +(new Date(npmTokenExpiry)) - +(new Date());
    if (npmExpiryMs < 1000 * 60 * 60 * 24 * 3) logger.log(`Npm token expires in ${ (npmExpiryMs / (1000 * 60 * 60)).toFixed(2) } hours!`);
    
    return { proc, githubOwner, githubToken, npmToken };
    
  })();
  
  type DirName = string;
  type GitName = string;
  type NpmName = `@gershy/${string}`;
  
  class Unit {
    
    protected static units = new Map<DirName, Unit>;
    protected static npmToGit = (npm: NpmName): GitName => npm.slice('@gershy/'.length).replace(/-([a-z])/g, (_, c) => c[upper]());
    protected static gitToNpm = (git: GitName): NpmName => `@gershy/${git.replace(/([^A-Z])([A-Z])/g, '$1-$2').toLowerCase()}`;
    
    public static getUnit = (dirName: string) => {
      
      if (!Unit.units.has(dirName)) Unit.units.set(dirName, new Unit(dirName === '.manager' ? 'manager' : dirName));
      return Unit.units.get(dirName)!;
      
    };
    public static getUnits = async () => {
      
      // Filter out anything that doesn't have a "package.json" kid
      const allKids = await gershyFact.getKids();
      const kids = await Promise[allObj](allKids[map](async kid => (await kid.kid([ 'package.json' ]).exists()) ? kid : skip));
      
      const units = kids
        [toArr]((kid, fp) => Unit.getUnit(fp))
        .sort((u0, u1) => u0.getGitName().localeCompare(u1.getGitName()));
      
      await Promise.all(units[map](u => u.initReferences()));
      return units;
      
    };
    
    protected initPrm: null | Promise<void>;
    protected gitName: string;
    protected pkg: {
      version: `${number}.${number}.${number}`
    } & {
      [K in 'dependencies' | 'devDependencies' | 'peerDependencies']?: { [K in NpmName]: `^${number}.${number}.${number}` }
    };
    
    // Deps depended on by the Unit; referenced in the Unit's package.json
    protected requireDeps: { [K in 'main' | 'dev' | 'peer']: { [K in GitName]: { unit: Unit, version: string } } };
    
    // Deps which depend on ("are supported by") the Unit; their package.jsons reference the Unit
    protected supportDeps: { [K in 'main' | 'dev' | 'peer']: { [K in GitName]: { unit: Unit, version: string } } };
    
    constructor(gitName: DirName) {
      
      if (!/^[a-z][a-zA-Z0-9]*$/.test(gitName)) throw Error('invalid git name')[mod]({ gitName });
      
      this.initPrm = null;
      this.gitName = gitName;
      this.requireDeps = { main: {}, dev: {}, peer: {} };
      this.supportDeps = { main: {}, dev: {}, peer: {} };
      this.pkg = {
        version: '0.0.0',
        dependencies:     {},
        devDependencies:  {},
        peerDependencies: {},
      };
      
    }
    
    public getGitName() { return this.gitName; }
    public getNpmName() { return Unit.gitToNpm(this.gitName); }
    public getNpmVersion() { return this.pkg.version; }
    
    public getRepoFact() {
      return gershyFact.kid([ this.gitName === 'manager' ? '.manager' : this.gitName ]);
    }
    
    public async initReferences() {
      
      if (!this.initPrm) this.initPrm = (async () => {
        
        // Update our required deps (easier)
        const repoFact = this.getRepoFact();
        const pkg = this.pkg = (await repoFact.kid([ 'package.json' ]).getData('json') as typeof this.pkg);
        
        this.requireDeps = { main: pkg.dependencies ?? {}, dev: pkg.devDependencies ?? {}, peer: pkg.peerDependencies ?? {} }
          [map]((v, k) => v[mapk]((version, npmName) => {
            if (!npmName[hasHead]('@gershy/')) return skip;
            const gitName = Unit.npmToGit(npmName);
            return [ gitName, { unit: Unit.getUnit(gitName), version } ];
          }));
        
        // Update supported deps of our deps
        for (const [ depType, depList ] of this.requireDeps[walk]())
          for (const [ _, { unit, version } ] of depList[walk]())
            unit.supportDeps[depType][this.getGitName()] = { unit: this, version };
        
      })();
      
      await this.initPrm;
      
      return this;
      
    }
    
    public getRequireDeps() {
      return this.requireDeps[toArr](deps => deps[toArr](dep => dep.unit)).flat(1);
    }
    public getSupportDeps() {
      return this.supportDeps[toArr](deps => deps[toArr](dep => dep.unit)).flat(1);
    }
    
    public * getFullRequireDeps(seen = new Set<Unit>()) {
      
      if (seen.has(this)) return;
      seen.add(this);
      
      yield this;
      for (const unit of this.getRequireDeps()) yield* unit.getFullRequireDeps(seen);
      
    }
    public * getFullSupportDeps(seen = new Set<Unit>()) {
      
      if (seen.has(this)) return;
      seen.add(this);
      
      yield this;
      for (const unit of this.getSupportDeps()) yield* unit.getFullSupportDeps(seen);
      
    }
    
    public getDeps() { return this.supportDeps; }
    
    public async firstTimeInitialization() {
      
      const res = await http({
        netProc: { proto: 'https' as const, addr: 'api.github.com', port: 443, },
        headers: {
          authorization: `token ${githubToken}`,
          accept: 'application/vnd.github+json',
          contentType: 'application/json'
        },
        path: githubOwner.type === 'org'
          ? [ 'orgs', githubOwner.name, 'repos' ]
          : [ 'user', 'repos' ],
        method: 'post',
        body: githubOwner.type === 'org'
          ? { private: false, name: this.getGitName(), owner: githubOwner.name }
          : { private: false, name: this.getGitName() }
      });
      if (res.code !== 201) throw Error('github repo creation failed')[mod]({ res: res[slice]([ 'code', 'body' ]) });
      logger.log('Repo created');
      
      await proc(`git clone https://github.com/${githubOwner.name}/${this.getGitName()}.git`, { cwd: gershyFact });
      logger.log('Repo cloned');
      
      await this.updateFromTemplate();
      logger.log('Set up template files');
      
      await this.commitFully({ commitMsg: 'initial @gershy setup' });
      
    }
    public async updateFromTemplate() {
      
      const repoFact = this.getRepoFact();
      const templateFact = manageFact.kid([ 'template' ]);
    
      const copy = async (mode: 'force' | 'ensure', cmps: string[]) => {
        const src = templateFact.kid(cmps);
        const trg = repoFact    .kid(cmps);
        if (mode === 'ensure' && await trg.exists()) return;
        await trg.setData(await src.getData('bin'));
      };
      
      // Kill outdated files (TODO: remove eventually!)
      await repoFact.kid([ 'build' ]).rem();
      await repoFact.kid([ 'sideEffects.d.ts' ]).rem();
      
      // TODO: This is copying everything from ../template (except package.json?? which is deprecated!)
      // TODO: @gershy/disk should provide a `copy` function, or at least a recursive kid iteration
      // with relative sub-paths (which facilitates copying)
      await Promise[allArr]([
        
        // Manager controls these files
        copy('force',  [ 'build', 'utils.test.ts' ]),
        copy('force',  [ '.gitignore' ]),
        copy('force',  [ 'license' ]),
        copy('force',  [ 'tsconfig.json' ]),
        
        // The following are controlled on a per-repo basis - manager won't clobber existing
        copy('ensure', [ 'src', 'main.test.ts' ]),
        copy('ensure', [ 'src', 'main.ts'      ]),
        copy('ensure', [ 'readme.md' ])
        
      ]);
      
      const pkgMainDepNames = ((this.pkg.dependencies as undefined | Obj<string>) ?? {})[toArr]((v, k) => k);
      
      await this.updatePackageJson({}
        [merge]({ // Initial package.json state
          
          name: this.getNpmName(),
          version: '0.0.0', // Note all-zeroes is motivated by "newRepo" running `commitFully` - if we set 0.0.1, it would be incremented in this process and the 1st published npm version would be 0.0.2 - kinda ugly! (Although this is also a bit of a hack)
          author: 'Gershom Maes',
          description: 'TODO',
          keywords: [ 'TODO' ],
          repository: {
            type: 'git',
            url: `git+https://github.com/${githubOwner.name}/${this.getGitName()}.git`
          },
          bugs: {
            url: `https://github.com/${githubOwner.name}/${this.getGitName()}/issues`
          },
          homepage: `https://github.com/${githubOwner.name}/${this.getGitName()}#readme`,
          type: 'module',  // Consider source files to be esm (compiled cjs/esm dirs have their own package.json with "type" defined)
          files: [ 'cmp' ] // Npm publish will use this as its root (package.json, readme, license etc are all included by default)
          
        })
        [merge]({ // repo-controlled fields...
          ...this.pkg,
          
        })
        [merge]({ // manager-controlled fields...
          
          // Note `skip` values address outdated stuff previously populated on all repos!
          // TODO: Get rid of that...
          
          scripts: {
            
            'build.cjs': skip,
            'build.mjs': skip,
            'build': skip,
            
            // TODO: Consider running tests with `node --import tsx/esm ./src/main.test.ts` - it's faster, but stuff may break??
            'test': "npm run ts.check && npx tsx ./src/main.test.ts",
            'ts.check': "npx tsc --noEmit",
            'git.pub':   skip,
            'npm.login': skip,
            'npm.cmp':   skip,
            'npm.pub':   skip
            
          },
          
          types: skip,
          sideEffects: skip,
          exports: {
          
            // Note this is merged in, so repos may have their own inner exports!
            '.': {
              import:  './cmp/esm/main.js',
              require: './cmp/cjs/main.js'
            }
            
          },
          
          peerDependencies: {
            '@gershy/clearing': `^${await gershyFact.kid([ 'clearing', 'package.json' ]).getData('json').then((v: any) => v.version)}` // Note the version will be resolved and baked into package.json by `this.commitFully(...)`
          }[slash](pkgMainDepNames as any[]), // Eliminate peer dependencies which already appear in main dependencies! (E.g. scriptBundle has esbuild as a *main* dep, not a *dev* dep)
          devDependencies: {
            '@types/node': '^24.10.1',
            'esbuild':     skip,
            'tsx':         skip,
            'typescript':  skip
          }[slash](pkgMainDepNames as any[]),
          dependencies: {
            'tsx': skip
          }
          
        }),
        
        { mode: 'overwrite' }
      );
      await this.updatePkgRequiredDeps();
      
      await proc('npm install', { cwd: repoFact });
      
    }
    public async npmCompile() {
      
      // Generates a Unit's npm bundle in-place and returns its Fact
      
      // We have 3 species of .ts files:
      // 1. *.test.ts - "test ts"; we ensure these are completely excluded from the npm bundle
      // 2. *.d.ts - "declaration ts"; side effects only, are ignored by tsc / esbuild (technically
      //    they're outside the scope of these tools since they don't need to be compiled as they
      //    are already pure typing; no code to strip) - we need to copy these ourselves to the npm
      //    bundle to ensure side effect typing is in place
      // 3. Any other *.ts - "main ts"; the meat of our npm bundle; are converted to js by esbuild,
      //    and with types generated by tsc (which creates an x.d.ts for each x.ts encountered)
      
      const repoFact = this.getRepoFact();
      const cmpFact = repoFact.kid([ 'cmp' ]);
      
      // Resolve just the typescript files we want to bundle into npm
      const srcTsFacts = await (async () => {
        
        // Get just the typescript facts we want to include in the npm bundle
        const allSrcFacts = await recurseTree({
          node: repoFact.kid([ 'src' ]),
          getKids: fact => fact.getKids()
        })[toArr](v => v);
        return allSrcFacts.filter(({ chain }) => (chain.at(-1) ?? 'root')[hasTail]('.ts')).map(v => v.node);
        
      })();
      
      // Filter down to "main ts" - excludes test and declaration ts
      const mainTsFacts = srcTsFacts.filter(fact => {
        const name = fact.getCmps().at(-1) ?? 'root';
        if (name[hasTail]('.test.ts')) return false;
        if (name[hasTail]('.d.ts'))    return false;
        return true;
      });
      
      await cmpFact.rem();
      const { compilerOptions = {} } = (await gershyFact.kid([ 'tsconfig.json' ]).getData('json')) as { compilerOptions: Obj<any> };
      
      // Use `tsc` to generate .d.ts files for all source .ts (excluding .d.ts) source files
      // Generates only a "cjs" directory (which will be copied exactly to "esm")
      await (async () => {
        
        // This function is marked `async` - although `tsc` is completely sync :(
        
        const cjsFact = cmpFact.kid([ 'cjs' ]);
        const jsonArgs = {
          
          include: mainTsFacts.map(fact => fact.fsp()),
          compilerOptions: compilerOptions[merge]({
            
            // Prevent dev-mode local resolution
            baseUrl:             skip,
            paths:               skip,
            
            // Ensure we only generate .d.ts
            declaration:         true,
            emitDeclarationOnly: true,
            
            // Output in the appropriate place
            declarationDir:      cjsFact.fsp(),
            
          })
          
        };
        const programArgs = tsc.parseJsonConfigFileContent(jsonArgs, tsc.sys, repoFact.fsp());
        const program = tsc.createProgram({
          rootNames: programArgs.fileNames,
          options:   programArgs.options
        });
        
        const result = program.emit();
        if (result.emitSkipped) {
          
          const diagnostics = [ ...tsc.getPreEmitDiagnostics(program), ...result.diagnostics ].map(({ file, start, messageText }) => ({
            
            msg: tsc.flattenDiagnosticMessageText(messageText, '\n'),
            ...(file && start && (() => {
              
              const { line, character } = file.getLineAndCharacterOfPosition(start);
              return { file: file.fileName, line: line + 1, char: character + 1 };
              
            })())
            
          }));
          
          throw new Error('tsc declaration failed')[mod]({
            
            ...(diagnostics.length > 10
              ? {
                totalDiagnostics: diagnostics.length,
                first10Diagnostics: diagnostics.slice(0, 10)
              }
              : {
                diagnostics
              }
            )
            
          });
          
        }
        
      })();
      
      // Copy all .d.ts files in src to cmp (tsc always excludes .d.ts files)
      await (async () => {
        
        const srcTsDecFacts = srcTsFacts.filter(v => (v.getCmps().at(-1) ?? 'root')[hasTail]('.d.ts'));
        for (const src of srcTsDecFacts) {
          
          const relCmps = src.getCmps().slice(repoFact.kid([ 'src' ]).getCmps().length);
          const trg = repoFact.kid([ 'cmp', 'cjs', ...relCmps ]);
          await trg.setData(await src.getData('bin'));
          
        }
        
      })();
      
      const cjsFacts = await recurseTree({ node: repoFact.kid([ 'cmp', 'cjs' ]), getKids: fact => fact.getKids() });
      
      for await (const { chain, node: src } of cjsFacts) {
        
        if (await src.getDataBytes() <= 0) continue;
        
        const trg = repoFact.kid([ 'cmp', 'esm', ...chain ]);
        const data = await src.getData('bin');
        if (data.length) await trg.setData(data);
        
      }
      
      // Transpile typescript to cjs / esm
      await Promise.all(([ 'cjs', 'esm' ] as const).map(async target => {
        
        const replaceKey = k => `__esbuild_replace_target_${k.replace(/[^a-zA-Z0-9_$]/g, '_')}`;
        const replacements = {
          
          cjs: {
            'import.meta': '({ url: new URL(__filename).href, dirname: __dirname, filename: __filename })'
          },
          esm: {
            // Nothing for now...
          }
          
        }[target];
        
        const err = Error('');
        const result = await esbuild.build({
          absWorkingDir: repoFact.fsp(),
          entryPoints:   mainTsFacts.map(fact => fact.fsp()),
          outbase:       repoFact.kid([ 'src' ]).fsp(), // path.join(rootFp, 'src'),
          outdir:        repoFact.kid([ 'cmp', target ]).fsp(), // path.join(rootFp, 'cmp', target),
          define:        replacements[map]((v, k) => replaceKey(k)),
          logLevel:      'silent',
          bundle:        false,
          minify:        false,
          sourcemap:     false,
          platform:      'node',
          format:        target,
          metafile:      true
        }).catch(cause => err[fire]({ msg: cause.message, ...cause[slice]([ 'errors', 'warnings' ])[map](arr => arr.map(v => v[slice]([ 'text', 'location' ]))) }));
        
        const replace = replacements[mapk]((v, k) => {
          return [ replaceKey(k), v ];
        });
        const replaceReg = replace[empty]() ? null : new RegExp(replace[toArr]((v, k) => k).join('|').replaceAll('$', '\\$'), 'g');
        
        await Promise.all(result.metafile.outputs[toArr](async (v, cmpFp) => {
            
          const replaceFact = repoFact.kid([ cmpFp ]);
          
          let data = await replaceFact.getData('str');
          if (replaceReg) data = data.replace(replaceReg, term => replace[term]!)
          
          if (target === 'esm')
            data = convertImportsTsToJs(data);
          
          await replaceFact.setData(data);
          
        }));
        
        await cmpFact
          .kid([ target, 'package.json' ])
          .setData({ type: { cjs: 'commonjs', esm: 'module' }[target] });
        
      }));
      
      return cmpFact;
      
    }
    public async updatePackageJson(pkg: Obj<any>, args?: { mode?: 'merge' | 'overwrite' }) {
      
      // Merges (default) or overwrites package.json with the given data
      
      // TODO: There are oversights, overall, in how Units / package.json are linked. E.g. this
      // method was a half-assed attempt to have a source-of-truth for linkage, via package.json,
      // but it doesn't update `this.requireDeps` or other Units' `supportDeps`, which it really
      // should!
      
      const { mode='merge' } = args ?? {};
      
      if (mode === 'merge')          this.pkg[merge](pkg);
      else if (mode === 'overwrite') this.pkg = pkg as any;
      
      await this.getRepoFact().kid([ 'package.json' ]).setData(JSON.stringify(this.pkg, null, 2));
      
    }
    public async updatePkgRequiredDeps() {
      
      // Updates npm dependencies to the latest of all relevant @gershy dependencies
      
      // We rely on the Unit being linked; doesn't apply if this Unit is being first-time-created
      if (!this.initPrm && (await this.getNpmVersion() !== '0.0.0')) throw Error('initialization missing');
      
      // Isolate @gershy and non-@gershy dependencies
      const deps = [ 'dependencies', 'devDependencies', 'peerDependencies' ][toObj](v => [ v, this.pkg[v] ?? {} ] as const);
      const srcDeps      = deps[map](deps => deps[map]((v, k) => k[hasHead]('@gershy/') ? v : skip));
      const srcDepsOther = deps[map](deps => deps[map]((v, k) => k[hasHead]('@gershy/') ? skip : v));
      
      const trgDeps = {
        dependencies:     this.requireDeps.main,
        devDependencies:  this.requireDeps.dev,
        peerDependencies: this.requireDeps.peer
      }[map](deps => deps[mapk]((dep, git) => [ Unit.gitToNpm(git), `^${dep.unit.pkg.version}` ]));
      
      // Avoid npm dependency update and `npm install` if dependencies already up-to-date, otherwise
      // update package.json and run `npm install`
      if (JSON.stringify(srcDeps) === JSON.stringify(trgDeps)) return;
      
      // Note we don't want to merge - e.g. if a package switches from main to dev it must not get
      // written to both lists!
      await this.updatePackageJson({ ...this.pkg, ...trgDeps[merge](srcDepsOther) }, { mode: 'overwrite' });
      
      // Npm dependency updates for manager need manual intervention
      if (this.getGitName() === 'manager') throw Error('manager self-update unavailable')[mod]({
        info: 'Manager is unable to run `npm install` on itself due to in-use files - run `npm install` manually',
      });
      
      const repoFact = this.getRepoFact();
      await tryWithHealing({
        
        fn: () => proc('npm install', { cwd: repoFact }),
        canHeal: err => /* logger.log({ err }) ?? */ true,
        
        // If `npm install` fails attempt recovery by deleting stale npm install and retrying...
        heal: () => Promise.all([
          repoFact.kid([ 'node_modules' ]).rem(),
          repoFact.kid([ 'package-lock.json' ]).rem()
        ])
        
      });
      
    }
    public async commitFully(args: { commitMsg: string }): Promise<{ modified: boolean }> {
      
      return logger.scope(`commit.${this.getGitName()}`, {}, async logger => {
        
        const { commitMsg } = args;
        const git = this.getGitName();
        const npm = this.getNpmName();
        const repoFact = this.getRepoFact();
        
        // Update any outdated @gershy dependencies
        await this.updatePkgRequiredDeps();
        logger.log({ $$: 'packageJsonVersionsUpdate' });
        
        // Check git status; possibly short-circuit
        const { clean } = await (async () => {
          
          const gitStatus = await proc('git status', { cwd: repoFact });
          const clean = gitStatus.output[has]('working tree clean');
          logger.log({ $$: 'gitStatus', clean });
          return { clean };
          
        })();
        if (clean) return { modified: false };
        
        // Run tests before committing anything...
        await (async () => {
          
          // TODO: If this unit is a util, apply additional tests - no non-type imports allowed in main.ts!!
          // (Need to refactor clearing to export its utils globally D:)
          
          await proc('npm run test', { cwd: repoFact }).catch(err => {
            throw Error(`Commit "${git}" - tests failed`)[mod]({ npm, git, output: err.output ?? '<no output>' });
          });
          logger.log({ $$: 'test' });
          
        })();
        
        // Update package.json version
        const version = await (async () => {
          
          const [ major, minor, patch ] = this.pkg.version.split('.').map(v => parseInt(v, 10));
          
          await this.updatePackageJson({ version: `${major}.${minor}.${patch + 1}` })
          await proc('npm install', { cwd: repoFact }); // Bring package-lock.json up-to-date too
          logger.log({ $$: 'npmVersionIncrement', version: this.pkg.version  });
          
          return this.pkg.version as string;
          
        })();
        
        // Compile npm bundle (but don't publish it yet!)
        await (async () => {
          
          await this.npmCompile();
          logger.log({ $$: 'npmCompile' });
          
        })();
        
        // Commit to git
        await (async () => {
          
          await proc('git add --all',                { cwd: repoFact });
          await proc(`git commit -m "${commitMsg}"`, { cwd: repoFact });
          await proc('git push',                     { cwd: repoFact });
          logger.log({ $$: 'gitPush', commitMsg });
          
        })();
        
        // Commit to npm
        await (async () => {
          
          const npmrcFact = repoFact.kid([ '.npmrc' ]);
          try {
            await npmrcFact.setData(String[baseline](`
              | registry=https://registry.npmjs.org/
              | @gershy:registry=https://registry.npmjs.org/
              | //registry.npmjs.org/:_authToken=${npmToken}
              | always-auth=true
            `));
            await proc(`npm publish --registry=https://registry.npmjs.org/ --userconfig ${npmrcFact.fsp()} --access public`, { cwd: repoFact });
          } finally { await npmrcFact.rem(); }
          
          // await proc('npm publish --access public', { cwd: repoFact, env: { NODE_AUTH_TOKEN: npmToken } });
          logger.log({ $$: 'npmPublish' });
          
          let cnt = 0;
          while (true) {
            
            const view = await proc(`npm view ${this.getNpmName()}`, { cwd: rootFact });
            
            const reg = /\blatest: ([0-9]+[.][0-9]+[.][0-9]+)\b/; // Brittle?
            const [ , viewVersion ] = view.output.match(reg) ?? [ null, '0.0.0' ];
            
            if (viewVersion === version) {
              logger.log({ $$: 'npmRegister', ready: true });
              break;
            } else {
              cnt++;
              logger.log({ $$: 'npmRegister', ready: false, attempts: cnt, existingVersion: viewVersion, expectedVersion: version });
              await new Promise(r => setTimeout(r, 500));
            }
            
          }
          
        })();
        
        return { modified: true };
        
      });
      
    }
    
    public [limn]() { return {
      git: this.getGitName(),
      npm: this.getNpmName(),
      fsp: this.getRepoFact().fsp(),
      requires: this.getRequireDeps()[map](u => u.getGitName()),
      supports: this.getSupportDeps()[map](u => u.getGitName())
    }; }
    
  };
  
  const cmd = eval(`(${process.argv.at(-1)})`);
  const units = await Unit.getUnits();
  
  const act = async (units: Unit[]) => {
    
    if (cmd.act === 'script') {
      
      await logger.scope('script', {}, async logger => {
        
        const result = await cmd.script(units, { proc });
        logger.log({ $$: 'result', result });
        
      });
      
    } else if (cmd.act === 'getTypeCheck') {
      
      // TODOOO
      
      
      // npx tsc --noEmit
      
    } else if (cmd.act === 'updateFromTemplate') {
      
      const { unit: gitName, commit = false } = cmd;
      const updUnits = gitName === '*' ? units : [ units.find(unit => unit.getGitName() === cmd.unit)! ];
      
      for (const unit of updUnits) {
        
        logger.log(`Updating ${unit.getGitName()}...`);
        await unit.updateFromTemplate();
        if (commit) await unit.commitFully({ commitMsg: 'templating update' });
        logger.log(`Updated!`);
        
      }
        
      logger.log('Done!');
      
    } else if (cmd.act === 'getOverview') {
      
      logger.log(units[map](u => `${u.getGitName()} (${u.getNpmName()}@${u.getNpmVersion()})`));
      
    } else if (cmd.act === 'setCommit') {
      
      const { desc = '<automated>', commitMsg = desc, recurse = true } = cmd;
      
      const unit = units.find(unit => unit.getGitName() === cmd.unit);
      if (!unit) throw Error('unit missing')[mod]({ unit: cmd.unit });
      await unit.commitFully({ commitMsg });
      
      // Note that even if `commitFully` resulted in a no-op (e.g. no git changes) we still update
      // dependencies! This can be a nice way to continue from a failed 'setCommit'
      if (recurse) {
      
        // Now every Unit supported by `unit` must be updated...
        const supported = new Set<Unit>([ ...unit.getFullSupportDeps() ]);
        const committed = new Set<Unit>([ unit ]);
        const failures: { unit: Unit, err: any }[] = [];
        
        while (committed[count]() < supported[count]()) {
          
          const committable = supported[toArr](v => v).filter(unit => {
            
            return true
              && !committed.has(unit)
              // Every dep must either be already committed, or not part of the 
              && unit.getRequireDeps().every(dep => committed.has(dep) || !supported.has(dep));
            
          });
          
          if (committable[empty]())
            throw Error('commits unreconcilable')[mod]({ pending: supported[toArr](u => committed.has(u) ? skip : u) });
          
          logger.log({ committable: committable.map(u => u.getGitName()) });
          
          for (const unit of committable) {
            committed.add(unit);
            await unit.commitFully({ commitMsg }).catch(err => {
              logger.log('Failed!');
              failures.push({ unit, err });
            });
          }
          
        }
        
        if (failures.length)
          throw Error('some unit commits failed')[mod]({ failedUnits: failures.map(f => f.unit.getGitName()) });
        
        logger.log('(Dependent modules are up-to-date)');
        
      } else {
        
        logger.log('(Not attempting to update dependent modules)');
        
      }
      
      logger.log('Done!');
      
    } else if (cmd.act === 'setUnit') {
      
      const unit = Unit.getUnit(cmd.unit); // new Unit(cmd.unit);
      await unit.firstTimeInitialization();
      
      logger.log(`Created "${unit.getGitName()}" unit!`);
      
    } else if (cmd.act === 'getGitPending') {
      
      const gitPending = await Promise[allArr](units[map](async unit => {
        
        const gitStatus = await proc(`git status`, { cwd: unit.getRepoFact() });
        return gitStatus.output[has]('working tree clean') ? skip : unit;
        
      }));
      
      if (gitPending[empty]()) logger.log('Completely clean!');
      else                     logger.log(`Pending changes in:\n${gitPending[map](unit => unit.getRepoFact().fsp()).map(ln => `- ${ln}`).join('\n')}`);
      
    } else if (cmd.act === 'getLlmResponse') {
      
      const res = await proc('copilot -p {{prompt}} --model "gpt-4.1"', { cwd: rootFact, args: { prompt: cmd.prompt }});
      
      logger.log('The llm responded:');
      logger.log(res.output);
      
    } else {
      
      throw Error('unknown act')[mod]({ act: cmd.act });
      
    }
    
  };
  
  const setRootTsconfig = async (mode: 'dev' | 'prod') => {
    
    // In "dev" mode @gershy dependencies are auto-linked; no need for npm dependency management
    // In "prod" mode there's no auto linking - dependency resolution depends on npm management
    
    const tsconfig = await manageFact.kid([ 'tsconfig.template.json' ]).getData('json') as Obj<any>;
    
    if (mode === 'dev') tsconfig[merge]({
      
      '.notes': skip,
      compilerOptions: {
        baseUrl: gershyFact.fsp(),
        paths: units[toObj](unit => [ unit.getNpmName(), [ `./${unit.getRepoFact().getCmps().at(-1)}/src/main.ts` ] ] as const) // E.g. ```{ "@gershy/clearing": ["./clearing/src/main.ts"] }```
      },
      references: units.map(unit => ({ path: `./${unit.getRepoFact().getCmps().at(-1)}` }))
      
    });
    
    if (mode === 'prod') tsconfig[merge]({
      
      '.notes': skip,
      compilerOptions: {
        baseUrl: skip,
        paths: {}
      },
      references: []
      
    });
    
    await gershyFact.kid([ 'tsconfig.json' ]).setData(JSON.stringify(tsconfig, null, 2));
    
  };
  
  await setRootTsconfig('prod');
  try     { await act(units); }
  finally { await setRootTsconfig('dev').catch(err => logger.log({ $$: 'rootTsconfigDevResetFailed', err })); }

}});