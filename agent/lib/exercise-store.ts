import { Redis } from "@upstash/redis";

import type { ExerciseRecord } from "./daily-exercise";

function getRedis(): Redis {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "Missing Redis credentials: set KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).",
    );
  }

  return new Redis({ url, token });
}

export function createExerciseStore(key: string) {
  return {
    async getLast(): Promise<ExerciseRecord | null> {
      return (await getRedis().get<ExerciseRecord>(key)) ?? null;
    },
    async saveLast(record: ExerciseRecord): Promise<void> {
      await getRedis().set(key, record);
    },
  };
}
