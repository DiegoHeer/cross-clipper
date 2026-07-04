import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/popup/App";

describe("scaffold", () => {
  it("renders the popup header", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
  });
});
