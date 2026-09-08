/**
 * Make the SDK server's first-use `agents.create` call restart-safe.
 *
 * The SDK server keeps its own in-memory session map. After the DSH child is
 * restarted that map is empty, while session persistence still contains the
 * stable discussion session id. The stock server calls `agents.create` again,
 * which makes the persistence layer reject the new seed as an id collision.
 * This small overlay adopts the persisted identity through `agents.resume`
 * before the stock server gets a chance to create a second seed.
 */

export const name = "business-talking-session-resume";
export const inject = ["agents", "sessionQuery"];

/** Return whether a session-query listing contains the requested durable id. */
export function shouldResumePersistedSession(records, sessionId) {
  if (!Array.isArray(records) || typeof sessionId !== "string" || !sessionId) return false;
  return records.some((record) => record?.header?.id === sessionId || record?.id === sessionId);
}

function resumeOptions(options, sessionId) {
  return {
    resumeSessionId: sessionId,
    ...(options?.agentOptions === undefined ? {} : { agentOptions: options.agentOptions }),
    ...(options?.setup === undefined ? {} : { setup: options.setup }),
    ...(options?.signal === undefined ? {} : { signal: options.signal }),
  };
}

async function hasPersistedSession(ctx, sessionId) {
  const query = ctx.get("sessionQuery");
  if (query?.listSessions) {
    return shouldResumePersistedSession(await query.listSessions(), sessionId);
  }

  const persistence = ctx.get("sessionPersistence");
  if (persistence?.list) {
    return shouldResumePersistedSession(await persistence.list(), sessionId);
  }

  return false;
}

export function apply(ctx) {
  const agents = ctx.get("agents");
  const originalCreate = agents.create.bind(agents);
  const originalResume = agents.resume.bind(agents);
  const pendingChecks = new Map();

  const create = async (options) => {
    const sessionId = options?.sessionId;
    if (typeof sessionId !== "string" || !sessionId || agents.get(sessionId)) {
      return originalCreate(options);
    }

    let check = pendingChecks.get(sessionId);
    if (!check) {
      check = hasPersistedSession(ctx, sessionId);
      pendingChecks.set(sessionId, check);
      void check.then(() => {
        if (pendingChecks.get(sessionId) === check) pendingChecks.delete(sessionId);
      }, () => {
        if (pendingChecks.get(sessionId) === check) pendingChecks.delete(sessionId);
      });
    }

    if (await check) return originalResume(resumeOptions(options, sessionId));
    return originalCreate(options);
  };

  agents.create = create;
  ctx.effect(() => () => {
    pendingChecks.clear();
    if (agents.create === create) agents.create = originalCreate;
  }, "business-talking-session-resume");
}
