#!/usr/bin/env bash
# Fake OCR tool for tests: always reports a text-dense result.
cat <<'EOF'
{"text":"余额 1,234.56 元\n户名 张三\n账号 6222 ****","charCount":30,"lineCount":3,"lines":[{"text":"余额 1,234.56 元","confidence":0.9,"x":0.1,"y":0.9}]}
EOF
