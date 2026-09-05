const fakeModule = `
  export class DeepSeekHarness {
    constructor(options) {
      this.options = options;
    }

    async start() {}

    async run(_prompt, { sessionId }) {
      return {
        sessionId,
        finalResponse: JSON.stringify({
          childSessionId: this.options.env?.BT_DSH_SESSION_ID ?? null,
          dshHome: this.options.dshHome ?? null,
        }),
      };
    }

    async close() {}
  }
`;

const fakeModuleUrl = `data:text/javascript,${encodeURIComponent(fakeModule)}`;

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "@deepseek-ai/dsh-sdk-client") {
    return { url: fakeModuleUrl, shortCircuit: true };
  }
  return defaultResolve(specifier, context, defaultResolve);
}
