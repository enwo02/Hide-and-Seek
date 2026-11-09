import { atom } from "nanostores";

export type SidebarState = {
    state: "expanded" | "collapsed";
    open: boolean;
    setOpen: (open: boolean) => void;
    openMobile: boolean;
    setOpenMobile: (open: boolean) => void;
    isMobile: boolean;
    toggleSidebar: () => void;
};

// Controls live in separate hydrated components, so they must also work before
// a provider registers its React callbacks (and after a development refresh).
export function createSidebarState(defaultOpen: boolean) {
    const setOpen = (open: boolean) => {
        store.set({
            ...store.get(),
            open,
            state: open ? "expanded" : "collapsed",
        });
    };
    const setOpenMobile = (openMobile: boolean) => {
        store.set({ ...store.get(), openMobile });
    };
    const toggleSidebar = () => {
        const current = store.get();
        const isMobile =
            typeof window !== "undefined"
                ? window.matchMedia("(max-width: 767px)").matches
                : current.isMobile;
        store.set({ ...current, isMobile });
        if (isMobile) setOpenMobile(!current.openMobile);
        else setOpen(!current.open);
    };
    const store = atom<SidebarState>({
        state: defaultOpen ? "expanded" : "collapsed",
        open: defaultOpen,
        setOpen,
        openMobile: false,
        setOpenMobile,
        isMobile: false,
        toggleSidebar,
    });
    return store;
}

export const questionSidebarState = createSidebarState(true);
export const hidingZoneSidebarState = createSidebarState(false);
