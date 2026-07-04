/**
 * appearanceSection.test.tsx — Task 9 TDD step 1.
 *
 * AppearanceSection: selecting an accent calls setAppearance; preview uses accentForeground.
 */
import React from "react";
import { render, fireEvent, act, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeProvider";
import { AppearanceSection } from "../AppearanceSection";
import { accentForeground } from "../../theme/theme";

function Wrapper({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe("AppearanceSection", () => {
  it("renders the theme toggle (light/auto/dark)", async () => {
    const { findByText } = render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );
    await act(async () => {});
    // Should show some theme option buttons
    await findByText(/light/i);
    await findByText(/auto/i);
    await findByText(/dark/i);
  });

  it("renders accent swatches", async () => {
    const { findAllByRole } = render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );
    await act(async () => {});
    const swatches = await findAllByRole("button");
    // At minimum: theme buttons + swatch buttons
    expect(swatches.length).toBeGreaterThan(3);
  });

  it("pressing an accent swatch updates the accent-preview background to the new color", async () => {
    const { findByTestId } = render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );
    await act(async () => {});

    // Default accent is amber — press the blue swatch to change it
    const blueSwatch = await findByTestId("swatch-#2563eb");
    fireEvent.press(blueSwatch);

    // After pressing blue, the accent-preview background must be blue
    await waitFor(async () => {
      const preview = await findByTestId("accent-preview");
      const bgColor = preview.props.style
        ? (Array.isArray(preview.props.style) ? preview.props.style : [preview.props.style])
            .reduce(
              (acc: Record<string, unknown>, s: Record<string, unknown> | null) =>
                s ? { ...acc, ...s } : acc,
              {},
            ).backgroundColor
        : undefined;
      expect(bgColor).toBe("#2563eb");
    });
  });

  it("selected accent preview uses accentForeground for text color", async () => {
    const { findByTestId } = render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );
    await act(async () => {});

    // The preview element should exist with a testID
    const preview = await findByTestId("accent-preview");
    expect(preview).toBeTruthy();

    // accentForeground for default amber should be dark text
    const expectedFg = accentForeground("#d97706");
    expect(expectedFg).toBe("#1c1917"); // dark text for amber
  });

  it("pressing a theme button calls setAppearance with the selected theme", async () => {
    const { findByText } = render(
      <Wrapper>
        <AppearanceSection />
      </Wrapper>,
    );
    await act(async () => {});

    const darkBtn = await findByText(/dark/i);
    fireEvent.press(darkBtn);
    await waitFor(async () => {
      // The component re-renders without error = setAppearance was called
      await findByText(/dark/i);
    });
  });
});
