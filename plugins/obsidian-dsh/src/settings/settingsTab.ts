import { App, PluginSettingTab, Setting } from "obsidian";
import { PERMISSION_MODES, type PermissionMode } from "../approval/policy";
import { AGENT_MODES, type AgentMode } from "../agents/mode";
import type { ObsidianDshSettings, ViewPlacement } from "./types";
import type ObsidianDshPlugin from "../main";

export class ObsidianDshSettingTab extends PluginSettingTab {
  plugin: ObsidianDshPlugin;

  constructor(app: App, plugin: ObsidianDshPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("DSH 服务").setHeading();

    new Setting(containerEl)
      .setName("DSH 可执行文件")
      .setDesc("留空自动探测（PATH / npm 全局 / Node entrypoint）。")
      .addText((text) =>
        text
          .setPlaceholder("auto-detect")
          .setValue(this.plugin.settings.dshExecutable)
          .onChange(async (value) => {
            this.plugin.settings.dshExecutable = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("DSH web 端口")
      .setDesc("默认 3080；已有服务会直接复用。")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.fixedPort)).onChange(async (value) => {
          const port = Number(value);
          if (Number.isInteger(port) && port > 0 && port < 65536) {
            this.plugin.settings.fixedPort = port;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl)
      .setName("退出行为")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("leave-running", "保留运行")
          .addOption("stop-on-exit", "随 Obsidian 退出")
          .setValue(this.plugin.settings.lifecycle)
          .onChange(async (value) => {
            this.plugin.settings.lifecycle = value as ObsidianDshSettings["lifecycle"];
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("视图位置")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("right-sidebar", "右侧栏")
          .addOption("left-sidebar", "左侧栏")
          .addOption("tab", "标签页")
          .addOption("window", "弹出窗口")
          .setValue(this.plugin.settings.viewPlacement)
          .onChange(async (value) => {
            this.plugin.settings.viewPlacement = value as ViewPlacement;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("自动启动")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoStart).onChange(async (value) => {
          this.plugin.settings.autoStart = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("Agent 模式").setHeading();

    new Setting(containerEl)
      .setName("模式")
      .addDropdown((dropdown) => {
        for (const mode of AGENT_MODES) dropdown.addOption(mode.mode, mode.label);
        dropdown.setValue(this.plugin.settings.agentMode).onChange(async (value) => {
          this.plugin.settings.agentMode = value as AgentMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("权限模式（新会话默认）")
      .addDropdown((dropdown) => {
        for (const spec of PERMISSION_MODES) dropdown.addOption(spec.mode, spec.label);
        dropdown.setValue(this.plugin.settings.permissionMode).onChange(async (value) => {
          this.plugin.settings.permissionMode = value as PermissionMode;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName("Pro / Flash 编排").setHeading();

    new Setting(containerEl)
      .setName("Pro provider / model")
      .addText((text) => text.setValue(this.plugin.settings.proProvider).onChange(async (value) => {
        this.plugin.settings.proProvider = value.trim();
        await this.plugin.saveSettings();
      }))
      .addText((text) => text.setValue(this.plugin.settings.proModel).onChange(async (value) => {
        this.plugin.settings.proModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Flash provider / model")
      .addText((text) => text.setValue(this.plugin.settings.flashProvider).onChange(async (value) => {
        this.plugin.settings.flashProvider = value.trim();
        await this.plugin.saveSettings();
      }))
      .addText((text) => text.setValue(this.plugin.settings.flashModel).onChange(async (value) => {
        this.plugin.settings.flashModel = value.trim();
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("Orchestrated preset")
      .setDesc("companion DSH bundle 提供的 preset id；不存在时回退为 Direct + 编排指令。")
      .addText((text) =>
        text.setValue(this.plugin.settings.orchestratedPreset).onChange(async (value) => {
          this.plugin.settings.orchestratedPreset = value.trim();
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName("上下文").setHeading();

    new Setting(containerEl)
      .setName("笔记内容上限（字节）")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.contextMaxNoteBytes)).onChange(async (value) => {
          const n = Number(value);
          if (Number.isInteger(n) && n > 0) {
            this.plugin.settings.contextMaxNoteBytes = n;
            await this.plugin.saveSettings();
          }
        }),
      );
  }
}
