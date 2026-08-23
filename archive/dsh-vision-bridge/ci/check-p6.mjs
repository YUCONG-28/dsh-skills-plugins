/**
 * ci/check-p6.mjs — P6 static audit.
 *
 * Verifies:
 *  1) schemastery-only schema style: no old-style JSON-Schema unions
 *     (type: ['object', 'null'] ...) anywhere in plugin source;
 *  2) only @deepseek-ai/schemastery may be imported from @deepseek-ai/*;
 *  3) no @deepseek-ai internal-path imports (e.g. pkg/lib/...).
 *
 * Usage: node ci/check-p6.mjs <plugin-root>
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.argv[2] ?? '.';
const dirs = ['lib', 'adapters', 'routing', 'ocr', 'providers', 'evidence', 'cache', 'telemetry', 'compat', 'scripts'];
const allowedScoped = new Set(['@deepseek-ai/schemastery']);
const problems = [];

function walk(dir) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		const stat = statSync(full);
		if (stat.isDirectory()) walk(full);
		else if (/.(js|mjs)$/.test(entry)) auditFile(full);
	}
}

function auditFile(file) {
	const source = readFileSync(file, 'utf8');
	const lines = source.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/\btype\s*:\s*\[\s*['"]/.test(line)) {
			problems.push(file + ':' + (i + 1) + ' old-style JSON-Schema union: ' + line.trim().slice(0, 100));
		}
		const scoped = line.match(/from\s+['"](@deepseek-ai\/[^'"]+)['"]/);
		if (scoped) {
			if (!allowedScoped.has(scoped[1])) {
				problems.push(file + ':' + (i + 1) + ' disallowed @deepseek-ai import: ' + scoped[1]);
			}
			if (/\/lib\//.test(scoped[1]) || /\/src\//.test(scoped[1])) {
				problems.push(file + ':' + (i + 1) + ' internal-path import: ' + scoped[1]);
			}
		}
	}
}

for (const dir of dirs) {
	const full = join(root, dir);
	try { walk(full); } catch { /* missing dir */ }
}
if (problems.length > 0) {
	console.error('[P6] FAIL');
	for (const p of problems) console.error('  - ' + p);
	process.exit(1);
}
console.log('[P6] OK — schemastery-only schema, no internal @deepseek-ai imports');