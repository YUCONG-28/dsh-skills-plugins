/**
 * Evidence cache: L1 memory (LRU) + L2 disk (JSONL-per-entry files).
 *
 * Keys are content-addressed: attachmentId + model + promptVersion +
 * schemaVersion (+ evidence kind), hashed with sha256. Only derived
 * structured evidence text is stored — never raw image bytes and never any
 * credential material.
 *
 * @module dsh-vision-bridge/cache
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Build a stable cache key string (pre-hash). */
export function cacheKeyParts({ attachmentId, model, promptVersion, schemaVersion, kind = 'vision' }) {
	return [String(attachmentId), String(model), Number(promptVersion ?? 0), Number(schemaVersion ?? 0), kind].join('|');
}

/** Hash a cache key into a safe file basename. */
export function hashKey(key) {
	return createHash('sha256').update(key).digest('hex');
}

/** LRU memory cache. */
export class LruMap {
	constructor(maxSize = 256) {
		this.maxSize = maxSize;
		this.map = new Map();
	}
	get(key) {
		const value = this.map.get(key);
		if (value === void 0) return void 0;
		// refresh recency
		this.map.delete(key);
		this.map.set(key, value);
		return value;
	}
	set(key, value) {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		if (this.maxSize > 0 && this.map.size > this.maxSize) {
			const oldest = this.map.keys().next().value;
			if (oldest !== void 0) this.map.delete(oldest);
		}
		return value;
	}
	has(key) { return this.map.has(key); }
	get size() { return this.map.size; }
	clear() { this.map.clear(); }
}

/**
 * Disk-backed evidence cache.
 * @param opts.diskDir - cache directory (created on demand).
 * @param opts.diskSize - max entry count (0 = unlimited).
 */
export function createDiskCache(diskDir, diskSize = 1024, logger = null) {
	let ready = false;
	try {
		mkdirSync(diskDir, { recursive: true });
		ready = true;
	} catch { /* disk cache unavailable → memory only */ }
	const file = (key) => join(diskDir, hashKey(key) + '.json');
	const trim = () => {
		if (diskSize <= 0 || !ready) return;
		try {
			const entries = readdirSync(diskDir)
				.filter((name) => name.endsWith('.json'))
				.map((name) => {
					const full = join(diskDir, name);
					let mtime = 0;
					try { mtime = statSync(full).mtimeMs; } catch { /* ignore */ }
					return { name, full, mtime };
				})
				.sort((a, b) => a.mtime - b.mtime);
			while (entries.length > diskSize) {
				const oldest = entries.shift();
				if (oldest === void 0) break;
				try { unlinkSync(oldest.full); } catch { /* ignore */ }
			}
		} catch { /* ignore */ }
	};
	return {
		available: ready,
		get(key) {
			if (!ready) return void 0;
			try {
				const raw = readFileSync(file(key), 'utf8');
				return JSON.parse(raw);
			} catch { return void 0; }
		},
		set(key, entry) {
			if (!ready) return;
			try {
				const path = file(key);
				const tmp = path + '.tmp';
				writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600 });
				renameSync(tmp, path);
				trim();
			} catch { /* ignore */ }
		},
		clear() {
			if (!ready) return;
			try {
				for (const name of readdirSync(diskDir)) {
					if (name.endsWith('.json') || name.endsWith('.tmp')) {
						try { unlinkSync(join(diskDir, name)); } catch { /* ignore */ }
					}
				}
			} catch { /* ignore */ }
		},
		dir: diskDir
	};
}

/**
 * Two-level cache facade.
 * @param opts.memorySize - L1 cap.
 * @param opts.diskDir - L2 dir (empty string disables disk).
 * @param opts.diskSize - L2 cap.
 */
export function createCache(opts) {
	const memory = new LruMap(opts.memorySize ?? 256);
	const disk = opts.diskDir ? createDiskCache(opts.diskDir, opts.diskSize ?? 1024, opts.logger ?? null) : null;
	const stats = { hits: 0, misses: 0 };
	return {
		stats,
		memory,
		disk,
		get(key) {
			const hit = memory.get(key);
			if (hit !== void 0) { stats.hits++; return hit; }
			const fromDisk = disk !== null ? disk.get(key) : void 0;
			if (fromDisk !== void 0) {
				stats.hits++;
				memory.set(key, fromDisk);
				return fromDisk;
			}
			stats.misses++;
			return void 0;
		},
		set(key, entry) {
			memory.set(key, entry);
			if (disk !== null) disk.set(key, entry);
			return entry;
		},
		clear() {
			memory.clear();
			if (disk !== null) disk.clear();
		}
	};
}
