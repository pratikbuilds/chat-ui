FROM oven/bun:1.4.2
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
CMD ["sh", "-c", "cd packages/db && bun drizzle-kit migrate && cd ../.. && exec bun run --conditions=intx-src tests/admin-ui-e2e/harness/railway.ts"]
