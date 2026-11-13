import swissCoverage from "./data/swiss-vector-coverage.json";

const mapHost = "https://hide-and-seek-maps.elio-wanner.workers.dev";

const regions = {
    ch: {
        name: "Switzerland",
        archive: `${mapHost}/ch/switzerland-20261110.pmtiles`,
        gameData: `${mapHost}/ch/game-data/`,
        coverage: swissCoverage.coordinates as number[][][],
    },
};

export function getMapRegion(countryCode?: string) {
    const code = countryCode?.toLowerCase();
    return code && Object.hasOwn(regions, code)
        ? regions[code as keyof typeof regions]
        : undefined;
}

export const defaultMapRegion = regions.ch;
