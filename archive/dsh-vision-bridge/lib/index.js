/**
 * dsh-vision-bridge
 *
 * 自动视觉路由 + 描述兜底插件（重构版）。
 *
 * 架构（P2 目录分离）：
 *   adapters/dsh.js   —— 唯一接触 DSH API 的模块（image-capable 虚拟 provider
 *                        vision-router / deepseek-v4-pro-vision、能力探测、fail-soft）
 *   routing/          —— 路由策略（纯函数：evidence-first / 整轮路由）
 *   ocr/              —— Apple Vision 本地 OCR（编译二进制优先）
 *   providers/        —— 远程视觉引擎（fallback chain / batch / timeout）
 *   evidence/         —— 结构化证据（prompt、JSON 校验、渲染）
 *   cache/            —— L1 内存 + L2 磁盘缓存
 *   telemetry/        —— 结构化性能遥测（不含 key/图片内容）
 *   compat/           —— 旧模式 caption bridge + 旧配置兼容 + patch 脚本废弃声明
 *
 * 硬性保证（P0/P5/P7）：
 *   - 不修改任何 DSH node_modules 文件；
 *   - 不依赖 apply-vision-patch.sh（已废弃，默认关闭，绝不自动运行）；
 *   - 不静态导入 @deepseek-ai/dsh-llm 等 DSH 包——DSH API 变化时插件只降级，
 *     dsh web 永远正常启动。
 *
 * @module dsh-vision-bridge
 */
import { Config, normalizeLegacyConfig } from './config.js';
import { apply } from '../adapters/dsh.js';

export const name = 'vision-bridge';

/** 有意为空：DSH 服务全部按需探测（P5 fail-soft）。 */
export const inject = [];

/**
 * Cordis plugin entry. inject 有意留空：DSH 服务（llm/attachments）均按需
 * 在运行时通过能力探测获取，任何缺失只降级对应功能，不阻断插件加载。
 */
export { Config, normalizeLegacyConfig, apply };