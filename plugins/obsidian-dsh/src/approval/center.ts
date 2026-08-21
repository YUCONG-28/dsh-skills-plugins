// Approval/question queue: consumes answerable mux frames and answers them
// through POST /api/respond with the frame's echoed rpcId.
import type { DshApiClient } from "../harness/client";
import type { AskUserQuestionItem, MuxFrameRaw } from "../harness/types";

export interface PendingApproval {
  rpcId: string;
  sessionId: string;
  approvalId: string;
  toolName: string;
  callId?: string;
  reason?: string;
}

export interface PendingQuestion {
  rpcId: string;
  sessionId: string;
  questions: AskUserQuestionItem[];
}

export class ApprovalCenter {
  private approvals = new Map<string, PendingApproval>();
  private questions = new Map<string, PendingQuestion>();
  private listeners = new Set<() => void>();

  constructor(private readonly client: DshApiClient) {}

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  get pendingApprovals(): PendingApproval[] {
    return [...this.approvals.values()];
  }

  get pendingQuestions(): PendingQuestion[] {
    return [...this.questions.values()];
  }

  ingest(rpcId: string, frame: MuxFrameRaw["payload"]): void {
    switch (frame.type) {
      case "approval/requested": {
        if (!frame.sessionId || typeof frame.approvalId !== "string") return;
        this.approvals.set(`${frame.sessionId}/${frame.approvalId}`, {
          rpcId,
          sessionId: frame.sessionId,
          approvalId: frame.approvalId,
          toolName: typeof frame.toolName === "string" ? frame.toolName : "tool",
          callId: typeof frame.callId === "string" ? frame.callId : undefined,
          reason: typeof frame.reason === "string" ? frame.reason : undefined,
        });
        this.notify();
        break;
      }
      case "approval/resolved": {
        if (!frame.sessionId || typeof frame.approvalId !== "string") return;
        if (this.approvals.delete(`${frame.sessionId}/${frame.approvalId}`)) this.notify();
        break;
      }
      case "question/requested": {
        if (!frame.sessionId) return;
        this.questions.set(rpcId, { rpcId, sessionId: frame.sessionId, questions: frame.questions ?? [] });
        this.notify();
        break;
      }
      case "question/resolved": {
        if (typeof frame.questionRpcId === "string" && this.questions.delete(frame.questionRpcId)) this.notify();
        break;
      }
      default:
        break;
    }
  }

  async decideApproval(p: PendingApproval, outcome: "allowed-once" | "rejected"): Promise<boolean> {
    const receipt = await this.client.respond(p.rpcId, { sessionId: p.sessionId, approvalId: p.approvalId, outcome });
    if (receipt.accepted) this.approvals.delete(`${p.sessionId}/${p.approvalId}`);
    this.notify();
    return receipt.accepted;
  }

  async answerQuestion(p: PendingQuestion, answers: { id: string; selected: string[]; custom?: string }[]): Promise<boolean> {
    const receipt = await this.client.respond(p.rpcId, { sessionId: p.sessionId, answer: { answers } });
    if (receipt.accepted) this.questions.delete(p.rpcId);
    this.notify();
    return receipt.accepted;
  }
}
