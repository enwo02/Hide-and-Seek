import type { Feature, FeatureCollection } from "geojson";

import {
    adjustPerDirection,
    directionPlanningPolygon,
    hiderifyDirection,
} from "./questions/direction";
import {
    adjustPerMatching,
    hiderifyMatching,
    matchingPlanningPolygon,
} from "./questions/matching";
import {
    adjustPerMeasuring,
    hiderifyMeasuring,
    measuringPlanningPolygon,
} from "./questions/measuring";
import {
    adjustPerRadius,
    hiderifyRadius,
    radiusPlanningPolygon,
} from "./questions/radius";
import {
    adjustPerTentacle,
    hiderifyTentacles,
    tentaclesPlanningPolygon,
} from "./questions/tentacles";
import {
    adjustPerThermometer,
    hiderifyThermometer,
    thermometerPlanningPolygon,
} from "./questions/thermometer";
import type { Question, Questions } from "./schema";

export * from "./geo-utils";

export const hiderifyQuestion = async (question: Question) => {
    if (question.data.drag) {
        switch (question.id) {
            case "direction":
                question.data = await hiderifyDirection(question.data);
                break;
            case "radius":
                question.data = await hiderifyRadius(question.data);
                break;
            case "thermometer":
                question.data = await hiderifyThermometer(question.data);
                break;
            case "tentacles":
                question.data = await hiderifyTentacles(question.data);
                break;
            case "matching":
                question.data = await hiderifyMatching(question.data);
                break;
            case "measuring":
                question.data = await hiderifyMeasuring(question.data);
                break;
        }
    }

    return question;
};

export const determinePlanningPolygon = async (
    question: Question,
    planningModeEnabled: boolean,
) => {
    if (
        (planningModeEnabled || question.id === "matching") &&
        question.data.drag &&
        !question.data.hidden
    ) {
        switch (question.id) {
            case "direction":
                return directionPlanningPolygon(question.data);
            case "radius":
                return radiusPlanningPolygon(question.data);
            case "thermometer":
                return thermometerPlanningPolygon(question.data);
            case "tentacles":
                return tentaclesPlanningPolygon(question.data);
            case "matching":
                return matchingPlanningPolygon(question.data);
            case "measuring":
                return measuringPlanningPolygon(question.data);
        }
    }
};

export async function adjustMapGeoDataForQuestion(
    question: any,
    mapGeoData: any,
) {
    if (question.data.hidden) {
        return mapGeoData;
    }

    try {
        switch (question?.id) {
            case "direction":
                return await adjustPerDirection(question.data, mapGeoData);
            case "radius":
                return await adjustPerRadius(question.data, mapGeoData);
            case "thermometer":
                return await adjustPerThermometer(question.data, mapGeoData);
            case "tentacles":
                if (question.data.location === false) {
                    return adjustPerRadius(
                        { ...question.data, within: false },
                        mapGeoData,
                    );
                }
                return await adjustPerTentacle(question.data, mapGeoData);
            case "matching":
                return await adjustPerMatching(question.data, mapGeoData);
            case "measuring":
                return await adjustPerMeasuring(question.data, mapGeoData);
            default:
                return mapGeoData;
        }
    } catch {
        return mapGeoData;
    }
}

export async function applyQuestionsToMapGeoData(
    questions: Questions,
    mapGeoData: any,
    planningModeEnabled: boolean,
    planningModeCallback?: (
        polygon: FeatureCollection | Feature,
        question: any,
    ) => void,
    signal?: AbortSignal,
): Promise<any> {
    for (const question of questions) {
        signal?.throwIfAborted();
        if (planningModeCallback) {
            const planningPolygon = await determinePlanningPolygon(
                question,
                planningModeEnabled,
            );
            signal?.throwIfAborted();
            if (planningPolygon) {
                planningModeCallback(planningPolygon, question);
            }
        }
        if (planningModeEnabled && question.data.drag) {
            continue;
        }

        mapGeoData = await adjustMapGeoDataForQuestion(question, mapGeoData);

        signal?.throwIfAborted();
        if (mapGeoData.type !== "FeatureCollection") {
            mapGeoData = {
                type: "FeatureCollection",
                features: [mapGeoData],
            };
        }
    }
    return mapGeoData;
}
