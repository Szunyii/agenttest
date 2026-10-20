import { defineEval } from "eve/evals";

export default defineEval({
  description: "Weather questions must be use sample weather tool.",

  async test(t) {
    await t.send(
      "what is the weather in denver?, use the sample weather tool and keep it short",
    );
    t.succeeded();
    t.calledTool("get_weather", { input: { city: "Denver" } });
    t.notCalledTool("web_search");
  },
});
