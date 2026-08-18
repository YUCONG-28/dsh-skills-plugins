import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
//#region src/host/index.ts
/**
* dsh-web-pets —— DSH Web 桌宠插件（宿主侧）
*
* 在 DSH Web 界面里养一只桌宠：订阅会话事件驱动宠物状态（thinking /
* running / success / idle / waiting），通过同源 JSON 接口 /api/web-pets/* 暴露状态与
* 配置，经 /web-pets-assets/<pet>/emotes/* 提供自定义宠物素材（内置宠物素材内联
* 在客户端 bundle 中，见 scripts/generate-art.mjs）。
*
* 事件 → 状态映射（与 desktop-pets 原生版的联动协议一致）：
*   step/start         → thinking
*   tool/call          → running + 气泡「工具 · 参数预览」
*   turn/end completed → success（4 秒后自动回 idle）
*   turn/end 其他      → idle（中止/失败回合清掉工作姿态与气泡）
*   session/disposed   → idle + 清气泡
*   idle 超过 2 分钟   → waiting（派生状态，读 /state 时计算）
*
* 自更新闭环（monorepo link 形态）：
*   GET  /api/web-pets/info    -> 安装形态 + 版本 + 更新命令预览
*   GET  /api/web-pets/check   -> 查询 GitHub release/tag（直连 + pinned + 代理回退）
*   POST /api/web-pets/update  -> git pull + fix-web-profile.sh（仅 link 形态、仅本机请求）
*
* @module dsh-web-pets
*/
/** 插件条目 id（cordis 身份，与 cordis.patch.yml 的 insert id 一致）。 */
const name = "web-pets";
/** 依赖的服务：webServer（HTTP 路由）+ sessions（会话事件源）。 */
const inject = ["webServer", "sessions"];
/** 包根目录（构建产物 lib/index.js → 包根；dirname(dirname(import.meta.url))）。 */
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** 宠物素材根目录。 */
const PETS_DIR = join(PACKAGE_ROOT, "assets", "pets");
/** 配置持久化路径。 */
const CONFIG_PATH = join(process.env.HOME ?? "", ".config", "dsh-web-pets.json");
/** 浏览器侧 API 前缀。 */
const API_PREFIX = "/api/web-pets";
/** 浏览器侧素材前缀。 */
const ASSET_PREFIX = "/web-pets-assets";
/** success 状态停留后自动回 idle 的毫秒数。 */
const SUCCESS_IDLE_MS = 4e3;
/** 点击互动气泡停留毫秒数。 */
const PET_FEEDBACK_MS = 1500;
/** idle 持续多久后进入 waiting（派生状态）的毫秒数。 */
const IDLE_WAITING_MS = 12e4;
/** 默认活动宠物（注册表扫描不到时兜底）。 */
const DEFAULT_PET = "demo";
/** 宠物状态集合。 */
const STATE_IDS = [
	"idle",
	"thinking",
	"waiting",
	"running",
	"success"
];
/** 自更新相关常量（monorepo 公开仓库）。 */
const REPO = "YUCONG-28/dsh-skills-plugins";
const PKG = "dsh-web-pets";
const GITHUB = `https://github.com/${REPO}`;
const RELEASES_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const TAGS_API = `https://api.github.com/repos/${REPO}/tags`;
/** 该插件的版本 tag 前缀（如 web-pets-v0.2.0）。 */
const TAG_PREFIX = "web-pets-v";
/** 更新命令超时（秒）。 */
const UPDATE_TIMEOUT_MS = 12e4;
/** 大小下限（px）。 */
const SIZE_MIN = 32;
/** 大小上限（px）。 */
const SIZE_MAX = 512;
/** 右/下内边距上限（px）。 */
const INSET_MAX = 1e4;
/** 自定义显示名最大长度。 */
const NAME_MAX_LENGTH = 20;
/** 当前包版本（供 /info 与更新对比）。 */
let PKG_VERSION = "0.0.1";
try {
	const pj = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
	if (pj && typeof pj.version === "string") PKG_VERSION = pj.version;
} catch {}
/** 当前宠物状态快照。 */
let petState = {
	state: "idle",
	bubble: "",
	activePet: DEFAULT_PET,
	visible: true,
	size: 160,
	/** 距视口右缘的内边距（px），与官方 dsh-pet 参数一致。 */
	right: 24,
	/** 距视口下缘的内边距（px），与官方 dsh-pet 参数一致。 */
	bottom: 20,
	/** 自定义显示名（空 = 使用宠物 display_name）。 */
	name: "",
	/** 水平镜像（左右翻转），与原生 desktop-pets mirror_x 语义一致。 */
	mirrorX: false,
	/** 垂直镜像（上下翻转），与原生 desktop-pets mirror_y 语义一致。 */
	mirrorY: false,
	/** 当前正在执行的工具名（tool/call 时写入，供状态行/调试显示）。 */
	tool: "",
	/** 主开关：false 时客户端完全不渲染（无悬浮宠、无召唤按钮）。 */
	enabled: true,
	/** 客户端 DOM 增强信号（等待卡片/think/output 细分），默认关闭。 */
	domSignals: false,
	/** 进入 idle 的时间戳（派生 waiting 用）。 */
	idleSince: Date.now(),
	updatedAt: Date.now()
};
/** 成功回 idle 与点击气泡的定时器。 */
let successTimer;
let feedbackTimer;
/** enabled 是否被显式配置过（决定客户端首次加载是否自动让位于上游宠物）。 */
let enabledConfigured = false;
/** 读取持久化配置（缺失/损坏回退默认，任何情况不抛错）。 */
function loadConfig() {
	try {
		const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		if (cfg && typeof cfg === "object") {
			if (cfg.visible === false) petState.visible = false;
			if (cfg.enabled === false || cfg.enabled === true) {
				petState.enabled = cfg.enabled;
				enabledConfigured = true;
			}
			if (typeof cfg.size === "number" && cfg.size > 0) petState.size = cfg.size;
			if (typeof cfg.right === "number" && cfg.right >= 0) petState.right = cfg.right;
			if (typeof cfg.bottom === "number" && cfg.bottom >= 0) petState.bottom = cfg.bottom;
			if (typeof cfg.name === "string" && cfg.name !== "") petState.name = Array.from(cfg.name).slice(0, NAME_MAX_LENGTH).join("");
			if (cfg.mirrorX === true) petState.mirrorX = true;
			if (cfg.mirrorY === true) petState.mirrorY = true;
			if (typeof cfg.activePet === "string" && cfg.activePet !== "") petState.activePet = cfg.activePet;
			if (cfg.domSignals === true) petState.domSignals = true;
		}
	} catch {}
}
/** 持久化配置（原子写）。 */
function saveConfig() {
	try {
		enabledConfigured = true;
		writeFileSync(CONFIG_PATH, JSON.stringify({
			visible: petState.visible,
			enabled: petState.enabled,
			size: petState.size,
			activePet: petState.activePet,
			right: petState.right,
			bottom: petState.bottom,
			name: petState.name,
			mirrorX: petState.mirrorX,
			mirrorY: petState.mirrorY,
			domSignals: petState.domSignals
		}, null, 2), "utf8");
	} catch {}
}
/** 注册表缓存：按目录名 + pet.json mtime 组成 key，变化时重扫。 */
let petsCache = null;
let petsCacheKey = "";
/** 计算注册表缓存 key（排序保证稳定）。 */
function petsCacheKeyOf() {
	try {
		const dirs = readdirSync(PETS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
		let key = "";
		for (const name of dirs) {
			key += name + ":";
			try {
				const st = statSync(join(PETS_DIR, name, "pet.json"));
				key += st.mtimeMs + ";";
			} catch {
				key += "0;";
			}
		}
		return key;
	} catch {
		return "";
	}
}
/** 扫描宠物注册表：返回 [{id, displayName, description, emotes}]（带缓存）。 */
function listPets() {
	try {
		const key = petsCacheKeyOf();
		if (petsCache && petsCacheKey === key) return petsCache;
		const result = readdirSync(PETS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((d) => {
			try {
				const spec = JSON.parse(readFileSync(join(PETS_DIR, d.name, "pet.json"), "utf8"));
				if (spec && typeof spec === "object") return {
					id: d.name,
					displayName: typeof spec.display_name === "string" ? spec.display_name : d.name,
					description: typeof spec.description === "string" ? spec.description : "",
					emotes: spec.emotes && typeof spec.emotes === "object" ? spec.emotes : {}
				};
			} catch {}
			return null;
		}).filter(Boolean);
		petsCache = result;
		petsCacheKey = key;
		return result;
	} catch {
		return [];
	}
}
/** 活动宠物在注册表中不存在时回退第一个可用宠物（或默认）。 */
function ensureActivePet() {
	const pets = listPets();
	if (pets.length === 0) return;
	if (!pets.some((p) => p.id === petState.activePet)) {
		petState.activePet = pets[0].id;
		saveConfig();
	}
}
/** 设置宠物状态并更新时间戳（success 自动回 idle；idle 记录 idleSince）。 */
function setPetState(s) {
	if (!STATE_IDS.includes(s)) return;
	petState.state = s;
	petState.updatedAt = Date.now();
	if (s === "idle") petState.idleSince = Date.now();
	else petState.idleSince = 0;
	if (s === "success") {
		clearTimeout(successTimer);
		successTimer = setTimeout(() => {
			if (petState.state === "success") setPetState("idle");
		}, SUCCESS_IDLE_MS);
	}
}
/** 派生状态：idle 持续超过 IDLE_WAITING_MS → waiting。 */
function effectiveState() {
	if (petState.state === "idle" && petState.idleSince > 0 && Date.now() - petState.idleSince > IDLE_WAITING_MS) return "waiting";
	return petState.state;
}
/** 设置气泡文字并安排自动清除。 */
function setBubble(text) {
	petState.bubble = text;
	clearTimeout(feedbackTimer);
	if (text !== "") feedbackTimer = setTimeout(() => {
		petState.bubble = "";
		petState.updatedAt = Date.now();
	}, PET_FEEDBACK_MS * 2);
}
/** 截断为 90 字符、压平换行与空白（与桌面版插件一致）。 */
function truncate90(s) {
	const cleaned = String(s).replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();
	return Array.from(cleaned).slice(0, 90).join("");
}
/** 从 tool/call 的 arguments JSON 里取一段预览（通用兜底：首个字符串值）。 */
function toolArgsPreview(argumentsJson) {
	if (typeof argumentsJson !== "string" || argumentsJson === "") return "";
	try {
		const parsed = JSON.parse(argumentsJson);
		if (typeof parsed === "string" && parsed !== "") return parsed;
		if (typeof parsed === "object" && parsed !== null) {
			for (const value of Object.values(parsed)) if (typeof value === "string" && value !== "") return value;
		}
		return "";
	} catch {
		return truncate90(argumentsJson);
	}
}
/** 从解析后的 arguments 按候选键取首个字符串值（支持对象值内取首个字符串）。 */
function pickField(obj, candidates) {
	if (!obj || typeof obj !== "object") return "";
	for (const key of candidates) {
		const value = obj[key];
		if (typeof value === "string" && value !== "") return value;
		if (value && typeof value === "object" && !Array.isArray(value)) {
			for (const v of Object.values(value)) if (typeof v === "string" && v !== "") return v;
		}
	}
	return "";
}
/**
* 常见工具展示映射：运行时 tool/call 时按工具类型展示有意义信息
* （bash → 命令、read → 文件路径、web_search → 查询词…）。
* 键为真实事件里的工具名（小写）；未列出的工具走通用回退。
*/
const TOOL_PRESENTATION = {
	bash: {
		icon: "🖥",
		label: "命令",
		fields: ["command"]
	},
	read: {
		icon: "📖",
		label: "读取",
		fields: ["file_path", "path"]
	},
	write: {
		icon: "✏️",
		label: "写入",
		fields: ["file_path", "path"]
	},
	edit: {
		icon: "✏️",
		label: "修改",
		fields: ["file_path", "path"]
	},
	glob: {
		icon: "🔎",
		label: "匹配",
		fields: ["pattern"]
	},
	grep: {
		icon: "🔍",
		label: "搜索",
		fields: ["pattern", "path"]
	},
	stat: {
		icon: "📁",
		label: "查看",
		fields: ["path", "file_path"]
	},
	list: {
		icon: "📁",
		label: "列表",
		fields: ["path", "directory"]
	},
	web_search: {
		icon: "🌐",
		label: "搜索",
		fields: ["query"]
	},
	todo_write: {
		icon: "📋",
		label: "待办",
		fields: []
	},
	ssh_exec: {
		icon: "🖥",
		label: "远程命令",
		fields: ["command", "alias"]
	},
	ssh_upload: {
		icon: "📤",
		label: "上传",
		fields: ["localPath", "remotePath"]
	},
	ssh_download: {
		icon: "📥",
		label: "下载",
		fields: ["remotePath", "localPath"]
	},
	ssh_tunnel: {
		icon: "🔀",
		label: "隧道",
		fields: ["remotePort", "alias"]
	},
	ssh_list: {
		icon: "📋",
		label: "主机列表",
		fields: ["query"]
	}
};
/** 按工具类型生成气泡文案；未知工具回退「🛠 工具名 · 参数预览」。 */
function toolBubble(name, argumentsJson) {
	const toolName = typeof name === "string" && name !== "" ? name : "tool";
	const pres = TOOL_PRESENTATION[toolName] ?? null;
	let detail = "";
	if (typeof argumentsJson === "string" && argumentsJson !== "") try {
		const parsed = JSON.parse(argumentsJson);
		if (pres && pres.fields.length > 0) detail = pickField(parsed, pres.fields);
		if (detail === "") detail = toolArgsPreview(argumentsJson);
	} catch {
		detail = truncate90(argumentsJson);
	}
	if (pres) {
		const head = pres.label ? `${pres.icon} ${pres.label}` : pres.icon;
		return detail !== "" ? `${head} · ${truncate90(detail)}` : `${head} · ${toolName}`;
	}
	return detail !== "" ? `🛠 ${toolName} · ${truncate90(detail)}` : `🛠 ${toolName}`;
}
/** 会话事件 → 宠物状态（与桌面版联动协议一致）。 */
function onSessionEvent(_session, event) {
	try {
		if (event == null || typeof event.type !== "string") return;
		switch (event.type) {
			case "step/start":
				setPetState("thinking");
				break;
			case "tool/call": {
				const toolName = String(event.data?.name ?? "tool");
				petState.tool = toolName;
				setPetState("running");
				setBubble(toolBubble(toolName, event.data?.arguments));
				break;
			}
			case "turn/end": if (event.data?.reason?.kind === "completed") {
				setPetState("success");
				setBubble("🎉 完成！");
			} else {
				petState.tool = "";
				petState.bubble = "";
				setPetState("idle");
			}
		}
	} catch {}
}
/** 会话销毁：回 idle 并清气泡。 */
function onSessionDisposed() {
	try {
		petState.tool = "";
		petState.bubble = "";
		setPetState("idle");
	} catch {}
}
/** 写 JSON 响应。 */
function json(res, status, body) {
	try {
		res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(body));
	} catch {}
}
/** 校验请求方法，不匹配时回 405。 */
function requireMethod(req, res, method) {
	if (req.method === method) return true;
	json(res, 405, {
		ok: false,
		error: "method-not-allowed"
	});
	return false;
}
/** 读取 JSON 请求体（限 64KB）。 */
function readJsonBody(req) {
	return new Promise((resolvePromise, rejectPromise) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > 65536) {
				rejectPromise(/* @__PURE__ */ new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			if (chunks.length === 0) {
				resolvePromise({});
				return;
			}
			try {
				resolvePromise(JSON.parse(Buffer.concat(chunks).toString("utf8")));
			} catch {
				rejectPromise(/* @__PURE__ */ new Error("invalid-json"));
			}
		});
		req.on("error", rejectPromise);
	});
}
/** 仅接受来自本机 GUI 的请求（CSRF 防护，参考 dsh-pet-remielle）。 */
function localHostOk(req) {
	const host = req.headers?.host || "";
	return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}
