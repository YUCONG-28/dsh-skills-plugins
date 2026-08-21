import { App, Modal, Setting } from 'obsidian';
import { classifyTool } from './policy';
import type { ApprovalCenter, PendingApproval, PendingQuestion } from './center';
import type { AskUserQuestionItem } from '../harness/types';

export class ApprovalModal extends Modal {
  constructor(app: App, private readonly center: ApprovalCenter, private readonly pending: PendingApproval) {
    super(app);
  }

  onOpen(): void {
    const risk = classifyTool(this.pending.toolName, this.pending.reason);
    this.titleEl.setText('需要确认');
    this.contentEl.createEl('p', { text: 'DSH 请求执行以下操作：' });
    this.contentEl.createEl('div', { cls: 'odsh-approval-tool', text: this.pending.toolName });
    if (this.pending.reason) this.contentEl.createEl('div', { cls: 'odsh-approval-reason', text: this.pending.reason });
    this.contentEl.createEl('div', { cls: 'odsh-tool-risk odsh-tool-risk-' + risk.level, text: '风险：' + risk.label });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('允许一次').setCta().onClick(() => this.closeWith('allowed-once')))
      .addButton((button) => button.setButtonText('拒绝').onClick(() => this.closeWith('rejected')));
  }

  private closeWith(outcome: 'allowed-once' | 'rejected'): void {
    this.close();
    void this.center.decideApproval(this.pending, outcome);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class QuestionModal extends Modal {
  constructor(app: App, private readonly center: ApprovalCenter, private readonly pending: PendingQuestion) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('需要回答');
    for (const question of this.pending.questions) {
      this.renderQuestion(question);
    }
    new Setting(this.contentEl).addButton((button) =>
      button.setButtonText('提交').setCta().onClick(() => this.submit()),
    );
  }

  private renderQuestion(question: AskUserQuestionItem): void {
    if (question.header) this.contentEl.createEl('h4', { text: question.header });
    this.contentEl.createEl('div', { text: question.question, cls: 'odsh-question-text' });
    if (question.options && question.options.length > 0) {
      const select = this.contentEl.createEl('select', { cls: 'dropdown' });
      for (const option of question.options) select.createEl('option', { text: option.label, value: option.label });
      select.dataset.questionId = question.id;
    } else {
      const input = this.contentEl.createEl('input', { type: 'text' });
      input.placeholder = '回答';
      input.dataset.questionId = question.id;
    }
  }

  private submit(): void {
    const answers = this.pending.questions.map((question) => {
      const el = this.contentEl.querySelector<HTMLSelectElement | HTMLInputElement>(`[data-question-id="${question.id}"]`);
      const value = el ? el.value : '';
      return { id: question.id, selected: value ? [value] : [] };
    });
    this.close();
    void this.center.answerQuestion(this.pending, answers);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
