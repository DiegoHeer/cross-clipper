import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeBrowser } from "./fakeBrowser";
import { setFakeBrowser } from "./polyfillMock";

const healthOk = { status: "ok", app: "crossclipper", version: "0.1.0", registration_open: false };

function fetchStub(overrides: { registrationOpen?: boolean; loginStatus?: number } = {}) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (u.endsWith("/health")) {
      return new Response(
        JSON.stringify({ ...healthOk, registration_open: overrides.registrationOpen ?? false }),
        { status: 200 },
      );
    }
    if (u.endsWith("/auth/register")) return new Response(JSON.stringify({ user_id: "u1" }), { status: 201 });
    if (u.endsWith("/auth/login")) {
      return new Response(JSON.stringify({ token: "tok", device_id: "dev1" }), {
        status: overrides.loginStatus ?? 200,
      });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls };
}

describe("suggestDeviceName", () => {
  it("derives OS and browser from the user agent", async () => {
    const { suggestDeviceName } = await import("../src/popup/onboarding/SignInStep");
    expect(suggestDeviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/126.0", "Win32")).toBe("Windows — Chrome");
    expect(suggestDeviceName("Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0", "Linux x86_64")).toBe("Linux — Firefox");
    expect(suggestDeviceName("Mozilla/5.0 Edg/126.0", "Win32")).toBe("Windows — Edge");
  });
});

describe("Onboarding", () => {
  let fake: ReturnType<typeof makeFakeBrowser>;
  beforeEach(() => {
    fake = makeFakeBrowser();
    fake.browser.runtime.onMessage.addListener(() => Promise.resolve({ ok: true }));
    setFakeBrowser(fake.browser);
    localStorage.clear();
  });

  it("walks Server → Sign in → Appearance and persists auth", async () => {
    const { fetchFn, calls } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const onComplete = vi.fn();
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(<Onboarding onComplete={onComplete} />);

    await userEvent.type(screen.getByPlaceholderText(/clip.example.com/), "http://127.0.0.1:8080");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    // step 2 (sign-in mode: registration closed)
    expect(await screen.findByText(/sign in/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    // step 3
    expect(await screen.findByText(/appearance/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /start using crossclipper/i }));
    expect(onComplete).toHaveBeenCalled();

    expect(calls.some((c) => c.url.endsWith("/auth/login"))).toBe(true);
    const stored = JSON.parse(String(fake.storageData["cc.auth"]));
    expect(stored).toMatchObject({ baseUrl: "http://127.0.0.1:8080", token: "tok", deviceId: "dev1" });
    vi.unstubAllGlobals();
  });

  it("first-run servers flip step 2 into account creation and register first", async () => {
    const { fetchFn, calls } = fetchStub({ registrationOpen: true });
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(<Onboarding onComplete={() => {}} />);
    await userEvent.type(screen.getByPlaceholderText(/clip.example.com/), "http://127.0.0.1:8080");
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(await screen.findByText(/create your account/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.c");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2!");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await screen.findByText(/appearance/i);
    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.endsWith("/auth/register"))).toBe(true);
    expect(urls.indexOf(urls.find((u) => u.endsWith("/auth/register"))!)).toBeLessThan(
      urls.indexOf(urls.find((u) => u.endsWith("/auth/login"))!),
    );
    vi.unstubAllGlobals();
  });

  it("reauth mode starts at step 2 with the server pre-filled and shows the notice", async () => {
    const { fetchFn } = fetchStub();
    vi.stubGlobal("fetch", fetchFn);
    const { Onboarding } = await import("../src/popup/onboarding/Onboarding");
    render(
      <Onboarding mode="reauth" initialServer="http://127.0.0.1:8080" notice="Session expired" onComplete={() => {}} />,
    );
    expect(await screen.findByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByText(/127\.0\.0\.1:8080/)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