/** 写路由的统一包装：非本机请求一律 403。 */
async function withLocalGuard(req, res, fn) {
	if (!localHostOk(req)) {
		json(res, 403, {
			ok: false,
			error: "forbidden: local-only"
		});
		return;
	}
	try {
		await fn();
	} catch (error) {
		json(res, 400, {
			ok: false,
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
/** 本地 HTTP 代理候选（按优先级）。 */
function proxyCandidates() {
	const out = [];
	for (const key of [
		"HTTPS_PROXY",
		"https_proxy",
		"HTTP_PROXY",
		"http_proxy",
		"ALL_PROXY",
		"all_proxy"
	]) {
		const v = process.env[key];
		if (v && typeof v === "string" && v.includes("://")) try {
			const u = new URL(v);
			out.push(`${u.hostname}:${u.port || (u.protocol === "http:" ? 80 : 443)}`);
		} catch {}
	}
	for (const p of [
		"127.0.0.1:7890",
		"127.0.0.1:7897",
		"127.0.0.1:10809",
		"127.0.0.1:1080"
	]) if (!out.includes(p)) out.push(p);
	return out;
}
function isProxyUp(hostPort, timeoutMs = 600) {
	const [host, port] = hostPort.split(":");
	return new Promise((resolvePromise) => {
		let done = false;
		const finish = (v) => {
			if (done) return;
			done = true;
			resolvePromise(v);
		};
		const servername = /^\d+\.\d+\.\d+\.\d+$/.test(host) ? void 0 : host;
		const sock = tls.connect({
			host,
			port: Number(port) || 443,
			servername,
			rejectUnauthorized: false,
			timeout: timeoutMs
		});
		sock.once("secureConnect", () => {
			sock.destroy();
			finish(true);
		});
		sock.once("timeout", () => {
			sock.destroy();
			finish(false);
		});
		sock.once("error", () => {
			sock.destroy();
			finish(false);
		});
	});
}
function httpsGetViaProxy(url, proxyHostPort, timeoutMs = 12e3) {
	return new Promise((resolvePromise, rejectPromise) => {
		const u = new URL(url);
		const [ph, pp] = proxyHostPort.split(":");
		const targetHost = u.hostname;
		const targetPort = u.port || "443";
		const connectReq = http.request({
			host: ph,
			port: Number(pp) || 8080,
			method: "CONNECT",
			path: `${targetHost}:${targetPort}`,
			headers: { Host: `${targetHost}:${targetPort}` },
			timeout: timeoutMs
		});
		connectReq.on("connect", (res, socket) => {
			if (res.statusCode !== 200) {
				socket.destroy();
				rejectPromise(/* @__PURE__ */ new Error(`proxy CONNECT failed: ${res.statusCode}`));
				return;
			}
			const tlsSocket = tls.connect({
				socket,
				servername: /^\d+\.\d+\.\d+\.\d+$/.test(targetHost) ? void 0 : targetHost,
				timeout: timeoutMs
			}, () => {
				const req = https.request({
					socket: tlsSocket,
					method: "GET",
					path: u.pathname + u.search,
					headers: {
						"User-Agent": "dsh-web-pets",
						Accept: "application/vnd.github+json",
						Host: targetHost
					}
				}, (resp) => {
					let body = "";
					resp.on("data", (d) => body += String(d));
					resp.on("end", () => resolvePromise({
						status: resp.statusCode || 0,
						body
					}));
				});
				req.on("error", (err) => rejectPromise(err));
				req.end();
			});
			tlsSocket.on("error", (err) => rejectPromise(err));
		});
		connectReq.on("timeout", () => {
			connectReq.destroy();
			rejectPromise(/* @__PURE__ */ new Error("proxy connect timeout"));
		});
		connectReq.on("error", (err) => rejectPromise(err));
		connectReq.end();
	});
}
async function httpsGetDirect(url, timeoutMs = 5e3) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			headers: {
				"User-Agent": "dsh-web-pets",
				Accept: "application/vnd.github+json"
			},
			signal: ctrl.signal
		});
		return {
			status: res.status,
			body: await res.text()
		};
	} finally {
		clearTimeout(t);
	}
}
function httpsGetPinned(url, hostPort, timeoutMs = 12e3) {
	return new Promise((resolvePromise, rejectPromise) => {
		const u = new URL(url);
		const [ph, pp] = hostPort.split(":");
		const servername = /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) ? void 0 : u.hostname;
		const req = https.request({
			host: ph,
			port: Number(pp) || 443,
			servername,
			rejectUnauthorized: false,
			method: "GET",
			path: u.pathname + u.search,
			headers: {
				Host: u.hostname,
				"User-Agent": "dsh-web-pets",
				Accept: "application/vnd.github+json"
			},
			timeout: timeoutMs
		}, (resp) => {
			let body = "";
			resp.on("data", (d) => body += String(d));
			resp.on("end", () => resolvePromise({
				status: resp.statusCode || 0,
				body
			}));
		});
		req.on("timeout", () => {
			req.destroy();
			rejectPromise(/* @__PURE__ */ new Error("pinned request timeout"));
		});
		req.on("error", (err) => rejectPromise(err));
		req.end();
	});
}
/** 简单语义化版本比较：a > b 返回 true。 */
function semverGt(a, b) {
	const pa = String(a).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
	const pb = String(b).replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const x = pa[i] || 0;
		const y = pb[i] || 0;
		if (x !== y) return x > y;
	}
	return false;
}
/**
* 拉取远端最新版本：优先 releases/latest，回退 tags 中 TAG_PREFIX 前缀的最高版本。
* 网络策略：直连 → Steam++/Watt pinned(127.0.0.1:443) → 常见本地代理。
*/
async function fetchRemoteLatest() {
	const attempt = async (fetchFn) => {
		try {
			const rel = await fetchFn(RELEASES_API);
			if (rel.status === 200) {
				const j = JSON.parse(rel.body);
				if (j && typeof j.tag_name === "string") return {
					latest: j.tag_name,
					notes: typeof j.body === "string" ? j.body : "",
					htmlUrl: typeof j.html_url === "string" ? j.html_url : GITHUB + "/releases"
				};
			}
			const tags = await fetchFn(TAGS_API);
			if (tags.status === 200) {
				const arr = JSON.parse(tags.body);
				if (Array.isArray(arr) && arr.length > 0) {
					const best = arr.map((t) => t && typeof t.name === "string" ? t.name : "").filter((n) => n.startsWith(TAG_PREFIX) && /\d+\.\d+\.\d+/.test(n)).sort((a, b) => semverGt(a.slice(10), b.slice(10)) ? -1 : 1)[0] || (arr[0] && typeof arr[0].name === "string" ? arr[0].name : "");
					if (best) return {
						latest: best,
						notes: "",
						htmlUrl: GITHUB + "/releases"
					};
				}
			}
			return null;
		} catch {
			return null;
		}
	};
	const direct = await attempt(httpsGetDirect);
	if (direct) return direct;
	try {
		const pinned = await attempt((u) => httpsGetPinned(u, "127.0.0.1:443"));
		if (pinned) return pinned;
	} catch {}
	for (const hostPort of proxyCandidates()) {
		if (!await isProxyUp(hostPort)) continue;
		const via = await attempt((u) => httpsGetViaProxy(u, hostPort));
		if (via) return via;
	}
	return null;
}
/** 安装形态：link（monorepo 源码目录）或 profile（node_modules 副本）。 */
function resolveInstall() {
	const here = fileURLToPath(import.meta.url);
	const pkgDir = dirname(dirname(here));
	const marker = join("node_modules", "");
	if (pkgDir.includes(marker)) return {
		mode: "profile",
		version: PKG_VERSION,
		profileDir: pkgDir.slice(0, pkgDir.indexOf(marker))
	};
	let repoDir = pkgDir;
	let cur = dirname(pkgDir);
	while (cur !== dirname(cur)) {
		if (existsSync(join(cur, "fix-web-profile.sh"))) {
			repoDir = cur;
			break;
		}
		cur = dirname(cur);
	}
	return {
		mode: "link",
		version: PKG_VERSION,
		repoDir
	};
}
/** 运行更新命令（git pull + fix-web-profile.sh），带超时与输出截断。 */
function runUpdate(repoDir) {
	return new Promise((resolvePromise) => {
		const steps = [{
			cmd: "git",
			args: [
				"-C",
				repoDir,
				"pull",
				"--ff-only"
			]
		}, {
			cmd: "bash",
			args: [join(repoDir, "fix-web-profile.sh")]
		}];
		const outputs = [];
		const next = (i) => {
			if (i >= steps.length) {
				resolvePromise({
					ok: true,
					output: outputs.join("\n")
				});
				return;
			}
			const { cmd, args } = steps[i];
			let settled = false;
			let out = "";
			const finish = (ok) => {
				if (settled) return;
				settled = true;
				outputs.push(`$ ${cmd} ${args.join(" ")} [${ok ? "ok" : "fail"}]\n${out.slice(-4e3)}`);
				if (!ok) {
					resolvePromise({
						ok: false,
						output: outputs.join("\n")
					});
					return;
				}
				next(i + 1);
			};
			let child;
			try {
				child = spawn(cmd, args, {
					cwd: repoDir,
					windowsHide: true
				});
			} catch (err) {
				out = String(err);
				finish(false);
				return;
			}
			child.stdout?.on("data", (d) => out += String(d));
			child.stderr?.on("data", (d) => out += String(d));
			child.on("error", (err) => {
				out += "\n" + String(err.message);
				finish(false);
			});
			child.on("close", (code) => finish(code === 0));
			setTimeout(() => {
				if (!settled) {
					try {
						child.kill();
					} catch {}
					out += "\n[timeout after " + Math.round(UPDATE_TIMEOUT_MS / 1e3) + "s]";
					finish(false);
				}
			}, UPDATE_TIMEOUT_MS).unref();
		};
		next(0);
	});
}
/** 组装全部路由（API + 素材）。 */
function makeRoutes() {
	const apiRoutes = [
		{
			kind: "exact",
			path: `${API_PREFIX}/state`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "GET")) return;
				ensureActivePet();
				json(res, 200, {
					ok: true,
					state: effectiveState(),
					bubble: petState.bubble,
					activePet: petState.activePet,
					pets: listPets(),
					visible: petState.visible,
					enabled: petState.enabled,
					enabledConfigured,
					size: petState.size,
					right: petState.right,
					bottom: petState.bottom,
					name: petState.name,
					mirrorX: petState.mirrorX,
					mirrorY: petState.mirrorY,
					tool: petState.tool,
					domSignals: petState.domSignals,
					version: PKG_VERSION,
					updatedAt: petState.updatedAt
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/info`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "GET")) return;
				const info = resolveInstall();
				const updateCommand = info.mode === "link" && info.repoDir ? `cd "${info.repoDir}" && git pull --ff-only && bash fix-web-profile.sh` : info.profileDir ? `cd "${info.profileDir}" && pnpm update ${PKG}` : "";
				json(res, 200, {
					ok: true,
					pkg: PKG,
					repo: REPO,
					github: GITHUB,
					mode: info.mode,
					version: info.version,
					profileDir: info.profileDir || null,
					repoDir: info.repoDir || null,
					updateCommand
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/check`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "GET")) return;
				await withLocalGuard(req, res, async () => {
					const remote = await fetchRemoteLatest();
					if (!remote) {
						json(res, 200, {
							ok: false,
							error: "network unreachable",
							current: PKG_VERSION
						});
						return;
					}
					const hasUpdate = semverGt(remote.latest.replace(/^web-pets-v/, ""), PKG_VERSION);
					json(res, 200, {
						ok: true,
						current: PKG_VERSION,
						latest: remote.latest,
						hasUpdate,
						notes: remote.notes,
						htmlUrl: remote.htmlUrl
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/update`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const info = resolveInstall();
					if (info.mode !== "link" || !info.repoDir) {
						json(res, 400, {
							ok: false,
							output: "update only supported for monorepo link installs"
						});
						return;
					}
					const result = await runUpdate(info.repoDir);
					json(res, result.ok ? 200 : 500, {
						ok: result.ok,
						output: result.output.slice(-6e3)
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/set-enabled`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const body = await readJsonBody(req);
					if (typeof body.enabled !== "boolean") {
						json(res, 400, {
							ok: false,
							error: "invalid-enabled"
						});
						return;
					}
					petState.enabled = body.enabled;
					petState.updatedAt = Date.now();
					saveConfig();
					json(res, 200, {
						ok: true,
						enabled: petState.enabled
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/set-pet`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const body = await readJsonBody(req);
					const id = typeof body.id === "string" ? body.id : "";
					if (id === "" || !listPets().some((p) => p.id === id)) {
						json(res, 400, {
							ok: false,
							error: "unknown-pet"
						});
						return;
					}
					petState.activePet = id;
					petState.updatedAt = Date.now();
					saveConfig();
					json(res, 200, {
						ok: true,
						activePet: id
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/set-visible`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const body = await readJsonBody(req);
					if (typeof body.visible !== "boolean") {
						json(res, 400, {
							ok: false,
							error: "invalid-visible"
						});
						return;
					}
					petState.visible = body.visible;
					petState.updatedAt = Date.now();
					saveConfig();
					json(res, 200, {
						ok: true,
						visible: petState.visible
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/set-size`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const body = await readJsonBody(req);
					const size = typeof body.size === "number" ? body.size : NaN;
					if (!Number.isFinite(size) || size < SIZE_MIN || size > SIZE_MAX) {
						json(res, 400, {
							ok: false,
							error: "invalid-size"
						});
						return;
					}
					petState.size = Math.round(size);
					petState.updatedAt = Date.now();
					saveConfig();
					json(res, 200, {
						ok: true,
						size: petState.size
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/set-config`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					const body = await readJsonBody(req);
					if (typeof body.size === "number") {
						if (body.size < SIZE_MIN || body.size > SIZE_MAX) {
							json(res, 400, {
								ok: false,
								error: "invalid-size"
							});
							return;
						}
						petState.size = Math.round(body.size);
					}
					if (typeof body.right === "number") {
						if (!Number.isFinite(body.right) || body.right < 0 || body.right > INSET_MAX) {
							json(res, 400, {
								ok: false,
								error: "invalid-right"
							});
							return;
						}
						petState.right = Math.round(body.right);
					}
					if (typeof body.bottom === "number") {
						if (!Number.isFinite(body.bottom) || body.bottom < 0 || body.bottom > INSET_MAX) {
							json(res, 400, {
								ok: false,
								error: "invalid-bottom"
							});
							return;
						}
						petState.bottom = Math.round(body.bottom);
					}
					if (typeof body.name === "string") {
						const name = body.name.trim();
						if (name === "" || Array.from(name).length > NAME_MAX_LENGTH) {
							json(res, 400, {
								ok: false,
								error: "invalid-name"
							});
							return;
						}
						petState.name = name;
					}
					if ("mirrorX" in body) {
						if (typeof body.mirrorX !== "boolean") {
							json(res, 400, {
								ok: false,
								error: "invalid-mirrorX"
							});
							return;
						}
						petState.mirrorX = body.mirrorX;
					}
					if ("mirrorY" in body) {
						if (typeof body.mirrorY !== "boolean") {
							json(res, 400, {
								ok: false,
								error: "invalid-mirrorY"
							});
							return;
						}
						petState.mirrorY = body.mirrorY;
					}
					if ("domSignals" in body) {
						if (typeof body.domSignals !== "boolean") {
							json(res, 400, {
								ok: false,
								error: "invalid-domSignals"
							});
							return;
						}
						petState.domSignals = body.domSignals;
					}
					petState.updatedAt = Date.now();
					saveConfig();
					json(res, 200, {
						ok: true,
						size: petState.size,
						right: petState.right,
						bottom: petState.bottom,
						name: petState.name,
						mirrorX: petState.mirrorX,
						mirrorY: petState.mirrorY,
						domSignals: petState.domSignals
					});
				});
			}
		},
		{
			kind: "exact",
			path: `${API_PREFIX}/interact`,
			handler: async (req, res) => {
				if (!requireMethod(req, res, "POST")) return;
				await withLocalGuard(req, res, async () => {
					setBubble("❤️ 摸头 +1");
					json(res, 200, { ok: true });
				});
			}
		}
	];
	const assetRoute = {
		kind: "prefix",
		path: ASSET_PREFIX,
		handler: async (req, res) => {
			if (req.method !== "GET" && req.method !== "HEAD") {
				res.writeHead(405);
				res.end();
				return;
			}
			try {
				const parts = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname).slice(16).replace(/^\/+/, "").split("/");
				if (parts.length !== 3 || parts[1] !== "emotes") {
					res.writeHead(404);
					res.end();
					return;
				}
				const [petId, , file] = parts;
				const petDir = resolve(PETS_DIR, petId);
				if (!listPets().some((p) => p.id === petId)) {
					res.writeHead(404);
					res.end();
					return;
				}
				const filePath = resolve(petDir, "emotes", basename(file));
				if (!filePath.startsWith(resolve(petDir, "emotes") + "/")) {
					res.writeHead(403);
					res.end();
					return;
				}
				const body = await readFile(filePath);
				const ext = extname(filePath).toLowerCase();
				const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/gif";
				const etag = `"${statSync(filePath).mtimeMs.toString(36)}-${body.byteLength}"`;
				if (req.headers["if-none-match"] === etag) {
					res.writeHead(304, {
						etag,
						"cache-control": "no-cache"
					});
					res.end();
					return;
				}
				res.writeHead(200, {
					"content-type": mime,
					"content-length": String(body.byteLength),
					etag,
					"cache-control": "no-cache"
				});
				if (req.method === "HEAD") {
					res.end();
					return;
				}
				res.end(body);
			} catch {
				res.writeHead(404);
				res.end();
			}
		}
	};
	return [...apiRoutes, assetRoute];
}
/** 插件主体：订阅会话事件驱动桌宠状态，注册 API 与素材路由。 */
function apply(ctx) {
	loadConfig();
	ensureActivePet();
	const disposers = [ctx.on("session/event", onSessionEvent), ctx.on("session/disposed", onSessionDisposed)];
	const routes = makeRoutes();
	const disposeRoutes = ctx.effect(() => {
		const routeDisposers = routes.map((route) => ctx.webServer.register(route));
		return () => {
			for (const dispose of routeDisposers) dispose();
		};
	}, "web-pets: routes");
	return () => {
		for (const dispose of disposers) dispose();
		disposeRoutes();
		clearTimeout(successTimer);
		clearTimeout(feedbackTimer);
	};
}
/**
* 测试钩子：暴露纯逻辑供验证 harness 断言（cordis 只消费 name/inject/apply）。
*/
const _internals = {
	toolBubble,
	toolArgsPreview,
	truncate90,
	semverGt,
	localHostOk,
	resolveInstall,
	effectiveState,
	listPets,
	PKG_VERSION,
	TAG_PREFIX
};
//#endregion
export { _internals, apply, inject, name };
