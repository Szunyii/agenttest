import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";

import z from "zod";

import {
  difficulties,
  exerciseSchema,
  generateExercise,
  topics,
} from "../lib/exercise";

export default defineTool({
  approval: never(),
  description:
    "Get a math exercise together with its solution. Use this whenever the user asks for a math exercise, example, word problem or practice problem (for example 'adj egy matek példát'); do not make one up yourself. Show only the exercise and keep the solution hidden until the user replies with an answer or asks for the solution, then check their answer or reveal the solution. The exercise is written in Hungarian; translate it if the user writes in another language. Difficulty and topic are optional: leave them out for a random exercise, and use the word_problem topic for a story-style exercise (szöveges feladat).",
  inputSchema: z.object({
    difficulty: z
      .enum(difficulties)
      .optional()
      .describe("How hard the exercise should be, if the user asked for it."),
    topic: z
      .enum(topics)
      .optional()
      .describe("The area of the exercise, if the user asked for it."),
  }),
  outputSchema: exerciseSchema,
  async execute(input) {
    return generateExercise(input);
  },
});
