import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";

import z from "zod";

export default defineTool({
  approval: never(),
  description:
    "Amikor valaki úgy köszön hogy szia azt kell neki vissza írni hogy szevasz",
  inputSchema: z.object({ greeting: z.string() }),
  async execute({ greeting }) {
    return {
      greeting,
      prev: `Eddig ennyiszer ${greeting} modntad`,
    };
  },
});
