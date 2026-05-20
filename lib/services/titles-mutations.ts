import "server-only";

import { readTitlesData, writeTitlesData } from "@/lib/db/titles";
import type { TitleTrigger, TitlesData } from "@/lib/validation/titles";

import { MissingTitlePrereqError } from "./titles";

// Lock / unlock are pure JSONB mutations (no LLM call). They read the whole
// titles_data, mutate one trigger, and write it back so the other two stay
// byte-for-byte identical.

export async function lockTitle(args: {
  runId: string;
  userId: string;
  trigger: TitleTrigger;
  titleText: string;
}): Promise<TitlesData> {
  const existing = await readTitlesData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingTitlePrereqError("no titles to lock");
  const variant = existing[args.trigger];
  if (!variant) throw new MissingTitlePrereqError(`no ${args.trigger} title`);

  const userEdited = args.titleText !== variant.text;
  const next: TitlesData = {
    ...existing,
    [args.trigger]: {
      ...variant,
      text: args.titleText,
      charCount: args.titleText.length,
      lockedIn: true,
      userEdited: variant.userEdited || userEdited,
    },
    updatedAt: new Date().toISOString(),
  };
  await writeTitlesData({ runId: args.runId, userId: args.userId }, next);
  return next;
}

export async function unlockTitle(args: {
  runId: string;
  userId: string;
  trigger: TitleTrigger;
}): Promise<TitlesData> {
  const existing = await readTitlesData({
    runId: args.runId,
    userId: args.userId,
  });
  if (!existing) throw new MissingTitlePrereqError("no titles to unlock");
  const variant = existing[args.trigger];
  if (!variant) throw new MissingTitlePrereqError(`no ${args.trigger} title`);

  const next: TitlesData = {
    ...existing,
    [args.trigger]: { ...variant, lockedIn: false },
    updatedAt: new Date().toISOString(),
  };
  await writeTitlesData({ runId: args.runId, userId: args.userId }, next);
  return next;
}
