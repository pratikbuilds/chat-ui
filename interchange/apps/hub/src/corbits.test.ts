import { expect, test } from "bun:test";
import { listedCodexModels } from "./corbits";

test("only listed ChatGPT models reach the browser", () => {
  expect(
    listedCodexModels({
      models: [
        { slug: "gpt-6-sol", display_name: "GPT-6-Sol", visibility: "list" },
        { slug: "internal", display_name: "Internal", visibility: "hide" },
      ],
    }),
  ).toEqual([{ id: "gpt-6-sol", name: "GPT-6-Sol", description: null }]);
  expect(listedCodexModels({ models: [{ slug: 123 }] })).toBeNull();
});
