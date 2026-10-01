FROM oven/bun:1.4.2
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN cd interchange && bun install --frozen-lockfile
RUN bun run build
CMD ["sh", "-c", "exec bun run preview --host 0.0.0.0 --port ${PORT:-4173}"]
