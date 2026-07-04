/**
 * composer.test.tsx — Task 7 TDD step 1 (failing).
 *
 * Composer: typing + send → onSend called with detectKind applied; empties after.
 */
import React from "react";
import { render, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { Composer } from "../Composer";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("Composer", () => {
  it("calls onSend with text kind for plain text", () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByRole } = render(
      <Wrapper>
        <Composer onSend={onSend} />
      </Wrapper>,
    );
    fireEvent.changeText(getByPlaceholderText(/type.*paste/i), "hello world");
    fireEvent.press(getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("text", "hello world", null);
  });

  it("calls onSend with link kind for a lone URL", () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByRole } = render(
      <Wrapper>
        <Composer onSend={onSend} />
      </Wrapper>,
    );
    fireEvent.changeText(
      getByPlaceholderText(/type.*paste/i),
      "https://example.com",
    );
    fireEvent.press(getByRole("button", { name: /send/i }));
    expect(onSend).toHaveBeenCalledWith("link", "https://example.com", null);
  });

  it("empties the text field after send", () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByRole } = render(
      <Wrapper>
        <Composer onSend={onSend} />
      </Wrapper>,
    );
    const input = getByPlaceholderText(/type.*paste/i);
    fireEvent.changeText(input, "some text");
    fireEvent.press(getByRole("button", { name: /send/i }));
    expect(input.props.value).toBe("");
  });

  it("ignores send if body is empty", () => {
    const onSend = jest.fn();
    const { getByRole } = render(
      <Wrapper>
        <Composer onSend={onSend} />
      </Wrapper>,
    );
    fireEvent.press(getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("ignores send if body is only whitespace", () => {
    const onSend = jest.fn();
    const { getByPlaceholderText, getByRole } = render(
      <Wrapper>
        <Composer onSend={onSend} />
      </Wrapper>,
    );
    fireEvent.changeText(getByPlaceholderText(/type.*paste/i), "   ");
    fireEvent.press(getByRole("button", { name: /send/i }));
    expect(onSend).not.toHaveBeenCalled();
  });
});
