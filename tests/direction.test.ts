import * as turf from "@turf/turf";
import { atom } from "nanostores";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/context", () => ({
    defaultUnit: atom("miles"),
    hiderMode: atom(false),
}));

import { hiderMode } from "@/lib/context";
import {
    adjustPerDirection,
    directionPlanningPolygon,
    hiderifyDirection,
} from "../src/maps/questions/direction";
import { questionSchema, type DirectionQuestion } from "../src/maps/schema";

const makeQuestion = (data: Partial<DirectionQuestion> = {}) =>
    questionSchema.parse({
        id: "direction",
        data: { lat: 47.4, lng: 8.5, ...data },
    }).data as DirectionQuestion;

beforeEach(() => hiderMode.set(false));

describe("direction questions", () => {
    it.each([
        ["latitude", true, [8, 47.4, 9, 48]],
        ["latitude", false, [8, 47, 9, 47.4]],
        ["longitude", true, [8.5, 47, 9, 48]],
        ["longitude", false, [8, 47, 8.5, 48]],
    ] as const)(
        "keeps the correct half for %s / %s",
        async (axis, positive, expected) => {
            const result = await adjustPerDirection(
                makeQuestion({ axis, positive }),
                turf.featureCollection([turf.bboxPolygon([8, 47, 9, 48])]),
            );
            expect(turf.bbox(result!)).toEqual(expected);
        },
    );

    it("handles a wholly excluded area and polar edge without invalid polygons", async () => {
        const area = turf.featureCollection([turf.bboxPolygon([8, 47, 9, 48])]);
        expect(
            (await adjustPerDirection(makeQuestion({ lat: 49 }), area))
                ?.features,
        ).toEqual([]);
        expect(
            (await adjustPerDirection(makeQuestion({ lat: 90 }), area))
                ?.features,
        ).toEqual([]);
    });

    it("preserves holes and disconnected areas", async () => {
        const polygon = turf.polygon([
            [
                [8, 47],
                [9, 47],
                [9, 48],
                [8, 48],
                [8, 47],
            ],
            [
                [8.6, 47.6],
                [8.6, 47.8],
                [8.8, 47.8],
                [8.8, 47.6],
                [8.6, 47.6],
            ],
        ]);
        const result = await adjustPerDirection(
            makeQuestion(),
            turf.featureCollection([
                polygon,
                turf.bboxPolygon([10, 47.6, 11, 48]),
            ]),
        );
        expect(result?.features).toHaveLength(2);
        expect(
            turf.booleanPointInPolygon([8.7, 47.7], result!.features[0]),
        ).toBe(false);
        expect(
            turf.booleanPointInPolygon([8.9, 47.7], result!.features[0]),
        ).toBe(true);
    });

    it("automatically answers each axis in hider mode, including ties", async () => {
        hiderMode.set({ latitude: 47.5, longitude: 8.4 });
        expect((await hiderifyDirection(makeQuestion())).positive).toBe(true);
        expect(
            (await hiderifyDirection(makeQuestion({ axis: "longitude" })))
                .positive,
        ).toBe(false);
        hiderMode.set({ latitude: 47.4, longitude: 8.5 });
        expect((await hiderifyDirection(makeQuestion())).positive).toBe(true);
    });

    it("draws the dividing parallel or meridian for planning", async () => {
        expect(
            (await directionPlanningPolygon(makeQuestion())).geometry
                .coordinates,
        ).toEqual([
            [-180, 47.4],
            [180, 47.4],
        ]);
        expect(
            (
                await directionPlanningPolygon(
                    makeQuestion({ axis: "longitude" }),
                )
            ).geometry.coordinates,
        ).toEqual([
            [8.5, -90],
            [8.5, 90],
        ]);
    });

    it("round trips saved questions and rejects invalid axes", () => {
        const question = questionSchema.parse({
            id: "direction",
            data: { lat: 47.4, lng: 8.5 },
        });
        expect(
            questionSchema.parse(JSON.parse(JSON.stringify(question))),
        ).toEqual(question);
        expect(
            questionSchema.safeParse({
                ...question,
                data: { ...question.data, axis: "invalid" },
            }).success,
        ).toBe(false);
    });
});
