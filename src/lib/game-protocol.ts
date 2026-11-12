import { type Question, questionSchema } from "@/maps/schema";

export type Role = "hider" | "seeker";
export type SharedQuestion = {
    id: string;
    version: number;
    question: Question;
};
export type Change = {
    operation: string;
    id: string;
    version: number;
    question: Question | null;
};

export function sharedFields(value: unknown): Question {
    const question = questionSchema.parse(value);
    question.data.collapsed = false;
    question.data.hidden = false;
    // Tentacle search results can be recomputed by each device.
    if (
        question.id === "tentacles" &&
        question.data.locationType !== "custom"
    ) {
        delete question.data.places;
    }
    return question;
}
