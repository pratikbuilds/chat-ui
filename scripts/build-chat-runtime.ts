import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dirname, "..")
const interchange = path.join(root, "interchange")
const built = await Bun.build({
  entrypoints: [path.join(root, "agents/chat/workflow.ts")],
  target: "bun",
  format: "esm",
  minify: true,
  throw: true,
  plugins: [
    {
      name: "interchange-source",
      setup(build) {
        build.onResolve({ filter: /^@intx\// }, (args) => ({
          path: Bun.resolveSync(
            args.path,
            args.importer.startsWith(interchange + path.sep)
              ? path.dirname(args.importer)
              : interchange
          ),
        }))
      },
    },
  ],
})
const code = await built.outputs[0]?.text()
if (!code) throw new Error("Chat workflow bundle is empty")
await mkdir(path.join(root, "public"), { recursive: true })
await writeFile(path.join(root, "public/chat-runtime.mjs"), code)
