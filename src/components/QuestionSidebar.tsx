import { useStore } from "@nanostores/react";
import { SidebarCloseIcon } from "lucide-react";

import {
    Sidebar,
    SidebarContent,
    SidebarContext,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar-l";
import {
    autoSave,
    isLoading,
    visibleQuestions,
    save,
    triggerLocalRefresh,
} from "@/lib/context";

import { cancelQuestionLoading } from "@/lib/question-loading";

import { gameSession } from "@/lib/game-client";
import { GameSession } from "./GameSession";
import { AddQuestionDialog } from "./AddQuestionDialog";
import {
    DirectionQuestionComponent,
    MatchingQuestionComponent,
    MeasuringQuestionComponent,
    RadiusQuestionComponent,
    TentacleQuestionComponent,
    ThermometerQuestionComponent,
} from "./QuestionCards";

export const QuestionSidebar = () => {
    useStore(triggerLocalRefresh);
    const $questions = useStore(visibleQuestions);
    const session = useStore(gameSession);
    const $autoSave = useStore(autoSave);
    const $isLoading = useStore(isLoading);

    return (
        <Sidebar>
            <div className="flex items-center justify-between">
                <h2 className="ml-4 mt-4 font-poppins text-2xl">Questions</h2>
                <SidebarCloseIcon
                    className="mr-2 visible md:hidden"
                    onClick={() => {
                        SidebarContext.get().setOpenMobile(false);
                    }}
                />
            </div>
            <GameSession />
            <SidebarContent>
                {$questions.map((question) => {
                    switch (question.id) {
                        case "direction":
                            return (
                                <DirectionQuestionComponent
                                    key={question.key}
                                    data={question.data}
                                    questionKey={question.key}
                                />
                            );
                        case "radius":
                            return (
                                <RadiusQuestionComponent
                                    data={question.data}
                                    key={question.key}
                                    questionKey={question.key}
                                />
                            );
                        case "thermometer":
                            return (
                                <ThermometerQuestionComponent
                                    data={question.data}
                                    key={question.key}
                                    questionKey={question.key}
                                />
                            );
                        case "tentacles":
                            return (
                                <TentacleQuestionComponent
                                    data={question.data}
                                    key={question.key}
                                    questionKey={question.key}
                                />
                            );
                        case "matching":
                            return (
                                <MatchingQuestionComponent
                                    data={question.data}
                                    key={question.key}
                                    questionKey={question.key}
                                />
                            );
                        case "measuring":
                            return (
                                <MeasuringQuestionComponent
                                    data={question.data}
                                    key={question.key}
                                    questionKey={question.key}
                                />
                            );
                        default:
                            return null;
                    }
                })}
            </SidebarContent>
            <SidebarGroup>
                <SidebarGroupContent>
                    <SidebarMenu data-tutorial-id="add-questions-buttons">
                        {$isLoading && (
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    onClick={cancelQuestionLoading}
                                >
                                    Cancel loading
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )}
                        {session?.role !== "hider" && (
                            <SidebarMenuItem>
                                <AddQuestionDialog>
                                    <SidebarMenuButton disabled={$isLoading}>
                                        Add Question
                                    </SidebarMenuButton>
                                </AddQuestionDialog>
                            </SidebarMenuItem>
                        )}
                        <SidebarMenuItem>
                            <a
                                href="https://github.com/taibeled/JetLagHideAndSeek"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                <SidebarMenuButton className="bg-emerald-600 transition-colors">
                                    Star this on GitHub! It&apos;s free :)
                                </SidebarMenuButton>
                            </a>
                        </SidebarMenuItem>
                        {session?.role !== "hider" && !$autoSave && (
                            <SidebarMenuItem>
                                <SidebarMenuButton
                                    className="bg-blue-600 p-2 rounded-md font-semibold font-poppins transition-shadow duration-500"
                                    onClick={save}
                                    disabled={$isLoading}
                                >
                                    Save
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        )}
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        </Sidebar>
    );
};
