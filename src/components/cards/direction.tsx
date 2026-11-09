import { useStore } from "@nanostores/react";

import { LatitudeLongitude } from "@/components/LatLngPicker";
import { Label } from "@/components/ui/label";
import {
    MENU_ITEM_CLASSNAME,
    SidebarMenuItem,
} from "@/components/ui/sidebar-l";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
    hiderMode,
    isLoading,
    questionModified,
    questions,
    triggerLocalRefresh,
} from "@/lib/context";
import { cn } from "@/lib/utils";
import type { DirectionQuestion } from "@/maps/schema";

import { QuestionCard } from "./base";

export const DirectionQuestionComponent = ({
    data,
    questionKey,
    sub,
    className,
}: {
    data: DirectionQuestion;
    questionKey: number;
    sub?: string;
    className?: string;
}) => {
    useStore(triggerLocalRefresh);
    const $hiderMode = useStore(hiderMode);
    const $questions = useStore(questions);
    const $isLoading = useStore(isLoading);
    const label = `Direction
    ${
        $questions
            .filter((q) => q.id === "direction")
            .map((q) => q.key)
            .indexOf(questionKey) + 1
    }`;

    return (
        <QuestionCard
            questionKey={questionKey}
            label={label}
            sub={sub}
            className={className}
            collapsed={data.collapsed}
            setCollapsed={(collapsed) => {
                data.collapsed = collapsed; // Doesn't trigger a re-render so no need for questionModified
            }}
            locked={!data.drag}
            setLocked={(locked) => questionModified((data.drag = !locked))}
            hidden={data.hidden}
            setHidden={(hidden) => questionModified((data.hidden = hidden))}
        >
            <SidebarMenuItem>
                <div className={cn(MENU_ITEM_CLASSNAME, "gap-2 flex flex-row")}>
                    <ToggleGroup
                        type="single"
                        aria-label="Direction axis"
                        value={data.axis}
                        disabled={!data.drag || $isLoading}
                        onValueChange={(axis) => {
                            if (axis === "latitude" || axis === "longitude")
                                questionModified((data.axis = axis));
                        }}
                    >
                        <ToggleGroupItem value="latitude">
                            North / South
                        </ToggleGroupItem>
                        <ToggleGroupItem value="longitude">
                            East / West
                        </ToggleGroupItem>
                    </ToggleGroup>
                </div>
            </SidebarMenuItem>
            <p className="px-2 text-sm">
                Is the hider{" "}
                {data.axis === "latitude" ? "north or south" : "east or west"}{" "}
                of this location?
            </p>
            <LatitudeLongitude
                latitude={data.lat}
                longitude={data.lng}
                colorName={data.color}
                onChange={(lat, lng) => {
                    if (lat !== null) {
                        data.lat = lat;
                    }
                    if (lng !== null) {
                        data.lng = lng;
                    }
                    questionModified();
                }}
                disabled={!data.drag || $isLoading}
            />
            <div className="flex gap-2 items-center p-2">
                <Label
                    className={cn(
                        "font-semibold text-lg",
                        $isLoading && "text-muted-foreground",
                    )}
                >
                    Result
                </Label>
                <ToggleGroup
                    className="grow"
                    type="single"
                    aria-label="Hider direction"
                    value={data.positive ? "positive" : "negative"}
                    onValueChange={(value) => {
                        if (value)
                            questionModified(
                                (data.positive = value === "positive"),
                            );
                    }}
                    disabled={!!$hiderMode || !data.drag || $isLoading}
                >
                    <ToggleGroupItem value="negative">
                        {data.axis === "latitude" ? "South" : "West"}
                    </ToggleGroupItem>
                    <ToggleGroupItem value="positive">
                        {data.axis === "latitude" ? "North" : "East"}
                    </ToggleGroupItem>
                </ToggleGroup>
            </div>
        </QuestionCard>
    );
};
