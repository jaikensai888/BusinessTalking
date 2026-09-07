#!/usr/bin/env node
import readline from "node:readline";

const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

emit({ type: "ready" });

async function handleRun(command) {
  const { requestId, sessionId, prompt } = command;
  if (prompt === "corrupt") {
    process.stdout.write("{broken-json\n");
    return;
  }
  if (prompt === "unknown-request") {
    emit({ type: "done", requestId: "unknown-request-id", sessionId, finalResponse: "reply" });
    return;
  }
  if (prompt === "mismatch") {
    emit({ type: "done", requestId, sessionId: "different-session", finalResponse: "reply" });
    return;
  }
  if (prompt === "fatal") {
    emit({ type: "fatal", code: "DSH_PROTOCOL_FAILED", stage: "run", error: "fixture fatal" });
    await wait(5);
    process.exit(1);
  }
  if (prompt === "nonzero") {
    await wait(5);
    process.exit(2);
  }
  if (prompt === "close") {
    await wait(5);
    process.exit(0);
  }
  if (prompt === "error") {
    emit({ type: "error", requestId, code: "DSH_TURN_FAILED", stage: "run", error: "fixture turn failed" });
    return;
  }

  emit({
    type: "event",
    requestId,
    sessionId,
    notification: {
      method: "session.event",
      params: {
        sessionId,
        event: {
          type: "assistant/message",
          seq: 1,
          time: 1730000000001,
          data: { message: { content: [{ type: "text", text: `reply:${sessionId}` }] } },
        },
      },
    },
  });
  if (prompt === "slow-a") await wait(30);
  if (prompt === "slow-b") await wait(5);
  emit({ type: "done", requestId, sessionId, finalResponse: `reply:${sessionId}` });
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  let command;
  try {
    command = JSON.parse(line);
  } catch {
    emit({ type: "fatal", code: "DSH_PROTOCOL_FAILED", stage: "input", error: "fixture bad command" });
    return;
  }
  if (command?.type === "shutdown") {
    input.close();
    process.exit(0);
    return;
  }
  if (command?.type === "run") void handleRun(command);
});
