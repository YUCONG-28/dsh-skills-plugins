/**
 * Structured performance telemetry (P8).
 *
 * Records per-request routing/performance facts as JSONL. Deliberately never
 * stores API keys or image content — only bytes counts, timing, route and
 * provider identifiers.
 *
 * @module dsh-vision-bridge/telemetry
 */
import { appendFileSync } from 'node:fs';

/** Allowed telemetry field names (whitelist keeps secrets out by construction). */
const ALLOWED_FIELDS = new Set([
	'ts', 'mode', 'route', 'ocr_ms', 'vision_ms', 'cache_hit', 'provider',
	'fallback_count', 'input_bytes', 'processed_bytes', 'context_tokens',
	'total_ms', 'image_count', 'error'
]);

/** Build a sanitized record from arbitrary input. */
export function sanitizeTelemetry(raw) {
	const out = {};
	for (const [key, value] of Object.entries(raw ?? {})) {
		if (!ALLOWED_FIELDS.has(key)) continue;
		if (key === 'error') {
			if (typeof value === 'string') out.error = value.slice(0, 300);
			continue;
		}
		out[key] = value;
	}
	out.ts = new Date().toISOString();
	return out;
}

/**
 * Create a telemetry sink.
 * @param opts.mode - 'off' | 'log' | 'file'.
 * @param opts.file - JSONL path (empty = ~/.dsh/vision-bridge-telemetry.jsonl).
 * @param opts.logger - cordis logger (optional).
 */
export function createTelemetry(opts) {
	const mode = opts.mode ?? 'off';
	const file = opts.file && opts.file.length > 0
		? opts.file
		: joinHome('.dsh', 'vision-bridge-telemetry.jsonl');
	return {
		mode,
		record(raw) {
			if (mode === 'off') return;
			const entry = sanitizeTelemetry(raw);
			try {
				if (mode === 'file') {
					appendFileSync(file, JSON.stringify(entry) + '\n');
				} else if (opts.logger && typeof opts.logger.debug === 'function') {
					opts.logger.debug('vision bridge telemetry: ' + JSON.stringify(entry));
				}
			} catch { /* telemetry must never break the request */ }
		}
	};
}

function joinHome(...parts) {
	const home = process.env.HOME || process.env.USERPROFILE || '';
	return [home, ...parts].filter(Boolean).join('/');
}
