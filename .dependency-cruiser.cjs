const SRC = '(?:^|/)src/';
const LAYER = SRC + '([^/]+)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'core-no-io',
      comment: 'core is pure: no Node built-in modules and no I/O or UI packages.',
      severity: 'error',
      from: { path: SRC + 'core/' },
      to: {
        dependencyTypes: ['core'],
      },
    },
    {
      name: 'core-no-io',
      comment: 'core is pure: no Node built-in modules and no I/O or UI packages.',
      severity: 'error',
      from: { path: SRC + 'core/' },
      to: { path: '(?:^|/)node_modules/(chalk|inquirer|commander|@modelcontextprotocol)(?:/|$)' },
    },
    {
      name: 'layer-order',
      comment: 'A layer imports only from layers below it: core, then storage and sources, then render, then adapters.',
      severity: 'error',
      from: { path: SRC + 'core/' },
      to: { path: SRC + '(storage|sources|render|adapters)/' },
    },
    {
      name: 'layer-order',
      severity: 'error',
      from: { path: SRC + '(storage|sources)/' },
      to: { path: SRC + '(render|adapters)/' },
    },
    {
      name: 'layer-order',
      severity: 'error',
      from: { path: SRC + 'render/' },
      to: { path: SRC + '(storage|sources|adapters)/' },
    },
    {
      name: 'storage-sources-apart',
      comment: 'storage and sources do not import each other.',
      severity: 'error',
      from: { path: SRC + 'storage/' },
      to: { path: SRC + 'sources/' },
    },
    {
      name: 'storage-sources-apart',
      severity: 'error',
      from: { path: SRC + 'sources/' },
      to: { path: SRC + 'storage/' },
    },
    {
      name: 'index-only',
      comment: 'A layer imports another layer only through that layer index.ts.',
      severity: 'error',
      from: { path: LAYER },
      to: {
        path: SRC + '[^/]+/',
        pathNot: [SRC + '$1/', SRC + '[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'no-chalk-in-plain-renderers',
      comment: 'Plain renderers never emit ANSI codes.',
      severity: 'error',
      from: { path: SRC + 'render/(markdown|json|csv|format)\\.ts$' },
      to: { path: '(?:^|/)node_modules/chalk(?:/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
