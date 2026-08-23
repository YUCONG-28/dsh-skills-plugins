/**
 * Local OCR pipeline (Apple Vision via Swift tool).
 *
 * P3.1/P3.2: OCR-first, compiled binary preferred (swiftc -O at install
 * time); P3.4/P3.5: adaptive resize/crop before heavy work.
 *
 * Pure-ish module: only node builtins; the DSH attachments seam is injected
 * by the caller (adapters/dsh.js).
 *
 * @module dsh-vision-bridge/ocr
 */
import { spawn } from 'node:child_process';
import { statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_BIN = join(homedir(), '.dsh', 'vision-bridge-ocr');
const DEFAULT_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ocr.swift');

/** Resolve the OCR tool command: env override > config > compiled binary > swift interpreter. */
export function resolveOcrCommand(config) {
	const envBin = process.env.VISION_BRIDGE_OCR_BIN;
	if (typeof envBin === 'string' && envBin.trim().length > 0) {
		return { command: envBin.trim(), args: [] };
	}
	if (typeof config?.ocrScript === 'string' && config.ocrScript.trim().length > 0) {
		return { command: config.ocrScript.trim(), args: [] };
	}
	try {
		statSync(DEFAULT_BIN);
		return { command: DEFAULT_BIN, args: [] };
	} catch { /* fall through */ }
	return { command: 'swift', args: [DEFAULT_SCRIPT] };
}

/** Extension for a media type (safe basename characters only). */
export function extForMediaType(mediaType) {
	if (mediaType === 'image/png') return '.png';
	if (mediaType === 'image/webp') return '.webp';
	if (mediaType === 'image/gif') return '.gif';
	return '.jpg';
}

/** Write image bytes to a temp file; caller unlinks. */
export function writeTempImage(data, mediaType, key) {
	const ext = extForMediaType(mediaType);
	const file = join(tmpdir(), `vb-${String(key ?? 'img').replace(/[^a-zA-Z0-9_-]/g, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
	writeFileSync(file, Buffer.from(data));
	return file;
}

/** Run a child process and resolve stdout JSON; null on any failure. */
export function spawnJson(command, args, { timeoutMs = 0, signal } = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			if (timer) clearTimeout(timer);
			resolve(value);
		};
		const timer = timeoutMs > 0 ? setTimeout(() => {
			try { child.kill('SIGKILL'); } catch { /* ignore */ }
			finish(null);
		}, timeoutMs) : null;
		if (signal !== void 0) {
			if (signal.aborted) { finish(null); return; }
			signal.addEventListener('abort', () => {
				try { child.kill('SIGKILL'); } catch { /* ignore */ }
				finish(null);
			}, { once: true });
		}
		child.stdout.on('data', (chunk) => { stdout += chunk; });
		child.on('error', () => finish(null));
		child.on('close', () => {
			try { finish(JSON.parse(stdout)); } catch { finish(null); }
		});
	});
}

/** Run the tool with a subcommand on an input file. */
async function runTool(config, subcommand, inputFile, extraArgs = [], signal) {
	const { command, args } = resolveOcrCommand(config);
	return spawnJson(command, [...args, subcommand, inputFile, ...extraArgs], {
		timeoutMs: config?.ocrTimeoutMs ?? 30000,
		signal
	});
}

/** Crop an image file (x,y,w,h in source pixels), writing a temp JPEG; returns path or null. */
export async function cropImage(config, inputFile, region, signal) {
	const out = join(tmpdir(), `vb-crop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
	const result = await spawnJson(resolveOcrCommand(config).command,
		[...resolveOcrCommand(config).args, 'crop', inputFile, out,
			String(Math.round(region.x ?? 0)), String(Math.round(region.y ?? 0)),
			String(Math.round(region.w ?? 0)), String(Math.round(region.h ?? 0))],
		{ timeoutMs: config?.ocrTimeoutMs ?? 30000, signal });
	if (result !== null && result.ok === true) return out;
	try { unlinkSync(out); } catch { /* ignore */ }
	return null;
}

/** Resize an image file to at most maxDim on its long edge; returns path or null. */
export async function resizeImage(config, inputFile, maxDim, signal) {
	const out = join(tmpdir(), `vb-resize-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
	const result = await spawnJson(resolveOcrCommand(config).command,
		[...resolveOcrCommand(config).args, 'resize', inputFile, out, String(Math.round(maxDim))],
		{ timeoutMs: config?.ocrTimeoutMs ?? 30000, signal });
	if (result !== null && result.ok === true) return out;
	try { unlinkSync(out); } catch { /* ignore */ }
	return null;
}

/**
 * Run local OCR on an image ref (bytes already read by caller).
 * @param data - image bytes.
 * @param ref - attachment ref (for media type / key).
 * @returns OCR result object or null.
 */
export async function runOcr(config, data, ref, { signal, region } = {}) {
	const input = writeTempImage(data, ref?.mediaType, String(ref?.attachmentId ?? 'img'));
	let active = input;
	try {
		if (region && region.w > 0 && region.h > 0) {
			const cropped = await cropImage(config, input, region, signal);
			if (cropped !== null) {
				try { unlinkSync(input); } catch { /* ignore */ }
				active = cropped;
			}
		}
		const out = await runTool(config, 'ocr', active, [], signal);
		if (out !== null && typeof out.charCount === 'number' && typeof out.text === 'string') return out;
		return null;
	} finally {
		try { unlinkSync(active); } catch { /* ignore */ }
	}
}

/** Simple cleanups helper for temp files produced by callers. */
export function removeTemp(file) {
	if (!file) return;
	try { unlinkSync(file); } catch { /* ignore */ }
}
