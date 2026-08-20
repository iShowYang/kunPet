export type AgentStopEvent = {
  type: "agent_stop";
  ts: number;
};

export type AgentPromptEvent = {
  type: "agent_prompt";
  ts: number;
};

export type AgentSessionStartEvent = {
  type: "agent_session_start";
  ts: number;
};

export type AgentStartEvent = AgentPromptEvent | AgentSessionStartEvent;

export type AgentEvent = AgentStopEvent | AgentStartEvent;

export type PetIpcMessage =
  | { type: "celebrate"; walkToCenter?: boolean }
  | { type: "return-idle" }
  | { type: "show" }
  | { type: "hide" }
  | { type: "set-position"; x: number; y: number }
  | { type: "set-prefs"; walkToCenter: boolean };

export const CONFIG_SECTION = "kunpet";
export const CONFIG_ENABLED = "enabled";
export const CONFIG_WALK_TO_CENTER = "walkToCenter";

export type PortFileContents = {
  port: number;
  updatedAt: number;
};

export const PORT_FILE_NAME = "kunpet-port.json";
export const HOOK_SCRIPT_NAME = "kunpet-notify.js";
export const DEDUPE_WINDOW_MS = 2000;
export const AGENT_START_DEDUPE_MS = 500;
export const DEFAULT_NOTIFY_TITLE = "鲲来报喜";
export const DEFAULT_NOTIFY_BODY = "这轮 AI 对话完成啦";
