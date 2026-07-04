import { render, screen } from "@testing-library/react-native";
import App from "../../App";

describe("app scaffold", () => {
  it("renders the placeholder root", () => {
    render(<App />);
    expect(screen.getByText("CrossClipper")).toBeTruthy();
  });
});
