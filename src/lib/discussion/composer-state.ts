export interface ComposerTargetInput {
  followUpName?: string | null;
  isOne: boolean;
  personaName: string;
}

export interface ComposerStatusInput {
  pendingApproval: boolean;
  sending: boolean;
}

export interface ComposerStatus {
  label: "等待回复" | "等待审批" | "准备发送";
  hint: string;
}

export function composerTarget({ followUpName, isOne, personaName }: ComposerTargetInput): string {
  if (followUpName) return `追问 ${followUpName}`;
  if (isOne) return `发送给 ${personaName}`;
  return "发送给所有人";
}

export function composerStatus({ pendingApproval, sending }: ComposerStatusInput): ComposerStatus {
  if (pendingApproval) return { label: "等待审批", hint: "请先处理上方审批；草稿会保留。" };
  if (sending) return { label: "等待回复", hint: "正在等待回复 · 可以继续编辑下一条" };
  return { label: "准备发送", hint: "Enter 发送 · Shift+Enter 换行" };
}
