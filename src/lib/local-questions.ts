import { persistentAtom } from "@nanostores/persistent";
import { atom } from "nanostores";

import { type Questions, questionsSchema } from "@/maps/schema";

export const questions = persistentAtom<Questions>("questions", [], {
    encode: JSON.stringify,
    decode: (value) => questionsSchema.parse(JSON.parse(value)),
});

export const triggerLocalRefresh = atom(0);
