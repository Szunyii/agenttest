import { defineEval } from "eve/evals";

export default defineEval({
  description: "A request for a math example must use the get_exercise tool.",

  async test(t) {
    await t.send("adj egy matek példát");
    t.succeeded();
    t.calledTool("get_exercise");
  },
});
