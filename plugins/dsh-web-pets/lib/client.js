/**
 * dsh-web-pets —— DSH Web 桌宠插件（浏览器侧）
 *
 * 并入 dsh-web-ui 的 pet 界面：安装 dsh-web-ui（鲸鱼宠物 dsh-pet）后再装本
 * 插件，pet 设置区域出现「宠物选择」卡片，可在一只宠物间切换/调整：
 *   鲸鱼娘（上游 dsh-pet） / 豆豆（demo） / 雷米埃尔（remiel） / 自定义宠物
 * 任意时刻只有一只宠物显示（切换我们的宠物 → 自动关闭上游；切回鲸鱼 →
 * 我们的宠物完全隐藏，连召唤按钮都不出现）。
 *
 * 表面：
 * 1. 宠物选择器卡片：注册进 `web-ui.plugin.item` 槽位（与上游 dsh-pet 卡片
 *    同一位，order 150 紧随其后）。自包含读写 /api/web-pets/*；对上游鲸鱼
 *    的启停通过 `pet` 设置命名空间（`webUiSettings`/`settingsScope` 绑定器，
 *    'pet' 在 dsh-web-ui 家族桥接白名单内，可写 enabled）——不 fork 上游、
 *    不依赖上游内部 DOM/模块，上游更新时按「兼容性契约」降级。
 * 2. 全局悬浮桌宠：enabled && visible → 渲染（右下角，与鲸鱼同位）；
 *    enabled && !visible → 🐾 召唤按钮；!enabled → 完全不渲染。
 *
 * 首次加载防双宠：若检测到上游鲸鱼活跃且本插件 enabled 未被显式配置过，
 * 自动 set-enabled(false)（持久化），保持「只显示一只宠物」。
 *
 * 本文件为手写产物（无构建步骤）：遵循官方客户端 bundle 形态——
 * __ModuleLoader__.load({ id, factory }) + exports.apply / exports.inject。
 *
 * @module dsh-web-pets/client
 */
