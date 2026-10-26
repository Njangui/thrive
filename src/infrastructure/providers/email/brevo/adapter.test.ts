import { describe, expect, it, vi, afterEach } from "vitest";
import { BrevoAdapter, parseSender } from "./adapter";
import { BrevoClient } from "./client";

afterEach(() => vi.restoreAllMocks());

describe("parseSender", () => {
  it("sépare nom et adresse", () => {
    expect(parseSender("Flexco <noreply@flexco.app>")).toEqual({ name: "Flexco", email: "noreply@flexco.app" });
    expect(parseSender("noreply@flexco.app")).toEqual({ email: "noreply@flexco.app" });
  });
});

describe("BrevoAdapter", () => {
  it("appelle POST /v3/smtp/email avec l'en-tête api-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: "<abc@x>" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await new BrevoAdapter(new BrevoClient("k"), "Flexco <a@b.co>").sendEmail({ to: "u@x.co", subject: "S", html: "<p>x</p>" });
    expect(out).toEqual({ delivered: true, providerMessageId: "<abc@x>" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init as RequestInit).headers).toMatchObject({ "api-key": "k" });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ sender: { name: "Flexco", email: "a@b.co" }, to: [{ email: "u@x.co" }], htmlContent: "<p>x</p>" });
  });
  it("lève une erreur si Brevo refuse", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "unauthorized", message: "Key not found" }), { status: 401 })));
    await expect(new BrevoAdapter(new BrevoClient("k"), "a@b.co").sendEmail({ to: "u@x.co", subject: "S", html: "x" })).rejects.toThrow(/401 unauthorized/);
  });
});
