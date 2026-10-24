import { readFileSync, readdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const headlessDependencies = new Set(['@dagrejs/dagre', 'd3-scale', 'elkjs', 'rbush']);

/** Module specifiers of imports, re-exports, import types and lazy imports; comments are not imports. */
export function importsOf(file, source) {
  const found = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (node) => {
    let specifier;
    let lazy = false;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      specifier = node.arguments[0];
      lazy = true;
      if (!specifier || !ts.isStringLiteral(specifier)) found.push({ name: undefined, lazy });
    }
    if (specifier && ts.isStringLiteral(specifier)) found.push({ name: specifier.text, lazy });
    ts.forEachChild(node, check);
  };
  check(tree);
  return found;
}

const packageOf = (name) => (name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]);

/** Inspect imports, re-exports, import types and lazy imports; comments are not imports. */
export function boundaryViolations(file, source) {
  return importsOf(file, source).flatMap(({ name }) => {
    if (name === undefined) return ['Nonliteral module loading prevents boundary verification'];
    if (name.startsWith('.')) {
      const target = resolve(dirname(file), name);
      return target.startsWith(resolve(root, 'src/core') + '/') ? [] : [`Headless core imports outside core: ${name}`];
    }
    return headlessDependencies.has(packageOf(name)) ? [] : [`Unreviewed headless dependency: ${name}`];
  });
}

const bridgeDependencies = new Set([...headlessDependencies, 'bpmn-moddle']);

/**
 * The BPMN bridge outside its entry point: the core, the bridge itself,
 * bpmn-moddle, and bpmn-js loaded on demand only. React and the renderers stay
 * behind `src/bpmn/index.ts`, so Node code of the bridge never loads them.
 */
export function bridgeViolations(file, source) {
  return importsOf(file, source).flatMap(({ name, lazy }) => {
    if (name === undefined) return ['Nonliteral module loading prevents boundary verification'];
    if (name.startsWith('.')) {
      const target = resolve(dirname(file), name);
      const inside = ['src/core', 'src/bpmn'].some((dir) => target.startsWith(resolve(root, dir) + '/'));
      return inside && target !== resolve(root, 'src/bpmn/index.js') ? [] : [`BPMN bridge imports outside the core and the bridge: ${name}`];
    }
    const pkg = packageOf(name);
    if (pkg === 'bpmn-js') return lazy ? [] : [`BPMN bridge loads bpmn-js eagerly: ${name}`];
    return bridgeDependencies.has(pkg) ? [] : [`Unreviewed BPMN bridge dependency: ${name}`];
  });
}

/** Node tests load the bridge through its headless modules, never through the entry point or React. */
export function nodeTestViolations(file, source) {
  return importsOf(file, source).flatMap(({ name }) => {
    if (name === undefined || !name.startsWith('.')) return /^(react|react-dom|@xyflow\/react|@testing-library)(\/|$)/.test(name ?? '') ? [`Node test loads ${name}`] : [];
    const target = resolve(dirname(file), name).replace(/\.(js|ts|tsx)$/, '');
    // Vitest resolves the directory to its index.
    if (target === resolve(root, 'src/bpmn/index') || target === resolve(root, 'src/bpmn')) return [`Node test loads the BPMN entry point, which loads React: ${name}`];
    if (target.startsWith(resolve(root, 'src/react'))) return [`Node test loads React components: ${name}`];
    return [];
  });
}

/** Names the core entry point exports; it lists each of them. */
export function entryNames(source = readFileSync(resolve(root, 'src/core/index.ts'), 'utf8')) {
  const tree = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true);
  return new Set(tree.statements.flatMap((node) => (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => e.name.text) : [])));
}

/** Outside the core, a name the core entry point provides is imported from the entry point, not from the file that declares it. */
export function deepImportViolations(file, source, names = entryNames()) {
  const core = resolve(root, 'src/core') + '/';
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return tree.statements.flatMap((node) => {
    if (!(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) return [];
    const name = node.moduleSpecifier.text;
    const target = resolve(dirname(file), name).replace(/\.(js|ts)$/, '');
    if (!name.startsWith('.') || !target.startsWith(core) || target === core + 'index') return [];
    let imported = [];
    if (ts.isImportDeclaration(node)) {
      const bindings = node.importClause?.namedBindings;
      if (!bindings || ts.isNamespaceImport(bindings) || node.importClause.name) return [`Imports ${name} as a whole instead of from the core entry point`];
      imported = bindings.elements.map((e) => (e.propertyName ?? e.name).text);
    } else {
      if (!node.exportClause || !ts.isNamedExports(node.exportClause)) return [`Re-exports all of ${name} instead of from the core entry point`];
      imported = node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text);
    }
    return imported.filter((n) => names.has(n)).map((n) => `Imports ${n} from ${name}; the core entry point provides it`);
  });
}

