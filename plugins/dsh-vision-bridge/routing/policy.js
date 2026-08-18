/**
 * Routing policy (P1/P3.12): pure decision functions.
 *
 * Decides, per request, whether to:
 *  - 'backend'          — no images → DeepSeek directly
 *  - 'vision-whole-turn' — strong visual task (or legacy native) → Qwen VL whole turn
 *  - 'evidence'         — default: local OCR / cached structured evidence → DeepSeek
 *
 * @module dsh-vision-bridge/routing
 */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;
const IMAGE_TOKEN_OVERHEAD = 1600;
const SYSTEM_AND_TOOLS_OVERHEAD = 12000;

/** Rough token estimate: CJK char ≈ 1 token, other char ≈ 0.25 token. */
function estimateTextTokens(text) {
	let tokens = 0;
	for (const ch of text) tokens += CJK_RE.test(ch) ? 1 : 0.25;
	return Math.ceil(tokens);
}

/** Rough input-token estimate for a message array (text/image/tool blocks). */
export function estimateMessageTokens(messages) {
	let tokens = 0;
	for (const message of messages ?? []) {
		for (const block of message.content ?? []) {
			if (block?.type === 'text') tokens += estimateTextTokens(block.text ?? '');
			else if (block?.type === 'image') tokens += IMAGE_TOKEN_OVERHEAD;
			else if (block?.type === 'tool-result') tokens += estimateMessageTokens([{ content: block.content }]);
			else if (block?.type === 'tool-call') tokens += estimateTextTokens(block.arguments ?? '');
		}
	}
	return tokens;
}

/** Whole-turn context budget check. */
export function contextAllowsNative(estimatedTokens, contextWindow, ratio) {
	if (ratio == null || ratio <= 0 || contextWindow <= 0) return true;
	return estimatedTokens <= Math.floor(contextWindow * ratio);
}

/** Extract the last user message text (owner text for caption prompts). */
export function lastUserText(messages) {
	for (let index = (messages?.length ?? 0) - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === 'user') {
			return (message.content ?? [])
				.filter((block) => block?.type === 'text')
				.map((block) => block.text ?? '')
				.join('');
		}
	}
	return '';
}

/** Whether the turn is a strong visual task (keyword heuristic). */
export function isStrongVisual(messages, keywords) {
	const text = lastUserText(messages).toLowerCase();
	if (text.length === 0) return false;
	const list = Array.isArray(keywords) && keywords.length > 0 ? keywords : [];
	for (const keyword of list) {
		const k = String(keyword).toLowerCase();
		if (k.length > 0 && text.includes(k)) return true;
	}
	return false;
}

/**
 * Decide the route for one request.
 * @param args.mode - 'auto' | 'native' | 'caption' | 'off'.
 * @param args.wholeTurn - 'auto' | 'never' | 'always'.
 * @param args.hasImage - whether the request carries image blocks.
 * @param args.messages - request messages (for token estimate + strong visual).
 * @param args.visionAcceptsImage - whether the configured vision model accepts images.
 * @param args.contextWindow - vision model context window (0 = unknown).
 * @param args.ratio - nativeContextRatio.
 * @param args.keywords - strong-visual keywords.
 */
export function decideRoute({ mode, wholeTurn, hasImage, messages, visionAcceptsImage, contextWindow, ratio, keywords }) {
	if (mode === 'off' || !hasImage) return 'backend';
	if (!visionAcceptsImage) return 'evidence';
	const allowWholeTurn = wholeTurn === 'always'
		|| wholeTurn === 'auto' && isStrongVisual(messages, keywords)
		|| mode === 'native';
	if (!allowWholeTurn) return 'evidence';
	const estimated = estimateMessageTokens(messages) + SYSTEM_AND_TOOLS_OVERHEAD;
	if (!contextAllowsNative(estimated, contextWindow, ratio)) return 'evidence';
	return 'vision-whole-turn';
}

/** Evidence key builder (P3.6): attachmentId + model + promptVersion + schemaVersion + kind. */
export function evidenceKind(config, source) {
	return source === 'ocr' ? 'ocr' : 'vision';
}