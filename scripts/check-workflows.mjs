import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
export function workflowViolations(text) {
  const parsed = parseDocument(text, { uniqueKeys: true });
  if (parsed.errors.length) return parsed.errors.map(error => error.message);
  const workflow = parsed.toJS();
  const errors = [];
  if (workflow.permissions?.contents !== 'read') errors.push('Workflow must default to contents: read');
  if (!workflow.concurrency) errors.push('Workflow needs a concurrency policy');
  if (Object.hasOwn(workflow.on ?? {}, 'pull_request_target')) errors.push('Do not execute repository code with pull_request_target');
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    if (!(job['timeout-minutes'] > 0)) errors.push(`${id}: missing job timeout`);
    for (const [index, step] of (job.steps ?? []).entries()) {
      if (step.uses && !/^[^@]+@[a-f0-9]{40}$/.test(step.uses)) errors.push(`${id}: external actions must use full commit SHAs`);
      else if (step.uses && !/^\s*v\d+(?:\.\d+)*\s*$/.test(parsed.getIn(['jobs', id, 'steps', index, 'uses'], true)?.comment ?? '')) errors.push(`${id}: pinned actions need a version comment`);
      if (step['continue-on-error']) errors.push(`${id}: test steps must not ignore failures`);
      if (/--update-snapshots(?:[= ]all)?(?:\s|$)/.test(step.run ?? '')) errors.push(`${id}: CI cannot approve visual baselines`);
    }
  }
  return errors;
}
const xmlComments = /<!--[\s\S]*?-->/g;
// The browser must take its fonts from the repository's fontconfig file, whose
// rules turn system-ui and the generic sans into Liberation Sans before the
// system configuration adds its own aliases and fallbacks.
export function fontArrangementViolations(fontconfigFile, fontconfigText) {
  const expected = resolve(root, 'tests/visual/fonts.conf');
  if (fontconfigFile !== expected) return [`The browser of the visual lane must get FONTCONFIG_FILE=${expected}, not ${fontconfigFile ?? 'nothing'}`];
  const text = fontconfigText.replace(xmlComments, '');
  const include = text.search(/<include\b[^>]*>\s*\/etc\/fonts\/fonts\.conf\s*<\/include>/);
  const errors = include < 0 ? ['The fonts of the visual lane must include the system configuration /etc/fonts/fonts.conf after their own rules'] : [];
  for (const family of ['system-ui', 'sans-serif']) {
    const rule = new RegExp(`<match\\s+target="pattern">\\s*<test\\s+name="family"><string>${family}</string></test>\\s*<edit\\s+name="family"\\s+mode="assign"\\s+binding="strong"><string>Liberation Sans</string></edit>\\s*</match>`);
    const at = text.search(rule);
    if (at < 0) errors.push(`The fonts of the visual lane must assign Liberation Sans, strongly bound, to ${family}`);
    else if (include >= 0 && at > include) errors.push(`The rule for ${family} must come before the system configuration`);
  }
  return errors;
}
export function checkWorkflows() {
  const dir = resolve(root, '.github/workflows');
  const errors = readdirSync(dir).filter(name => /\.ya?ml$/.test(name)).flatMap(name => workflowViolations(readFileSync(resolve(dir, name), 'utf8')).map(error => `${name}: ${error}`));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Workflow YAML and repository safety policies passed. GitHub also validates its own workflow schema.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkWorkflows();
