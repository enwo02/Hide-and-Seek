import { expect, it, vi } from "vitest";

vi.mock("@/maps/questions/matching", () => ({
    matchingPlanningPolygon: vi.fn(() => "outlines"),
}));
vi.mock("@/maps/questions/direction", () => ({}));
vi.mock("@/maps/questions/radius", () => ({}));
vi.mock("@/maps/questions/thermometer", () => ({}));
vi.mock("@/maps/questions/tentacles", () => ({}));
vi.mock("@/maps/questions/measuring", () => ({}));
vi.mock("@/maps/geo-utils", () => ({}));

import { determinePlanningPolygon } from "../src/maps";
import type { Question } from "../src/maps/schema";

it("shows matching outlines in normal mode only while the question is visible and editable", async () => {
    const question = {
        id: "matching",
        data: { drag: true, hidden: false },
    } as Question;
    expect(await determinePlanningPolygon(question, false)).toBe("outlines");
    expect(
        await determinePlanningPolygon(
            { ...question, data: { ...question.data, drag: false } },
            false,
        ),
    ).toBeUndefined();
    expect(
        await determinePlanningPolygon(
            { ...question, data: { ...question.data, hidden: true } },
            false,
        ),
    ).toBeUndefined();
    expect(
        await determinePlanningPolygon(
            { ...question, id: "radius" } as Question,
            false,
        ),
    ).toBeUndefined();
});