/** The core modules that build the scene and run the map's transitions. */
export const coreSeams = ['src/core/scene.ts', 'src/core/map-controller.ts'];

/** Top-level declarations of a module, exported or not, with whether they are exported. */
function declarations(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return tree.statements.flatMap((node) => {
    const exported = !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [{ name: d.name.text, exported }] : []));
    const declares = ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node);
    return declares && node.name ? [{ name: node.name.text, exported }] : [];
  });
}

/** The names the scene and the map controller export; a seam that left the core is reported. */
export function seamNames(files = coreSeams) {
  const names = new Map();
  for (const path of files) {
    let source;
    try {
      source = readFileSync(resolve(root, path), 'utf8');
    } catch {
      throw new Error(`${path}: the core module is missing; the scene and the map controller stay inside the core`);
    }
    for (const { name, exported } of declarations(path, source)) if (exported) names.set(name, path);
  }
  return names;
}

/** Outside the core, no module declares a name of the scene or the map controller: renderers read them, they do not rebuild them. */
export function seamViolations(file, source, names = seamNames()) {
  return declarations(file, source).map(({ name }) => name).filter((n) => names.has(n)).map((n) => `Declares ${n}, which ${names.get(n)} owns`);
}

/**
 * Renderer adapters reach one another only through these hosts: the React
 * Canvas map and its element builder host the Canvas renderer, `BpmnView` hosts
 * the BPMN bridge, and the bridge's entry point re-exports `BpmnView`.
 */
export const adapterHosts = [
  ['src/react/CanvasMap.tsx', 'src/canvas'],
  ['src/react/map-elements.ts', 'src/canvas'],
  ['src/react/BpmnView.tsx', 'src/bpmn'],
  ['src/bpmn/index.ts', 'src/react/BpmnView'],
];
const adapters = ['src/react', 'src/canvas', 'src/bpmn'];
const adapterPackages = { react: 'src/react', '@xyflow/react': 'src/react', 'react-dom': 'src/react', 'bpmn-js': 'src/bpmn', 'bpmn-moddle': 'src/bpmn' };
const within = (path, dir) => path === resolve(root, dir) || path.startsWith(resolve(root, dir) + '/');

/** The React map, the Canvas renderer and the BPMN bridge import each other only through the hosts above, and only the adapter that owns a renderer package loads it. */
export function adapterViolations(file, source) {
  const own = adapters.find((dir) => within(file, dir));
  if (!own) return [];
  const self = relative(root, file);
  return importsOf(file, source).flatMap(({ name }) => {
    if (name === undefined) return [];
    if (!name.startsWith('.')) {
      const owner = adapterPackages[packageOf(name)];
      return owner && owner !== own ? [`${own} loads ${name}, which belongs to ${owner}`] : [];
    }
    const target = resolve(dirname(file), name).replace(/\.(js|ts|tsx)$/, '');
    const other = adapters.find((dir) => within(target, dir));
    if (!other || other === own) return [];
    return adapterHosts.some(([host, reached]) => host === self && within(target, reached)) ? [] : [`${own} imports the ${other} adapter: ${name}`];
  });
}

/** The module the stories take their maps from; it fixes their edge budget. */
export const storyMaps = 'stories/maps.tsx';
const mapComponents = new Set(['ProcessMap', 'ViewSwitcher', 'CanvasMap']);
const isMap = (node, tree) => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && mapComponents.has(node.tagName.getText(tree));
// The React entry point, from the source or from the built package.
const reactEntry = (file, name) => name === 'wise-flow/react' || (name.startsWith('.') && ['src/react', 'dist/react'].some((dir) => within(resolve(dirname(file), name), dir)));

/**
 * Stories draw with a fixed edge budget, so that the browser and visual lanes
 * do not depend on the speed of the machine: a story takes its maps from
 * `stories/maps.tsx`, never from the library, and no story or Storybook file
 * asks for an adaptive budget. That module passes every map a fixed budget,
 * after the props it forwards: a number, `"all"`, or the story's value with
 * one of those as its fallback.
 */
