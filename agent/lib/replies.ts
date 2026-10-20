import { randomBytes } from "node:crypto";

import type { Environment } from "./daily-exercise";

// Every email we send carries one of these ids, so a reply can be traced back
// to its environment and exercise through In-Reply-To or References.
const ownMessageId = /^<(production|development)\.(\d+)\.[0-9a-z]+@napi-matek>$/;

export function buildMessageId(
  environment: Environment,
  exerciseId: number,
  random = randomBytes(6).toString("hex"),
): string {
  return `<${environment}.${exerciseId}.${random}@napi-matek>`;
}

export function parseMessageIds(
  values: string[],
): Array<{ environment: Environment; exerciseId: number }> {
  return values
    .flatMap((value) => value.match(/<[^<>\s]+>/g) ?? [])
    .flatMap((id) => {
      const match = ownMessageId.exec(id);

      return match
        ? [{ environment: match[1] as Environment, exerciseId: Number(match[2]) }]
        : [];
    });
}

export function referencesOwnMessage(values: string[]): boolean {
  return parseMessageIds(values).length > 0;
}
