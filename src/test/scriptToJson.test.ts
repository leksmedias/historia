import { describe, it, expect } from "vitest";
import {
  estimateSceneCount,
  chunkScript,
  parseJsonResponse,
  buildContinuityAnchor,
} from "../lib/scriptToJson";

describe("estimateSceneCount", () => {
  it("returns correct count at 15s per scene", () => {
    // 117 words/min × 15s/60 = 29.25 words/scene
    // 290 words / 29 words/scene ≈ 10 scenes
    expect(estimateSceneCount(290, 15)).toBe(10);
  });

  it("returns 1 for very short scripts", () => {
    expect(estimateSceneCount(10, 30)).toBe(1);
  });

  it("calculates correctly for all durations", () => {
    expect(estimateSceneCount(570, 10)).toBe(30); // 570/19 ≈ 30
    expect(estimateSceneCount(570, 20)).toBe(15); // 570/38 ≈ 15
    expect(estimateSceneCount(570, 30)).toBe(10); // 570/57 ≈ 10
  });
});

describe("chunkScript", () => {
  it("returns the whole script as one chunk when under limit", () => {
    const script = "Hello world. This is a test.";
    expect(chunkScript(script, 2000)).toEqual([script]);
  });

  it("splits into chunks that don't exceed maxWords", () => {
    // Build a script with 50 words per sentence × 10 sentences = 500 words
    const sentence = "word ".repeat(50).trim() + ".";
    const script = Array(10).fill(sentence).join(" ");
    const chunks = chunkScript(script, 200);
    for (const chunk of chunks) {
      const wordCount = chunk.split(/\s+/).filter(Boolean).length;
      expect(wordCount).toBeLessThanOrEqual(210); // small tolerance for sentence boundary
    }
    // All words are preserved across chunks
    const totalWords = chunks.join(" ").split(/\s+/).filter(Boolean).length;
    expect(totalWords).toBe(script.split(/\s+/).filter(Boolean).length);
  });

  it("does not split mid-sentence", () => {
    const sentence = "word ".repeat(100).trim() + ".";
    const script = Array(5).fill(sentence).join(" ");
    const chunks = chunkScript(script, 150);
    // Each chunk must end with a sentence terminator
    for (const chunk of chunks) {
      const trimmed = chunk.trim();
      expect(trimmed[trimmed.length - 1]).toMatch(/[.!?]/);
    }
  });
});

describe("parseJsonResponse", () => {
  it("parses clean JSON", () => {
    const input = '{"scenes":[{"id":1,"script":"test","overlay_text":null}]}';
    expect(parseJsonResponse(input)).toEqual({
      scenes: [{ id: 1, script: "test", overlay_text: null }],
    });
  });

  it("strips markdown code fences", () => {
    const input = '```json\n{"scenes":[]}\n```';
    expect(parseJsonResponse(input)).toEqual({ scenes: [] });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonResponse("not json")).toThrow();
  });

  it("handles JSON embedded after reasoning text", () => {
    const input = 'Some reasoning here...\n```json\n{"scenes":[]}\n```\nmore text';
    expect(parseJsonResponse(input)).toEqual({ scenes: [] });
  });
});

describe("buildContinuityAnchor", () => {
  it("returns empty string with no previous scenes", () => {
    expect(buildContinuityAnchor([])).toBe("");
  });

  it("returns anchor text for 1 previous scene", () => {
    const scenes = [{ script: "The river flows.", prompt: "Digital oil painting, the Rhine." }];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).toContain("PREVIOUS SCENES FOR VISUAL CONTINUITY");
    expect(anchor).toContain("The river flows.");
  });

  it("uses only the last 2 scenes when given more", () => {
    const scenes = [
      { script: "Scene 1.", prompt: "Prompt 1." },
      { script: "Scene 2.", prompt: "Prompt 2." },
      { script: "Scene 3.", prompt: "Prompt 3." },
    ];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).not.toContain("Scene 1.");
    expect(anchor).toContain("Scene 2.");
    expect(anchor).toContain("Scene 3.");
  });

  it("truncates long prompts to 80 characters", () => {
    const longPrompt = "A".repeat(200);
    const scenes = [{ script: "Short.", prompt: longPrompt }];
    const anchor = buildContinuityAnchor(scenes);
    expect(anchor).toContain("A".repeat(80) + "...");
    expect(anchor).not.toContain("A".repeat(81) + "...");
  });
});
