import { describe, it, expect } from "vitest";

// Simulates the concurrent worker pattern used in runAssetPipeline
async function runWithWorkers<T>(
  items: T[],
  workerCount: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array(Math.min(workerCount, items.length)).fill(null).map(async () => {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

describe("image pipeline concurrency", () => {
  it("processes 3 scenes at a time, not one by one", async () => {
    const scenes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const activeAtSameTime: number[] = [];
    let currentlyActive = 0;
    let maxActive = 0;
    const order: number[] = [];

    await runWithWorkers(scenes, 3, async (scene) => {
      currentlyActive++;
      if (currentlyActive > maxActive) maxActive = currentlyActive;
      activeAtSameTime.push(currentlyActive);

      // Simulate image generation delay
      await new Promise(r => setTimeout(r, 20));

      order.push(scene);
      currentlyActive--;
    });

    expect(order).toHaveLength(9);
    expect(maxActive).toBe(3); // never more than 3 at once
    // At some point 3 were running simultaneously
    expect(activeAtSameTime.some(n => n === 3)).toBe(true);
  });

  it("handles fewer scenes than worker count", async () => {
    const scenes = [1, 2];
    const completed: number[] = [];

    await runWithWorkers(scenes, 3, async (scene) => {
      await new Promise(r => setTimeout(r, 10));
      completed.push(scene);
    });

    expect(completed).toHaveLength(2);
  });

  it("shared state (counters) is safe with concurrent workers", async () => {
    const scenes = Array.from({ length: 12 }, (_, i) => i + 1);
    let completed = 0;
    let failed = 0;

    await runWithWorkers(scenes, 3, async (scene) => {
      await new Promise(r => setTimeout(r, Math.random() * 30));
      if (scene % 5 === 0) {
        failed++; // scenes 5 and 10 fail
      } else {
        completed++;
      }
    });

    expect(completed + failed).toBe(12);
    expect(failed).toBe(2); // scenes 5 and 10
    expect(completed).toBe(10);
  });

  it("stops processing when stopped flag is set", async () => {
    const scenes = Array.from({ length, length: 9 }, (_, i) => i + 1);
    let stopped = false;
    const processed: number[] = [];

    await runWithWorkers(scenes, 3, async (scene) => {
      if (stopped) return;
      await new Promise(r => setTimeout(r, 10));
      if (scene === 3) stopped = true; // stop after scene 3
      processed.push(scene);
    });

    // Should stop processing after the flag is set — not all 9 processed
    expect(processed.length).toBeLessThan(9);
  });
});
