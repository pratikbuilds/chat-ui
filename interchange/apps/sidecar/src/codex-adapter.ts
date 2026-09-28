import {
  CODEX_ACCOUNT_ID_OPTION,
  createCodexResponsesAdapter,
  withCodexContentTypeRepair,
} from "@corbits/codex-provider";
import type { AdapterFactory } from "@intx/inference";
import { type } from "arktype";

// The Codex backend streams SSE without a Content-Type header, which the
// harness needs to pick its parser. The harness sends through the global
// fetch, bound when its dependencies are built -- after this manifest
// module loads -- so the repair is installed here. It only rewrites 2xx
// responses from Codex's `/codex/responses` path; everything else passes
// through untouched.
const REPAIRED = Symbol.for("chat-ui.codex-content-type-repair");
if (!Reflect.get(globalThis.fetch, REPAIRED)) {
  const original = globalThis.fetch;
  const repaired = withCodexContentTypeRepair(original.bind(globalThis));
  globalThis.fetch = Object.assign(
    (input: string | URL | Request, init?: RequestInit) =>
      repaired(input, init),
    { preconnect: original.preconnect, [REPAIRED]: true },
  );
}

// The offering's quirks bag: @corbits/codex-provider's own quirks plus the
// ChatGPT account id the Codex backend requires on every request. Nothing
// else carries the credential's account id to the sidecar, so the offering
// holds a copy of it.
const CodexOfferingQuirks = type({
  productName: "string",
  environmentTagName: "string",
  "accountId?": "string",
});

/**
 * Adapter factory for Codex offerings, loaded through
 * SIDECAR_ADAPTER_MANIFEST. Delegates to createCodexResponsesAdapter and
 * adds the account id from quirks as the `chatgpt-account-id` header option.
 */
export const createCodexAdapter: AdapterFactory = (source, quirks) => {
  const parsed = CodexOfferingQuirks(quirks ?? {});
  if (parsed instanceof type.errors) {
    throw new Error(`Codex offering quirks are invalid: ${parsed.summary}`);
  }
  const { accountId, ...codexQuirks } = parsed;
  const adapter = createCodexResponsesAdapter(source, codexQuirks);
  if (accountId === undefined) return adapter;

  return {
    ...adapter,
    buildRequest: (messages, model, options) =>
      adapter.buildRequest(messages, model, {
        ...options,
        providerOptions: {
          ...options.providerOptions,
          [CODEX_ACCOUNT_ID_OPTION]: accountId,
        },
      }),
  };
};
