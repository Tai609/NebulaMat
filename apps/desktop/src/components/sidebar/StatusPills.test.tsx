import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatusPills } from "./StatusPills";
import { makeLeaf, useLayoutStore } from "@/lib/layout";
import { useRuntimeStore } from "@/lib/runtime";

beforeEach(() => {
  const leaf = makeLeaf(null);
  useLayoutStore.setState({
    groups: [{ id: "g0", name: "", tree: leaf, focusedLeafId: leaf.id, zoomedLeafId: null }],
    activeGroupId: "g0",
    tree: leaf,
    focusedLeafId: leaf.id,
    zoomedLeafId: null,
    ephemeralGroupId: null,
  });
  useRuntimeStore.setState({
    status: "ready",
    defaultModel: null,
    currentId: null,
    sessionModels: { [`draft:${leaf.id}`]: "openai/gpt-5" },
  });
});

afterEach(() => {
  useRuntimeStore.setState({ sessionModels: {}, defaultModel: null, currentId: null });
});

describe("StatusPills", () => {
  it("shows the focused pane model when it differs from the global default", () => {
    render(<StatusPills />);
    expect(screen.getByText("gpt-5")).toBeInTheDocument();
    expect(screen.queryByText("Not set")).toBeNull();
  });
});
