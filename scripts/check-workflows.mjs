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
    for (const step of job.steps ?? []) {
      if (step.uses && !/^[^@]+@[a-f0-9]{40}$/.test(step.uses)) errors.push(`${id}: external actions must use full commit SHAs`);
      if (step['continue-on-error']) errors.push(`${id}: test steps must not ignore failures`);
      if (/--update-snapshots(?:[= ]all)?(?:\s|$)/.test(step.run ?? '')) errors.push(`${id}: CI cannot approve visual baselines`);
    }
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
