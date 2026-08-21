# dsh-obsidian-tools（companion bundle）

让 dsh agent 通过 `obsidian_*` 工具直接读写 vault（参考，非 Obsidian 插件）。与主插件配合使用：

1. **工具**：`obsidian_list / read / write / append / delete`，路径限定在 vault 内（`realpath` 防 symlink 逃逸），写入原子化，删除进 `.trash/` 可逆。
2. **四档权限 preset**：在 DSH 配置中注册：
   - `read-only` = sandbox read-only + approval never
   - `ask-before-write` = sandbox read-only + approval ask
   - `workspace-write` = sandbox workspace-write + approval ask
   - `danger-full-access` = sandbox danger-full-access + approval ask
3. **Orchestrated preset**：`dsh-obsidian-orchestrated`，主会话用 Pro 模型，`tool-subagent`/`tool-workflow` 的子代理默认用 Flash 模型，persona 为「拆任务→并行 Flash→Review→整合」。

安装：`dsh plugin --profile web add dsh-obsidian-tools`（或直接 `--patch` 本 bundle 的 cordis.patch.yml），并在 DSH profile 中叠加权限/编排配置。
