import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseDocument } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const pinnedImage = /^[^\s@]+@sha256:[a-f0-9]{64}$/;
const containerImage = job => typeof job?.container === 'string' ? job.container : job?.container?.image;
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
    if (job.container !== undefined && !pinnedImage.test(containerImage(job) ?? '')) errors.push(`${id}: container images must be pinned by digest`);
    for (const [index, step] of (job.steps ?? []).entries()) {
      if (step.uses && !/^[^@]+@[a-f0-9]{40}$/.test(step.uses)) errors.push(`${id}: external actions must use full commit SHAs`);
      else if (step.uses && !/^\s*v\d+(?:\.\d+)*\s*$/.test(parsed.getIn(['jobs', id, 'steps', index, 'uses'], true)?.comment ?? '')) errors.push(`${id}: pinned actions need a version comment`);
      if (step['continue-on-error']) errors.push(`${id}: test steps must not ignore failures`);
      if (/--update-snapshots(?:[= ]all)?(?:\s|$)/.test(step.run ?? '')) errors.push(`${id}: CI cannot approve visual baselines`);
    }
  }
  return errors;
}
// The Linux baselines hold only in the image they were captured in: the strict
// visual job runs in that image and leaves its browser and fonts as they are.
export function visualLaneViolations(text, provenance) {
  const job = parseDocument(text).toJS()?.jobs?.visual;
  if (!job) return ['There is no job visual for the strict visual lane'];
  const errors = [];
  const image = provenance?.linux?.image;
  if (!image || containerImage(job) !== image) errors.push(`visual: must run in the image the provenance record names (${image ?? 'none recorded'})`);
  if ((job.steps ?? []).some(step => /\bplaywright\s+install\b|\bapt(?:-get)?\s+install\b/.test(step.run ?? ''))) errors.push('visual: the image brings the browser and its fonts; the job installs nothing over them');
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
  const provenance = JSON.parse(readFileSync(resolve(root, 'tests/visual/baseline-provenance.json'), 'utf8'));
  errors.push(...visualLaneViolations(readFileSync(resolve(dir, 'ci.yml'), 'utf8'), provenance).map(error => `ci.yml: ${error}`));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Workflow YAML and repository safety policies passed. GitHub also validates its own workflow schema.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) checkWorkflows();
