/**
 * install-ocr.mjs — postinstall hook (fail-soft): try to compile the Swift
 * OCR tool; any failure only logs a warning and the plugin falls back to
 * running ocr.swift through the swift interpreter.
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
try {
  const result = spawnSync('bash', [join(here, 'build-ocr.sh')], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.warn('[vision-bridge] OCR 二进制编译未完成（非致命，将使用 swift 解释执行）');
  }
} catch (error) {
  console.warn('[vision-bridge] OCR 二进制编译跳过: ' + (error?.message ?? String(error)));
}
