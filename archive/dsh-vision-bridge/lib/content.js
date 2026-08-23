/**
 * Provider-neutral message/content vocabulary helpers.
 *
 * These helpers only know the *shape* of harness content blocks (text, image,
 * tool-result, ...). They intentionally import nothing from @deepseek-ai/* so
 * the plugin can keep working when DSH changes the surrounding API surface.
 *
 * @module dsh-vision-bridge/content
 */

/** True when typed model content contains an image block, walking nested tool-result content. */
export function contentHasImage(content) {
	if (!Array.isArray(content)) return false;
	return content.some((block) =>
		block !== null && typeof block === 'object'
		&& (block.type === 'image'
			|| (block.type === 'tool-result' && contentHasImage(block.content)))
	);
}

/** True when any message in the list carries an image (including nested tool results). */
export function messagesHaveImages(messages) {
	return Array.isArray(messages) && messages.some((message) =>
		message !== null && typeof message === 'object' && contentHasImage(message.content)
	);
}

/** Collect image attachment refs, deduplicated by attachmentId, in first-seen order. */
export function collectImageRefs(messages) {
	const seen = new Set();
	const refs = [];
	const walk = (content) => {
		if (!Array.isArray(content)) return;
		for (const block of content) {
			if (block === null || typeof block !== 'object') continue;
			if (block.type === 'image' && block.attachment !== null && typeof block.attachment === 'object') {
				const id = String(block.attachment.attachmentId ?? '');
				if (id && !seen.has(id)) {
					seen.add(id);
					refs.push(block.attachment);
				}
			} else if (block.type === 'tool-result') {
				walk(block.content);
			}
		}
	};
	for (const message of messages ?? []) walk(message?.content);
	return refs;
}

/**
 * Map image blocks to replacement content blocks (sync or async mapper).
 * Tool-result blocks are recursed into; all other blocks pass through.
 */
export async function transformContent(content, onImage) {
	const out = [];
	for (const block of content) {
		if (block === null || typeof block !== 'object') { out.push(block); continue; }
		if (block.type === 'image') {
			const replacement = await onImage(block.attachment);
			if (Array.isArray(replacement)) out.push(...replacement);
			else out.push(replacement);
		} else if (block.type === 'tool-result') {
			out.push({ ...block, content: await transformContent(block.content ?? [], onImage) });
		} else {
			out.push(block);
		}
	}
	return out;
}

/** Map every message's content through {@link transformContent}, preserving message envelopes. */
export async function transformMessages(messages, onImage) {
	const out = [];
	for (const message of messages ?? []) {
		out.push({ ...message, content: await transformContent(message.content ?? [], onImage) });
	}
	return out;
}

/** Flatten text blocks of one message into a single string (context for caption prompts). */
export function flattenText(blocks) {
	return (blocks ?? [])
		.filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
		.map((block) => block.text ?? '')
		.join('');
}

/** Sum of encoded bytes across image refs (telemetry input_bytes). */
export function imageBytes(refs) {
	let total = 0;
	for (const ref of refs ?? []) total += typeof ref.bytes === 'number' ? ref.bytes : 0;
	return total;
}
