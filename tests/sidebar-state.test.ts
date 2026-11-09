import { afterEach, expect, it, vi } from "vitest";

import { createSidebarState } from "../src/lib/sidebar-state";

afterEach(() => vi.unstubAllGlobals());

it("opens and closes a desktop sidebar before provider initialization", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const sidebar = createSidebarState(true);
    sidebar.get().toggleSidebar();
    expect(sidebar.get().state).toBe("collapsed");
    expect(sidebar.get().open).toBe(false);
    sidebar.get().toggleSidebar();
    expect(sidebar.get().state).toBe("expanded");
});

it("toggles the mobile sheet independently of the desktop state", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const sidebar = createSidebarState(false);
    sidebar.get().toggleSidebar();
    expect(sidebar.get().openMobile).toBe(true);
    expect(sidebar.get().open).toBe(false);
    sidebar.get().setOpenMobile(false);
    expect(sidebar.get().openMobile).toBe(false);
});

it("keeps left and right sidebars independent", () => {
    const left = createSidebarState(true);
    const right = createSidebarState(false);
    right.get().setOpen(true);
    left.get().setOpen(false);
    expect(right.get().state).toBe("expanded");
    expect(left.get().state).toBe("collapsed");
});
