import { describe, it, expect, beforeEach } from "vitest";
import { loadProviderSettings, saveProviderSettings } from "../lib/providers";

describe("skipImageGeneration setting", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to false when no settings saved", () => {
    const settings = loadProviderSettings();
    expect(settings.skipImageGeneration).toBe(false);
  });

  it("persists true when saved", () => {
    saveProviderSettings({ ...loadProviderSettings(), skipImageGeneration: true });
    const loaded = loadProviderSettings();
    expect(loaded.skipImageGeneration).toBe(true);
  });

  it("persists false when saved", () => {
    saveProviderSettings({ ...loadProviderSettings(), skipImageGeneration: false });
    const loaded = loadProviderSettings();
    expect(loaded.skipImageGeneration).toBe(false);
  });
});

describe("nvidia settings", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("has correct defaults when no settings saved", () => {
    const settings = loadProviderSettings();
    expect(settings.nvidiaApiKey).toBe("");
    expect(settings.textProvider).toBe("groq");
  });

  it("persists nvidia settings when saved", () => {
    saveProviderSettings({
      ...loadProviderSettings(),
      nvidiaApiKey: "test-key-123",
      textProvider: "nvidia",
    });
    const loaded = loadProviderSettings();
    expect(loaded.nvidiaApiKey).toBe("test-key-123");
    expect(loaded.textProvider).toBe("nvidia");
  });
});
