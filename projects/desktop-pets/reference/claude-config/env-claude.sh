# ============================================================
# Claude Code → DeepSeek 端点环境变量模板
# 用法:把下方 export 行中的占位符换成你自己的 DeepSeek API 密钥,
# 然后整块追加到 ~/.bashrc(或交给 install.sh 自动完成)。
# 变量逐条说明见《说明书.md》第四节。
# ============================================================
# 雷米埃尔桌宠联动:上下文超过 80% 时自动压缩
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80
export ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
export ANTHROPIC_AUTH_TOKEN=__DEEPSEEK_API_KEY__
export ANTHROPIC_MODEL=deepseek-v4-flash
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-flash
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek-v4-flash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek-v4-flash
export CLAUDE_CODE_SUBAGENT_MODEL=deepseek-v4-flash
export CLAUDE_CODE_EFFORT_LEVEL=max
