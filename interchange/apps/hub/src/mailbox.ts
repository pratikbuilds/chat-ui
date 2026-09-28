import { AsyncLocalStorage } from "node:async_hooks";

import {
  createInMemoryMailboxEventBus,
  createMailboxRoutes,
  createMailboxPersist,
  runMailboxMigrations,
  type AuthorizeMailboxSender,
  type MailboxPersistArgs,
  type OutgoingMailboxMessage,
} from "@corbits/mailbox";
import type { createDB, DB, DBConfig } from "@intx/db";
import {
  principal as principalTable,
  tenant as tenantTable,
} from "@intx/db/schema";
import type { AppEnv, RequireGrant, TenantEnv } from "@intx/hub-api";
import {
  resolveRoutableAddress,
  type SidecarLookups,
} from "@intx/hub-sessions";
import { getLogger } from "@intx/log";
import { parseRunAddress } from "@intx/types";
import { eq } from "drizzle-orm";
import { Hono, type Context, type MiddlewareHandler } from "hono";

const log = getLogger(["hub", "mailbox"]);

const TENANT_PREFIX = "/api/tenants/:tenantId";

export type SetupMailboxDeps = {
  readonly app: Hono<AppEnv>;
  readonly db: ReturnType<typeof createDB>["db"];
  readonly dbConfig: DBConfig;
  readonly lookups: SidecarLookups;
  readonly requireGrant: RequireGrant;
};

/**
 * Gives people a native mailbox (@corbits/mailbox): an agent's mail to a
 * person lands in that person's INBOX instead of being dropped, and
 * `/api/tenants/:tenantId/mailbox/me/inbox` lists, threads, sends and
 * streams it. The mailbox keeps its own tables in its own schema of the
 * hub's database; its migrations run here, at boot, and are idempotent.
 */
export async function setupMailbox({
  app,
  db,
  dbConfig,
  lookups,
  requireGrant,
}: SetupMailboxDeps): Promise<void> {
  await runMailboxMigrations(dbConfig, { schema: dbConfig.schema ?? "public" });
  const bus = createInMemoryMailboxEventBus();

  // The sidecar router reads `lookups.persistMail` per outbound frame, so
  // wrapping it after the router exists still catches every agent's mail.
  const upstream = lookups.persistMail;
  if (upstream === undefined) {
    throw new Error("setupMailbox: the hub has no persistMail lookup to wrap");
  }
  const persistMail = createMailboxPersist(db, {
    upstream: skipSessionlessRuns(db, upstream),
    authorizeSender: authorizeRunSender(db),
    bus,
  });
  lookups.persistMail = persistMail;

  const mailboxApi = new Hono<TenantEnv>();
  // Registered before the routes: Hono runs handlers in registration order.
  mailboxApi.use("/me/inbox/send", captureRequest());
  mailboxApi.route(
    "/",
    createMailboxRoutes({
      db,
      bus,
      requireGrant,
      senderAddressFor: (principal) => personAddress(db, principal),
      deliver: createDeliver(app, persistMail),
    }),
  );
  app.route(`${TENANT_PREFIX}/mailbox`, mailboxApi);
}

/**
 * Stock persistMail records a run's mail against the run's session, which a
 * workflow deployment does not have; it would throw on every reply. The
 * mailbox append is the durable copy for such a run, so the stock write is
 * skipped for it.
 */
function skipSessionlessRuns(
  db: DB["db"],
  upstream: NonNullable<SidecarLookups["persistMail"]>,
): NonNullable<SidecarLookups["persistMail"]> {
  return async (args) => {
    const sender = await resolveRoutableAddress(db, args.senderAddress);
    if (sender !== undefined && sender.sessionId === null) return [];
    return upstream(args);
  };
}

/** A live run may mail people in its own tenant's domain. */
function authorizeRunSender(db: DB["db"]): AuthorizeMailboxSender {
  return async (senderAddress) => {
    const sender = await resolveRoutableAddress(db, senderAddress);
    if (sender === undefined) return null;
    const [row] = await db
      .select({ domain: tenantTable.domain })
      .from(tenantTable)
      .where(eq(tenantTable.id, sender.tenantId))
      .limit(1);
    return row === undefined
      ? null
      : { tenantId: sender.tenantId, domain: row.domain };
  };
}

/**
 * The address stock stamps on a person's outbound mail, so a Sent copy and
 * the agent's reply share one identity. Lowercase, because agents lowercase
 * the address they reply to.
 */
async function personAddress(
  db: DB["db"],
  principal: { tenantId: string; principalId: string },
): Promise<string> {
  const [tenantRow] = await db
    .select({ domain: tenantTable.domain })
    .from(tenantTable)
    .where(eq(tenantTable.id, principal.tenantId))
    .limit(1);
  const [principalRow] = await db
    .select({ refId: principalTable.refId })
    .from(principalTable)
    .where(eq(principalTable.id, principal.principalId))
    .limit(1);
  if (tenantRow === undefined || principalRow === undefined) {
    throw new Error(
      `No mailbox address for principal ${principal.principalId} in ${principal.tenantId}`,
    );
  }
  return `${principalRow.refId}@${tenantRow.domain}`.toLowerCase();
}

/** The send route's request, so `deliver` can replay the caller's session. */
const sendRequest = new AsyncLocalStorage<Context>();

function captureRequest(): MiddlewareHandler {
  return (c, next) => sendRequest.run(c, next);
}

/** Everything after the header section of a flat frame this package built. */
function frameBody(raw: Uint8Array): string {
  const text = new TextDecoder().decode(raw);
  const split = text.indexOf("\r\n\r\n");
  return split < 0 ? "" : text.slice(split + 4).trimEnd();
}

/**
 * A person's message to a run is a deployment trigger, not mail to a
 * mailbox, so it goes through stock `POST /workflows/:runId/mail` -- the one
 * path that signs, authorizes and dispatches it -- as the same caller. Mail
 * to anyone else rides the (mailbox-wrapped) persist path.
 */
function createDeliver(
  app: Hono<AppEnv>,
  persistMail: (args: MailboxPersistArgs) => Promise<unknown>,
): (message: OutgoingMailboxMessage) => Promise<void> {
  return async (message) => {
    const runIds = message.to.flatMap((address) => {
      const parsed = parseRunAddress(address);
      return parsed === null ? [] : [parsed.runId];
    });
    const others = message.to.filter(
      (address) => parseRunAddress(address) === null,
    );

    if (runIds.length > 0) {
      const c = sendRequest.getStore();
      if (c === undefined) {
        throw new Error("mailbox deliver ran outside a mailbox send request");
      }
      const tenantId = c.req.param("tenantId") ?? "";
      const headers = new Headers({ "content-type": "application/json" });
      for (const name of ["cookie", "authorization", "origin"]) {
        const value = c.req.header(name);
        if (value !== undefined) headers.set(name, value);
      }
      const content = frameBody(message.raw);
      for (const runId of runIds) {
        const response = await app.request(
          `/api/tenants/${encodeURIComponent(tenantId)}/workflows/${encodeURIComponent(runId)}/mail`,
          { method: "POST", headers, body: JSON.stringify({ content }) },
        );
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          log.error`Mailbox trigger for ${runId} failed: ${String(response.status)} ${detail}`;
          throw new Error(
            `Trigger for ${runId} answered ${String(response.status)}: ${detail}`,
          );
        }
      }
    }

    if (others.length > 0) {
      await persistMail({
        senderAddress: message.from,
        recipients: others,
        raw: message.raw,
      });
    }
  };
}