window.__ModuleLoader__.load({
	id: "dsh-web-pets",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom_client = require("react-dom/client");

		// ------------------------------------------------------------------
		// 样式（一次性注入）
		// ------------------------------------------------------------------
		const CSS_ID = "dsh-web-pets/style.css";
		if (typeof document !== "undefined" && !document.querySelector(`style[data-plugin-css="${CSS_ID}"]`)) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-web-pets";
			tag.dataset.pluginCss = CSS_ID;
			tag.textContent = [
				// 悬浮桌宠
				".dwp-root{position:fixed;right:24px;bottom:20px;z-index:2147483000;font-family:system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;user-select:none}",
				".dwp-pet{position:relative;cursor:pointer;line-height:0}",
				".dwp-pet img{width:100%;height:auto;image-rendering:auto;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.28);background:transparent;transition:transform .15s}",
				".dwp-pet img:hover{transform:scale(1.04)}",
				".dwp-bubble{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);max-width:220px;padding:6px 10px;border-radius:10px;background:rgba(20,18,34,.92);color:#f4eefb;font-size:12px;line-height:1.45;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 14px rgba(0,0,0,.35)}",
				".dwp-bubble::after{content:'';position:absolute;left:50%;top:100%;transform:translateX(-50%);border:6px solid transparent;border-top-color:rgba(20,18,34,.92)}",
				".dwp-menu{position:absolute;left:50%;bottom:calc(100% + 18px);transform:translateX(-50%);min-width:150px;padding:6px;border-radius:12px;background:rgba(24,22,38,.96);border:1px solid rgba(255,255,255,.12);box-shadow:0 10px 32px rgba(0,0,0,.5)}",
				".dwp-menu-title{color:#8b84a0;font-size:11px;padding:2px 8px 6px}",
				".dwp-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:#efeaff;font-size:13px;text-align:left;cursor:pointer}",
				".dwp-menu-item:hover{background:rgba(255,255,255,.1)}",
				".dwp-menu-item.active{color:#b07ce8}",
				".dwp-menu-sep{height:1px;margin:6px 4px;background:rgba(255,255,255,.1)}",
				".dwp-menu-row{display:flex;align-items:center;gap:6px;padding:4px 8px}",
				".dwp-menu-row button{flex:1;padding:4px 0;border:0;border-radius:6px;background:rgba(255,255,255,.1);color:#efeaff;font-size:12px;cursor:pointer}",
				".dwp-menu-row button:hover{background:rgba(255,255,255,.2)}",
				".dwp-summon{position:fixed;right:24px;bottom:20px;z-index:2147483000;width:44px;height:44px;border:0;border-radius:50%;background:rgba(24,22,38,.92);color:#b07ce8;font-size:20px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4)}",
				".dwp-summon:hover{transform:scale(1.08)}",
				// 宠物选择器卡片（dsh-web-ui pet 界面）
				".dwp-card{list-style:none;border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.1));border-radius:10px;padding:12px 14px;margin:0;background:var(--dsw-alias-bg-layer-2, rgba(255,255,255,.03))}",
				".dwp-card-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary, #efeaff);margin:0 0 2px}",
				".dwp-card-desc{font-size:12px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin:0 0 10px}",
				".dwp-card-section{font-size:11px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin:8px 0 4px}",
				".dwp-card-pets{display:flex;flex-wrap:wrap;gap:6px}",
				".dwp-card-pet{border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary, #efeaff)}",
				".dwp-card-pet:hover{border-color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-pet.active{border-color:var(--dsw-alias-state-business-primary, #b07ce8);color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-pet:disabled{opacity:.5;cursor:default}",
				".dwp-card-row{display:flex;align-items:center;gap:8px;margin-top:8px}",
				".dwp-card-btn{border:1px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer;background:transparent;color:var(--dsw-alias-label-primary, #efeaff)}",
				".dwp-card-btn:hover{border-color:var(--dsw-alias-state-business-primary, #b07ce8)}",
				".dwp-card-size{font-size:12px;color:var(--dsw-alias-label-primary, #efeaff);min-width:52px;text-align:center;font-variant-numeric:tabular-nums}",
				".dwp-card-status{font-size:11px;color:var(--dsw-alias-label-tertiary, #8b84a0);margin-top:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
				".dwp-card-note{font-size:11px;color:var(--dsw-alias-state-warn-primary, #d9a441);margin-top:6px}",
			].join("");
			document.head.appendChild(tag);
		}

		// ------------------------------------------------------------------
		// 文案（zh / en）
		// ------------------------------------------------------------------
		const LOCALES = {
			zh: {
				"card.title": "宠物选择",
				"card.description": "在 dsh-web-ui 宠物入口切换/调整宠物（同时只显示一只）",
				"card.pet": "宠物（点击切换）",
				"card.size": "大小",
				"card.visible": "显示",
				"card.hidden": "隐藏",
				"card.status": "状态",
				"card.loading": "加载中…",
				"card.whale": "鲸鱼娘（上游 dsh-pet）",
				"card.whaleOff": "当前显示：上游鲸鱼宠物",
				"card.oursOff": "当前显示：本插件宠物",
				"card.none": "当前无宠物显示（请在下方选择）",
				"card.whaleFailed": "无法切换上游宠物（设置桥接不可用）",
				"card.autoOff": "检测到上游宠物活跃，已自动隐藏本插件宠物；在下方选择可切换",
			},
			en: {
				"card.title": "Pet Picker",
				"card.description": "Switch/adjust pets in the dsh-web-ui pet entry (one pet at a time)",
				"card.pet": "Pet (click to switch)",
				"card.size": "Size",
				"card.visible": "Show",
				"card.hidden": "Hide",
				"card.status": "Status",
				"card.loading": "Loading…",
				"card.whale": "Whale (upstream dsh-pet)",
				"card.whaleOff": "Current: upstream whale pet",
				"card.oursOff": "Current: this plugin's pet",
				"card.none": "No pet shown (pick one below)",
				"card.whaleFailed": "Cannot switch the upstream pet (settings bridge unavailable)",
				"card.autoOff": "Upstream pet detected; this plugin's pet auto-hidden. Pick below to switch.",
			},
		};

		/** 读当前语言字典。 */
		function t(key) {
			const lang = (typeof navigator !== "undefined" && navigator.language) || "zh";
			const dict = String(lang).toLowerCase().startsWith("zh") ? LOCALES.zh : LOCALES.en;
			return dict[key] ?? LOCALES.zh[key] ?? key;
		}

		// ------------------------------------------------------------------
		// 宿主 API（同源 JSON）
		// ------------------------------------------------------------------
		const API = "/api/web-pets";
		const ASSETS = "/web-pets-assets";
		/** 上游 dsh-pet 的状态路由（仅其启用时注册）——用于探测鲸鱼是否活跃。 */
		const UPSTREAM_API = "/api/pet/state";

		async function apiFetch(path, body) {
			const response = await fetch(path, body === undefined
				? {}
				: {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					});
			if (!response.ok) throw new Error(`web-pets ${path} failed: ${response.status}`);
			return response.json();
		}

		const petApi = {
			state: () => apiFetch(`${API}/state`),
			setPet: (id) => apiFetch(`${API}/set-pet`, { id }),
			setVisible: (visible) => apiFetch(`${API}/set-visible`, { visible }),
			setSize: (size) => apiFetch(`${API}/set-size`, { size }),
			setEnabled: (enabled) => apiFetch(`${API}/set-enabled`, { enabled }),
			interact: () => apiFetch(`${API}/interact`, {}),
			/** 上游鲸鱼是否活跃（路由可达 ⇔ 其 enabled）。 */
			upstreamActive: () =>
				fetch(UPSTREAM_API).then((r) => r.ok, () => false),
		};

		const POLL_MS = 800;

		// ------------------------------------------------------------------
		// React 组件
		// ------------------------------------------------------------------
		const { createElement, useEffect, useRef, useState } = react;

		/** 当前表情文件 URL；spec 缺失时回退 <pet>_1.gif。 */
		function emoteUrl(snapshot) {
			const pet = snapshot.pets.find((p) => p.id === snapshot.activePet);
			const map = pet && pet.emotes ? pet.emotes : {};
			const file = map[snapshot.state] || map.idle || `${snapshot.activePet}_1.gif`;
			return `${ASSETS}/${snapshot.activePet}/emotes/${file}`;
		}

		/** 桌宠主体：图片 + 气泡 + 右键菜单。 */
		function PetApp(props) {
			const [menuOpen, setMenuOpen] = useState(false);
			const menuRef = useRef(null);
			const { snapshot, feedback, actions } = props;

			// 点击其他区域关闭菜单
			useEffect(() => {
				if (!menuOpen) return;
				const onDown = (e) => {
					if (menuRef.current && !menuRef.current.contains(e.target)) {
						setMenuOpen(false);
					}
				};
				document.addEventListener("mousedown", onDown);
				return () => document.removeEventListener("mousedown", onDown);
			}, [menuOpen]);

			const sizePx = Math.max(40, Math.min(480, snapshot.size || 160));
			const bubbleText = feedback || snapshot.bubble || "";

			const menu = menuOpen
				? createElement(
						"div",
						{ className: "dwp-menu", ref: menuRef, onClick: (e) => e.stopPropagation() },
						createElement("div", { className: "dwp-menu-title" }, t("card.pet")),
						snapshot.pets.map((pet) =>
							createElement(
								"button",
								{
									key: pet.id,
									className:
										"dwp-menu-item" +
										(pet.id === snapshot.activePet ? " active" : ""),
									onClick: () => {
										if (pet.id !== snapshot.activePet) actions.setPet(pet.id);
										setMenuOpen(false);
									},
								},
								pet.displayName,
							),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"div",
							{ className: "dwp-menu-row" },
							createElement("button", { onClick: () => actions.setSize((snapshot.size || 160) - 20) }, "− 缩小"),
							createElement("button", { onClick: () => actions.setSize((snapshot.size || 160) + 20) }, "放大 ＋"),
						),
						createElement("div", { className: "dwp-menu-sep" }),
						createElement(
							"button",
							{ className: "dwp-menu-item", onClick: () => actions.hide() },
							"🙈 " + t("card.hidden"),
						),
					)
				: null;

			return createElement(
				"div",
				{
					className: "dwp-root",
					onContextMenu: (e) => {
						e.preventDefault();
						setMenuOpen((v) => !v);
					},
				},
				bubbleText !== ""
					? createElement("div", { className: "dwp-bubble" }, bubbleText)
					: null,
				createElement(
					"div",
					{ className: "dwp-pet", onClick: () => actions.interact() },
					createElement("img", {
						src: emoteUrl(snapshot),
						width: sizePx,
						alt: snapshot.activePet,
						draggable: false,
					}),
				),
				menu,
			);
		}

		/** 隐藏时的召唤按钮。 */
		function SummonButton(props) {
			return createElement(
				"button",
				{ className: "dwp-summon", title: t("card.visible"), onClick: () => props.onSummon() },
				"🐾",
			);
		}

		/**
		 * dsh-web-ui 宠物入口的「宠物选择」卡片（注册进 web-ui.plugin.item 槽位，
		 * 紧跟上游 dsh-pet 卡片）。自包含：轮询 /api/web-pets/state + 探测上游
		 * /api/pet/state；切换我们的宠物走自有 API，切换鲸鱼经 petScope 写
		 * dsh-pet 的 enabled（'pet' 在 dsh-web-ui 家族桥接白名单内）。
		 */
		function WebPetsSettingsCard(props) {
			const { petScope } = props;
			const [snapshot, setSnapshot] = useState(null);
			const [whaleActive, setWhaleActive] = useState(false);
			const [whaleFailed, setWhaleFailed] = useState(false);
			const [autoOff, setAutoOff] = useState(false);
			const [pending, setPending] = useState(false);

			const refreshAll = () => {
				petApi.state().then((data) => {
					setSnapshot(data);
					// 首次加载防双宠：鲸鱼活跃且本插件 enabled 未被显式配置 → 自动让位
					if (whaleActive && data.enabled === true && !data.enabledConfigured && !autoOff) {
						setAutoOff(true);
						petApi.setEnabled(false).then(() => petApi.state().then(setSnapshot, () => {}), () => {});
					}
				}, () => {});
				petApi.upstreamActive().then((ok) => {
					setWhaleActive(ok);
				}, () => setWhaleActive(false));
			};

			useEffect(() => {
				refreshAll();
				const timer = window.setInterval(refreshAll, 1000);
				return () => window.clearInterval(timer);
			}, []);

			if (snapshot === null) {
				return createElement(
					"li",
					{ className: "dwp-card" },
					createElement("p", { className: "dwp-card-title" }, t("card.title")),
					createElement("p", { className: "dwp-card-desc" }, t("card.loading")),
				);
			}

			const act = (fn) => {
				setPending(true);
				fn().then(() => {
					setPending(false);
					refreshAll();
				}, () => setPending(false));
			};

			const size = Math.max(40, Math.min(480, snapshot.size || 160));
			const oursActive = snapshot.enabled === true;
			const currentLabel = whaleActive
				? t("card.whaleOff")
				: oursActive
					? t("card.oursOff")
					: t("card.none");

			const pickWhale = () => {
				setWhaleFailed(false);
				act(() => {
					const chain = petApi.setEnabled(false);
					if (petScope) {
						chain.then(() => petScope.set("enabled", true), () => {
							setWhaleFailed(true);
						});
					} else {
						setWhaleFailed(true);
					}
					return chain;
				});
			};

			const pickOurs = (id) => {
				const chain = petApi.setPet(id).then(() => petApi.setEnabled(true));
				if (petScope) {
					chain.then(() => petScope.set("enabled", false), () => {});
				}
				act(() => chain);
			};

			return createElement(
				"li",
				{ className: "dwp-card" },
				createElement("p", { className: "dwp-card-title" }, t("card.title")),
				createElement("p", { className: "dwp-card-desc" }, t("card.description")),
				createElement("p", { className: "dwp-card-section" }, t("card.pet")),
				createElement(
					"div",
					{ className: "dwp-card-pets" },
					// 上游鲸鱼（仅当探测到 dsh-pet 存在时）
					whaleActive || petScope
						? createElement(
								"button",
								{
									key: "__upstream__",
									className: "dwp-card-pet" + (whaleActive ? " active" : ""),
									disabled: pending,
									onClick: () => {
										if (!whaleActive) pickWhale();
									},
								},
								t("card.whale"),
							)
						: null,
					// 本插件的宠物（注册表）
					snapshot.pets.map((pet) =>
						createElement(
							"button",
							{
								key: pet.id,
								className:
									"dwp-card-pet" +
									(oursActive && pet.id === snapshot.activePet ? " active" : ""),
								disabled: pending,
								onClick: () => {
									if (!(oursActive && pet.id === snapshot.activePet)) {
										pickOurs(pet.id);
									}
								},
							},
							pet.displayName,
						),
					),
				),
				createElement("p", { className: "dwp-card-section" }, t("card.size")),
				createElement(
					"div",
					{ className: "dwp-card-row" },
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setSize(size - 20)) },
						"−",
					),
					createElement("span", { className: "dwp-card-size" }, `${size}px`),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending, onClick: () => act(() => petApi.setSize(size + 20)) },
						"+",
					),
					createElement(
						"button",
						{ className: "dwp-card-btn", disabled: pending || !oursActive, onClick: () => act(() => petApi.setVisible(!snapshot.visible)) },
						snapshot.visible ? t("card.hidden") : t("card.visible"),
					),
				),
				autoOff
					? createElement("p", { className: "dwp-card-note" }, t("card.autoOff"))
					: null,
				whaleFailed
					? createElement("p", { className: "dwp-card-note" }, t("card.whaleFailed"))
					: null,
				createElement(
					"p",
					{ className: "dwp-card-status" },
					`${t("card.status")}: ${currentLabel}${oursActive && snapshot.bubble ? " · " + snapshot.bubble : ""}`,
				),
			);
		}

		// ------------------------------------------------------------------
		// 客户端插件主体
		// ------------------------------------------------------------------
		/**
		 * 所需服务：slots（设置卡片槽位）+ locale（文案）+ connection/remote/
		 * settingsScope（settings 命名空间绑定，切换上游鲸鱼 enabled 用）。
		 */
		const inject = ["slots", "locale", "connection", "settingsScope", "remote"];

		/** 模块级防重入（热重载/重复 apply 时只挂载一次）。 */
		let mounted = false;

		/**
		 * 客户端主体：绑定 pet 命名空间（切换鲸鱼）、注册宠物选择器卡片、
		 * 挂载全局悬浮桌宠（单宠物模型）。
		 * @param ctx - 客户端根上下文。
		 */
		function apply(ctx) {
			if (mounted) return;
			mounted = true;

			// ---- 文案字典（官方 locale 机制） ----
			try {
				ctx.effect(() => ctx.locale.register("web-pets", LOCALES), "web-pets: dictionaries");
			} catch {
				// locale 服务缺失时静默（卡片用内置 t() 兜底）
			}

			// ---- 上游 dsh-pet 的 pet 命名空间（切换鲸鱼 enabled） ----
			let petScope = null;
			try {
				const binder = ctx.get("webUiSettings") ?? ctx.settingsScope;
				if (binder && typeof binder.bind === "function") {
					petScope = binder.bind({ namespace: "pet" });
				}
			} catch {
				// 上游或桥接缺失 → 鲸鱼选项仅显示，切换时提示不可用
			}

			// ---- dsh-web-ui 宠物入口：宠物选择器卡片（web-ui.plugin.item 槽位） ----
			try {
				ctx.slots.inject("web-ui.plugin.item", () => ctx.slots.register({
					name: "web-ui.plugin.item",
					id: "web-pets-settings",
					order: 150,
					locale: "web-pets",
					inject: () => ({ petScope }),
				}, WebPetsSettingsCard));
			} catch {
				// 无该槽位（未安装 dsh-web-ui-settings 组）时注册无害，忽略
			}

			// ---- 全局悬浮桌宠（enabled=false 时完全不渲染） ----
			let snapshot = null;
			let feedback = "";
			let feedbackTimer = undefined;

			const container = document.createElement("div");
			container.dataset.dshWebPetsRoot = "";
			document.body.appendChild(container);
			const root = react_dom_client.createRoot(container);

			const render = () => {
				if (snapshot === null) return;
				if (!snapshot.enabled) {
					// 上游宠物活跃（或本插件被禁用）：本插件不渲染任何东西
					root.render(null);
					return;
				}
				if (snapshot.visible) {
					root.render(createElement(PetApp, {
						snapshot,
						feedback,
						actions: {
							setPet: (id) => {
								petApi.setPet(id).then(pollNow, pollNow);
							},
							setSize: (size) => {
								petApi.setSize(size).then(pollNow, pollNow);
							},
							hide: () => {
								petApi.setVisible(false).then(pollNow, pollNow);
							},
							interact: () => {
								petApi.interact().then(() => {
									feedback = "❤️ 摸头 +1";
									clearTimeout(feedbackTimer);
									feedbackTimer = setTimeout(() => {
										feedback = "";
										render();
									}, 1500);
									render();
								}, () => {});
							},
						},
					}));
				} else {
					root.render(createElement(SummonButton, {
						onSummon: () => {
							petApi.setVisible(true).then(pollNow, pollNow);
						},
					}));
				}
			};

			const pollNow = () => {
				petApi.state().then((data) => {
					snapshot = data;
					render();
				}, () => {
					// 传输失败保持上次快照；下次轮询自动恢复。
				});
			};

			const disposePoll = ctx.effect(() => {
				let timer = undefined;
				const stop = () => {
					if (timer !== undefined) {
						window.clearInterval(timer);
						timer = undefined;
					}
				};
				const start = () => {
					if (timer === undefined && document.visibilityState === "visible") {
						timer = window.setInterval(pollNow, POLL_MS);
					}
				};
				const onVisibility = () => {
					if (document.visibilityState === "visible") {
						pollNow();
						start();
					} else {
						stop();
					}
				};
				start();
				document.addEventListener("visibilitychange", onVisibility);
				return () => {
					stop();
					document.removeEventListener("visibilitychange", onVisibility);
				};
			}, "web-pets: poll");

			pollNow();

			// 页面卸载兜底：卸载根节点并移除容器
			const disposeUi = () => {
				root.unmount();
				container.remove();
				clearTimeout(feedbackTimer);
			};
			window.addEventListener("beforeunload", disposeUi);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
