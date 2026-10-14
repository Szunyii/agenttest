import { generateText, Output } from "ai";
import { anthropic } from "eve/models/anthropic";

import z from "zod";

export const difficulties = ["easy", "medium", "hard"] as const;
export const topics = [
  "arithmetic",
  "algebra",
  "geometry",
  "word_problem",
] as const;

export type Difficulty = (typeof difficulties)[number];
export type Topic = (typeof topics)[number];

const model = "claude-sonnet-5-5";

const difficultyHints: Record<Difficulty, string> = {
  easy: "one or two simple steps with small whole numbers",
  medium: "two or three steps, for example percentages or a short word problem",
  hard: "several steps or a well-known formula, for example Pythagoras or a quadratic equation",
};

const topicHints: Record<Topic, string> = {
  arithmetic: "arithmetic, fractions or percentages",
  algebra: "equations or expressions",
  geometry: "plane geometry: perimeter, area, angles or Pythagoras",
  word_problem: [
    "a short everyday story (szöveges feladat) that the student has to turn into math.",
    "Match the style of this example, but do not reuse its story:",
    "Egy csiga minden nap 4 métert halad felfelé egy fán, éjszaka visszacsúszik 3 métert. Milyen magas a fa, ha a kilencedik napon éri el a tetejét?",
    "Megoldás: 8 nap alatt 8 métert jut feljebb, a 9. napon még 4 métert mászik, tehát a fa 12 méter magas.",
  ].join("\n"),
};

export const exerciseSchema = z.object({
  difficulty: z.enum(difficulties),
  topic: z.enum(topics),
  exercise: z.string().describe("The exercise text to show to the user."),
  solution: z
    .string()
    .describe("The worked solution. Keep it hidden until the user asks."),
});

export type Exercise = z.infer<typeof exerciseSchema>;

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export async function generateExercise(input: {
  difficulty?: Difficulty;
  topic?: Topic;
}): Promise<Exercise> {
  // Models are poor at randomness, so pick the missing parameters in code.
  const difficulty = input.difficulty ?? pick(difficulties);
  const topic = input.topic ?? pick(topics);
  const seedNumbers = Array.from(
    { length: 3 },
    () => 2 + Math.floor(Math.random() * 40),
  );

  const { output } = await generateText({
    model: anthropic(model),
    output: Output.object({
      schema: exerciseSchema.pick({ exercise: true, solution: true }),
    }),
    system:
      "You write math exercises for students. Write the exercise and its worked solution in Hungarian. The exercise must be self-contained, have exactly one correct final answer, and match the requested topic and difficulty. Work the solution out step by step and double-check it before answering.",
    prompt: [
      `Topic: ${topicHints[topic]}`,
      `Difficulty: ${difficulty} (${difficultyHints[difficulty]})`,
      `Use these numbers as inspiration so the exercise differs every time: ${seedNumbers.join(", ")}. Change them if needed to get a clean result.`,
    ].join("\n"),
  });

  return { difficulty, topic, ...output };
}
