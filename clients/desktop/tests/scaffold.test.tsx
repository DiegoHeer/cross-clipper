import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/main/main";

describe("scaffold", () => {
  it("renders without crashing (loading splash shown before first snapshot)", () => {
    render(<App />);
    // Before the first WorkerEvent snapshot the app shows a loading splash.
    // The real header with "CrossClipper" appears once the bridge delivers state.
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
