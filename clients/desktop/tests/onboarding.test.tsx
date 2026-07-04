import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "./tauriMock";
import { __setStore } from "../src/shared/settings";

// Stub requestBackground so SignInStep doesn't need a real Tauri bridge.
vi.mock("../src/shared/bridge", () => ({
  requestBackground: vi.fn().mockResolvedValue({ ok: true }),
  subscribeEvents: vi.fn().mockResolvedValue(() => {}),
  broadcast: vi.fn().mockResolvedValue(undefined),
  serveRequests: vi.fn().mockResolvedValue(() => {}),
}));

// Stub ApiClient constructor so we don't hit the network.
vi.mock("@crossclipper/core", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@crossclipper/core")>();
  class FakeApiClient {
    register = vi.fn().mockResolvedValue(undefined);
    login = vi.fn().mockResolvedValue({ token: "tok", device_id: "dev-id" });
  }
  return { ...orig, ApiClient: FakeApiClient };
});

function fetchStub(overrides: { registrationOpen?: boolean; loginStatus?: number } = {}) {
  const calls: { url: string }[] = [];
  const registrationOpen = overrides.registrationOpen ?? false;
  const loginStatus = overrides.loginStatus ?? 200;

  const fetchFn = vi.fn((url: string) => {
    calls.push({ url: url as string });
    if ((url as string).endsWith("/health")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ code: "ok", version: "0.1.0", registration_open: registrationOpen }),
          { status: 200 },
        ),
      );
    }
    if ((url as string).endsWith("/auth/register")) {
      return Promise.resolve(new Response("{}", { status: 201 }));
    }
    if ((url as string).endsWith("/auth/login")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ token: "tok", device_id: "did" }),
          { status: loginStatus },
        ),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as unknown as typeof fetch;

  return { fetchFn, calls };
}

describe("Onboarding", () => {
  beforeEach(() => {
    __setStore(new Store());
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("walks Server → Sign in → Appearance and calls onComplete", async () => {
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const onComplete = vi.fn();
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(<Onboarding onComplete={onComplete} />);

    await userEvent.type(
      screen.getByPlaceholderText(/clip.example.com/),
      "http://127.0.0.1:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    // step 2 (sign-in mode: registration closed)
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // step 3 — Appearance
    expect(await screen.findByText(/appearance/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /preview/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start using crossclipper/i }));
    expect(onComplete).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("first-run servers flip step 2 into account creation and register first", async () => {
    const { fetchFn, calls } = fetchStub({ registrationOpen: true });
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);
    await userEvent.type(
      screen.getByPlaceholderText(/clip.example.com/),
      "http://127.0.0.1:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(/create your account/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByText(/appearance/i);
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.endsWith("/health"))).toBe(true);
    vi.unstubAllGlobals();
  });

  it("reauth mode starts at step 2 with the server pre-filled and shows the notice", async () => {
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(
      <Onboarding
        mode="reauth"
        initialServer="http://127.0.0.1:8080"
        notice="Session expired"
        onComplete={() => {}}
      />,
    );
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8080/)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it("suggestDeviceName auto-fills device name from OS hostname (tauriMock returns 'test-host')", async () => {
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);

    await userEvent.type(
      screen.getByPlaceholderText(/clip.example.com/),
      "http://127.0.0.1:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    // Step 2 — wait for SignInStep to render and suggestDeviceName to resolve.
    // The tauriMock stubs plugin-os hostname() to return "test-host".
    await screen.findByRole("heading", { name: /sign in/i });
    const nameField = await screen.findByLabelText(/device name/i);
    expect(nameField).toHaveValue("test-host");
    vi.unstubAllGlobals();
  });

  it("suggestDeviceName does not clobber device name if user has already typed", async () => {
    // The field initialises to "This PC" synchronously, then the useEffect fires.
    // If the user edits the field before the promise resolves the touched guard
    // must prevent the effect from overwriting the user's input.
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);

    await userEvent.type(
      screen.getByPlaceholderText(/clip.example.com/),
      "http://127.0.0.1:8080",
    );
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    await screen.findByRole("heading", { name: /sign in/i });
    const nameField = await screen.findByLabelText(/device name/i);
    // Immediately overwrite with custom text (marks as touched)
    await userEvent.clear(nameField);
    await userEvent.type(nameField, "My Custom Name");
    // Wait for any pending effects
    await new Promise((r) => setTimeout(r, 20));
    // Touched guard: user input must be preserved, not overwritten by suggest
    expect(nameField).toHaveValue("My Custom Name");
    vi.unstubAllGlobals();
  });

  it("shows insecure http warning for public http servers in step 1", async () => {
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/main/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);
    await userEvent.type(
      screen.getByPlaceholderText(/clip.example.com/),
      "http://clip.example.com",
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
