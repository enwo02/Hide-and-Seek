import { isLoading } from "./context";

let active: AbortController | undefined;

export const questionLoadingSignal = () => active?.signal;

export const beginQuestionLoading = () => {
    active = new AbortController();
    isLoading.set(true);
    return active;
};

export const finishQuestionLoading = (controller: AbortController) => {
    if (active !== controller) return;
    active = undefined;
    isLoading.set(false);
};

export const cancelQuestionLoading = () => {
    const controller = active;
    if (!controller) return;
    active = undefined;
    controller.abort();
    for (const cache of questionCaches) cache.clear?.();
    isLoading.set(false);
};

// Discard pending memoized answers so a canceled selection can be retried.
const questionCaches = new Set<{ clear?: () => void }>();
export const registerQuestionCache = (cache: { clear?: () => void }) => {
    questionCaches.add(cache);
};
