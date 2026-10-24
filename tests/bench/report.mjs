// Summaries and the Markdown table of a benchmark run (see run.mjs).

/** Median, minimum and maximum of the samples; the median of an even count is the mean of the middle two. */
export function summarise(samples) {
  if (!samples.length) return { median: NaN, min: NaN, max: NaN };
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, min: sorted[0], max: sorted[sorted.length - 1] };
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A value in its unit: milliseconds with two decimals below 10 and one below 100, otherwise whole; bytes and megabytes whole. */
export function formatValue(value, unit) {
  if (!Number.isFinite(value)) return '–';
  const digits = unit === 'ms' ? (Math.abs(value) < 10 ? 2 : Math.abs(value) < 100 ? 1 : 0) : 0;
  const text = digits ? value.toFixed(digits) : grouped.format(value);
  return `${text} ${unit}`;
}

/**
 * Whether the median meets a target that gives a numeric bound (`max`, in the
 * row's unit) or asks only that the case runs (`completes`); otherwise undefined.
 */
export function verdict(row, target) {
  if (!target) return undefined;
  if (row.error) return 'not met';
  if (target.max !== undefined) return row.median <= target.max ? 'met' : 'not met';
  if (target.completes) return 'met';
  return undefined;
}

function cell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/** The Markdown report: the run's conditions, a table per group with the reference and the target beside each row, and the sources of the references. */
export function markdown(run, reference) {
  const { meta } = run;
  const lines = [];
  lines.push('# wise-flow benchmark', '');
  lines.push(`- Commit: \`${meta.commit}\`${meta.dirty ? ' with uncommitted changes' : ''}, ${meta.date}`);
  lines.push(`- Mode: ${meta.mode}; ${meta.trials} trials after ${meta.warmup} warm-up${meta.warmup === 1 ? '' : 's'} per measurement${meta.framesPerGesture ? ` (a Canvas trial is a gesture of ${meta.framesPerGesture} frames, each frame a sample)` : ''}`);
  lines.push(`- Machine: ${meta.machine.cpu}, ${meta.machine.cores} cores, ${meta.machine.memoryGB} GB, ${meta.machine.platform} ${meta.machine.release} ${meta.machine.arch}; load average ${meta.machine.loadBefore.join(' / ')} before and ${meta.machine.loadAfter.join(' / ')} after`);
  if (meta.machine.loaded) lines.push(`- **Measured on a loaded machine:** ${meta.machine.loaded}`);
  lines.push(`- Runtime: Node ${meta.runtime.node} (V8 ${meta.runtime.v8}); browser: ${meta.browser.name} ${meta.browser.version} (Playwright ${meta.browser.playwright}, headless)`);
  lines.push(`- Library JavaScript, gzip: ${grouped.format(meta.library.javaScriptGzipBytes)} bytes`);
  lines.push('');
  lines.push('Times are medians, minima and maxima over the trials. "Before" is the number measured before the repairs of this line, "During the repairs" one recorded as they were made; see the sources below. The counted-work tests of the test suite are the gate; this table reports time and fails on nothing.', '');
  const sources = [];
  const sourceOf = (entry) => {
    if (!entry) return '';
    const key = `${entry.source} — ${entry.conditions}`;
    let index = sources.indexOf(key);
    if (index < 0) index = sources.push(key) - 1;
    return ` [${index + 1}]`;
  };
  const groups = [...new Set(run.results.map((r) => r.group))];
  for (const group of groups) {
    lines.push(`## ${group}`, '');
    lines.push('| Measurement | Measured on | Median | Min | Max | Trials | Before | During the repairs | Target |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of run.results.filter((r) => r.group === group)) {
      const ref = reference.entries[row.id] ?? {};
      const before = ref.before ? `${ref.before.text}${sourceOf(ref.before)}` : '–';
      const after = ref.after ? `${ref.after.text}${sourceOf(ref.after)}` : '–';
      const target = ref.target ? `${ref.target.text}${sourceOf(ref.target)}${verdict(row, ref.target) ? `: ${verdict(row, ref.target)}` : ''}` : '–';
      const values = row.error ? [`failed: ${row.error}`, '', ''] : [formatValue(row.median, row.unit), formatValue(row.min, row.unit), formatValue(row.max, row.unit)];
      lines.push(`| ${[row.label, row.on ?? '', ...values, row.samples?.length ?? 0, before, after, target].map(cell).join(' | ')} |`);
    }
    lines.push('');
  }
  if (sources.length) {
    lines.push('## Sources of the reference numbers', '');
    sources.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }
  if (reference.notes?.length) {
    lines.push('## Notes', '');
    for (const note of reference.notes) lines.push(`- ${note}`);
    lines.push('');
  }
  return lines.join('\n');
}
