import { z } from "zod";

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

const gameAreaSchema = z.object({
    type: z.literal("Feature"),
    geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([
            z.number().min(-90).max(90),
            z.number().min(-180).max(180),
        ]),
    }),
    properties: z.object({
        osm_type: z.enum(["W", "R", "N"]),
        osm_id: z.number().int().positive(),
        name: z.string().min(1).max(256),
        type: z.string().max(128).default(""),
        osm_key: z.string().max(128).default(""),
        osm_value: z.string().max(128).default(""),
        countrycode: z.string().max(16).default(""),
        extent: z
            .tuple([
                z.number().min(-90).max(90),
                z.number().min(-180).max(180),
                z.number().min(-90).max(90),
                z.number().min(-180).max(180),
            ])
            .optional(),
        country: z.string().max(128).optional(),
        state: z.string().max(128).optional(),
    }),
});

export const parseGameArea = (value: unknown) => gameAreaSchema.parse(value);
