/**
 * DSH Runtime 稳定错误码与错误类（见 dsh-runtime-execution-plan.md §10.1）。
 * 运行时/协议/模型/Session 错误统一使用这些类，便于 HTTP 映射与测试。
 */

export type DshErrorCode =
  | "DSH_NOT_INSTALLED"
  | "DSH_START_FAILED"
  | "DSH_INITIALIZE_FAILED"
  | "DSH_PROTOCOL_FAILED"
  | "DSH_ROUTE_UNSUPPORTED"
  | "DSH_CREDENTIAL_INVALID"
  | "DSH_MANIFEST_INVALID"
  | "DSH_SKILL_NOT_ALLOWED"
  | "DSH_SESSION_BUSY"
  | "DSH_TURN_FAILED"
  | "RUNTIME_PROFILE_CONFLICT"
  | "DISCUSSION_STATE_CONFLICT"
  | "DISCUSSION_ARCHIVED"
  | "SKILL_INSTALL_REQUIRED"
  | "IMMUTABLE_SKILL_REVISION";

/** 把稳定错误码映射到 HTTP 状态（方案 §10.1） */
export function httpStatusFor(code: DshErrorCode): number {
  switch (code) {
    case "DSH_SESSION_BUSY":
    case "RUNTIME_PROFILE_CONFLICT":
    case "DISCUSSION_STATE_CONFLICT":
    case "DISCUSSION_ARCHIVED":
    case "SKILL_INSTALL_REQUIRED":
    case "IMMUTABLE_SKILL_REVISION":
    case "DSH_SKILL_NOT_ALLOWED":
      return 409;
    case "DSH_MANIFEST_INVALID":
    case "DSH_ROUTE_UNSUPPORTED":
      return 422;
    case "DSH_TURN_FAILED":
      return 502;
    case "DSH_NOT_INSTALLED":
    case "DSH_START_FAILED":
    case "DSH_INITIALIZE_FAILED":
    case "DSH_PROTOCOL_FAILED":
      return 503;
    default:
      return 500;
  }
}

export class DshError extends Error {
  readonly code: DshErrorCode;
  constructor(code: DshErrorCode, message: string) {
    super(message);
    this.name = "DshError";
    this.code = code;
  }
  get httpStatus(): number {
    return httpStatusFor(this.code);
  }
}

export class DshNotInstalledError extends DshError {
  constructor(message = "DSH Runtime 未安装或不可用") {
    super("DSH_NOT_INSTALLED", message);
  }
}
export class DshStartFailedError extends DshError {
  constructor(message = "DSH Runtime 启动失败") {
    super("DSH_START_FAILED", message);
  }
}
export class DshInitializeFailedError extends DshError {
  constructor(message = "DSH Runtime 握手失败") {
    super("DSH_INITIALIZE_FAILED", message);
  }
}
export class DshProtocolError extends DshError {
  constructor(message = "DSH Runtime 协议错误") {
    super("DSH_PROTOCOL_FAILED", message);
  }
}
export class DshRouteUnsupportedError extends DshError {
  constructor(message = "DSH 不支持该 provider/model/baseUrl 路由") {
    super("DSH_ROUTE_UNSUPPORTED", message);
  }
}
export class DshCredentialInvalidError extends DshError {
  constructor(message = "DSH LLM 凭据无效") {
    super("DSH_CREDENTIAL_INVALID", message);
  }
}
export class DshManifestError extends DshError {
  constructor(message = "DSH Session manifest 缺失/损坏/不一致") {
    super("DSH_MANIFEST_INVALID", message);
  }
}
export class DshSkillNotAllowedError extends DshError {
  constructor(message = "该 Skill 不在当前 Session 的 allowlist 内") {
    super("DSH_SKILL_NOT_ALLOWED", message);
  }
}
export class DshSessionBusyError extends DshError {
  constructor(message = "该 DSH Session 正在运行，请稍后") {
    super("DSH_SESSION_BUSY", message);
  }
}
export class DshRuntimeProfileConflictError extends DshError {
  constructor(message = "Runtime 配置与活动 Session 冲突，需先 drain 再切换") {
    super("RUNTIME_PROFILE_CONFLICT", message);
  }
}
export class DshTurnError extends DshError {
  constructor(message = "DSH 模型回合失败") {
    super("DSH_TURN_FAILED", message);
  }
}
export class DiscussionStateConflictError extends DshError {
  constructor(message = "DiscussionState 版本冲突") {
    super("DISCUSSION_STATE_CONFLICT", message);
  }
}
export class DiscussionArchivedError extends DshError {
  constructor(message = "讨论已归档，不接受新的 turn") {
    super("DISCUSSION_ARCHIVED", message);
  }
}
export class SkillInstallRequiredError extends DshError {
  constructor(message = "Skill 必须通过安装产生，不能直接创建") {
    super("SKILL_INSTALL_REQUIRED", message);
  }
}
export class ImmutableSkillRevisionError extends DshError {
  constructor(message = "Skill revision 不可变，不能覆盖") {
    super("IMMUTABLE_SKILL_REVISION", message);
  }
}
