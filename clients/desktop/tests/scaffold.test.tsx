import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "../src/main/main";

describe("scaffold", () => {
  it("renders the app name", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeInTheDocument();
  });
});
