import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";

import z from "zod";

export default defineTool({
  approval: never(),
  description:
    "Get sample weather for a city. This demo does not fetch live weather",
  inputSchema: z.object({ city: z.string().min(1).max(80) }),
  async execute({ city }) {
    return {
      city,
      temperatureF: 72,
      condition: "Sunny",
      summary: `Sunny in ${city} witha. light bright.`,
    };
  },
});
