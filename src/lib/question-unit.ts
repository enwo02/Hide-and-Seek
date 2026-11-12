import { persistentAtom } from "@nanostores/persistent";

import type { Units } from "@/maps/schema";

export const defaultUnit = persistentAtom<Units>("defaultUnit", "kilometers");