export function storyViolations(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const shared = resolve(file) === resolve(root, storyMaps);
  const library = new Map();
  const errors = [];
  for (const node of tree.statements) {
    const reexport = ts.isExportDeclaration(node);
    if (!(ts.isImportDeclaration(node) || reexport) || !node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier) || !reactEntry(file, node.moduleSpecifier.text)) continue;
    const bindings = reexport ? node.exportClause : node.importClause?.namedBindings;
    if (reexport ? !bindings || ts.isNamespaceExport(bindings) : bindings && ts.isNamespaceImport(bindings)) errors.push(`Takes the React entry point as a whole; stories take the maps from ${storyMaps}`);
    for (const e of bindings && (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) ? bindings.elements : []) {
      const name = (e.propertyName ?? e.name).text;
      if (!mapComponents.has(name)) continue;
      library.set(e.name.text, name);
      // Passed on unwrapped, a map keeps its adaptive default even from the shared module.
      if (!shared || reexport) errors.push(`Takes ${name} from the library; stories take it from ${storyMaps}, whose edge budget is fixed`);
    }
  }
  const fixed = (v) => !!v && (ts.isNumericLiteral(v) || (ts.isStringLiteral(v) && v.text === 'all'));
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) && node.text === 'adaptive') errors.push('Asks for an adaptive edge budget; stories draw with a fixed one');
    if (shared && (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && library.has(node.tagName.getText(tree))) {
      const props = node.attributes.properties;
      const at = props.findIndex((p) => ts.isJsxAttribute(p) && p.name.getText(tree) === 'edgeBudget');
      const init = props[at]?.initializer;
      const value = init && ts.isJsxExpression(init) ? init.expression : init;
      const ok = fixed(value) || (!!value && ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && fixed(value.right));
      if (!ok || props.slice(at + 1).some(ts.isJsxSpreadAttribute)) errors.push(`Renders ${library.get(node.tagName.getText(tree))} without a fixed edge budget after its other props`);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return errors;
}

/**
 * A component of the React adapter that renders one of the maps passes on its
 * edge budget and its adaptive default, as `ViewSwitcher` does, so it counts
 * as a map itself: the stories take it from `stories/maps.tsx` too.
 */
export function mapHostViolations(file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  let renders = false;
  const visit = (node) => {
    renders ||= isMap(node, tree);
    if (!renders) ts.forEachChild(node, visit);
  };
  visit(tree);
  if (!renders) return [];
  const exported = (node) => ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export;
  const names = tree.statements.flatMap((node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name && exported(node)) return [node.name.text];
    if (ts.isVariableStatement(node) && exported(node.declarationList.declarations[0])) return node.declarationList.declarations.map((d) => d.name.getText(tree));
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) return node.exportClause.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text);
    return [];
  });
  return names.filter((name) => /^[A-Z]/.test(name) && !mapComponents.has(name)).map((name) => `${name} renders a map; list it with the maps the stories take from ${storyMaps}`);
}

function filesAt(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? filesAt(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

export function checkArchitecture() {
  const names = entryNames();
  const seams = seamNames();
  const adapterFiles = adapters.flatMap((dir) => filesAt(resolve(root, dir))).filter((file) => !file.endsWith('.d.ts'));
  const rules = [
    [boundaryViolations, [resolve(root, 'src/index.ts'), ...filesAt(resolve(root, 'src/core'))]],
    [bridgeViolations, filesAt(resolve(root, 'src/bpmn')).filter((file) => file !== resolve(root, 'src/bpmn/index.ts') && !file.endsWith('.d.ts'))],
    [nodeTestViolations, filesAt(resolve(root, 'tests/core'))],
    [(file, source) => deepImportViolations(file, source, names), [resolve(root, 'src/index.ts'), ...['src/react', 'src/canvas', 'src/bpmn'].flatMap((dir) => filesAt(resolve(root, dir)))].filter((file) => !file.endsWith('.d.ts'))],
    [(file, source) => seamViolations(file, source, seams), [resolve(root, 'src/index.ts'), ...adapterFiles]],
    [adapterViolations, adapterFiles],
    [storyViolations, ['stories', '.storybook'].flatMap((dir) => filesAt(resolve(root, dir)))],
    [mapHostViolations, filesAt(resolve(root, 'src/react')).filter((file) => file.endsWith('.tsx'))],
  ];
  const errors = rules.flatMap(([rule, files]) => files.flatMap(file => rule(file, readFileSync(file, 'utf8')).map(message => `${relative(root, file)}: ${message}`)));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Headless boundaries checked across ${rules.reduce((n, [, files]) => n + files.length, 0)} files.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkArchitecture();
