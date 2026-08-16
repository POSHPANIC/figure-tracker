import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  demandScore,
  pollPriority,
  selectByPriority,
  stalenessDays,
  type PollCandidate,
} from "./poll-priority";

const NOW = new Date("2026-08-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

function figure(over: Partial<PollCandidate> & { id: string }): PollCandidate {
  return {
    collectionCount: 0,
    wishlistCount: 0,
    viewCount: 0,
    releaseDate: null,
    lastPolledAt: null,
    ...over,
  };
}

describe("demandScore", () => {
  it("ranks owning above wishing above reading", () => {
    const owned = demandScore(figure({ id: "a", collectionCount: 1 }), NOW);
    const wished = demandScore(figure({ id: "b", wishlistCount: 1 }), NOW);
    const read = demandScore(figure({ id: "c", viewCount: 1 }), NOW);
    assert.ok(owned > wished, "owning should outrank wishing");
    assert.ok(wished > read, "wishing should outrank reading");
  });

  it("caps views so one busy afternoon cannot monopolise the budget", () => {
    const busy = demandScore(figure({ id: "a", viewCount: 100 }), NOW);
    const viral = demandScore(figure({ id: "b", viewCount: 100_000 }), NOW);
    assert.equal(busy, viral);
  });

  it("favours a recent release nobody has reacted to yet", () => {
    const fresh = demandScore(figure({ id: "a", releaseDate: daysAgo(30) }), NOW);
    const old = demandScore(figure({ id: "b", releaseDate: daysAgo(3000) }), NOW);
    assert.ok(fresh > old);
  });

  it("counts an upcoming release as recent", () => {
    // Preorders trade before release; a figure out next month matters now.
    const upcoming = demandScore(
      figure({ id: "a", releaseDate: new Date(NOW.getTime() + 60 * 86_400_000) }),
      NOW,
    );
    assert.ok(upcoming > 0);
  });

  it("gives a figure nobody has touched a score of zero", () => {
    assert.equal(demandScore(figure({ id: "a" }), NOW), 0);
  });
});

describe("stalenessDays", () => {
  it("treats never-polled as very stale rather than fresh", () => {
    assert.ok(stalenessDays(figure({ id: "a" }), NOW) > 30);
  });

  it("measures elapsed days", () => {
    assert.equal(stalenessDays(figure({ id: "a", lastPolledAt: daysAgo(3) }), NOW), 3);
  });

  it("never returns a negative age for a clock skewed into the future", () => {
    const future = new Date(NOW.getTime() + 86_400_000);
    assert.equal(stalenessDays(figure({ id: "a", lastPolledAt: future }), NOW), 0);
  });
});

describe("pollPriority", () => {
  it("puts a popular figure polled long ago at the top", () => {
    const wanted = figure({ id: "wanted", collectionCount: 5, lastPolledAt: daysAgo(7) });
    const ignored = figure({ id: "ignored", lastPolledAt: daysAgo(7) });
    assert.ok(pollPriority(wanted, NOW) > pollPriority(ignored, NOW));
  });

  it("deprioritises a popular figure polled this morning", () => {
    // Otherwise the same few figures would take the whole budget every run.
    const justDone = figure({ id: "a", collectionCount: 20, lastPolledAt: daysAgo(0.1) });
    const waiting = figure({ id: "b", collectionCount: 1, lastPolledAt: daysAgo(10) });
    assert.ok(pollPriority(waiting, NOW) > pollPriority(justDone, NOW));
  });

  it("still moves a figure nobody wants, given enough time", () => {
    // The tail has to keep turning over, or half the catalogue never updates.
    const ignoredForAges = figure({ id: "a", lastPolledAt: daysAgo(40) });
    assert.ok(pollPriority(ignoredForAges, NOW) > 0);
  });

  it("stops rewarding delay past the ceiling", () => {
    const a = figure({ id: "a", lastPolledAt: daysAgo(30) });
    const b = figure({ id: "b", lastPolledAt: daysAgo(300) });
    assert.equal(pollPriority(a, NOW), pollPriority(b, NOW));
  });
});

describe("selectByPriority", () => {
  it("takes the most deserving up to the limit", () => {
    const figures = [
      figure({ id: "cold", lastPolledAt: daysAgo(2) }),
      figure({ id: "owned", collectionCount: 3, lastPolledAt: daysAgo(2) }),
      figure({ id: "wished", wishlistCount: 3, lastPolledAt: daysAgo(2) }),
    ];
    assert.deepEqual(
      selectByPriority(figures, 2, NOW).map((f) => f.id),
      ["owned", "wished"],
    );
  });

  it("skips a figure polled moments ago rather than wasting the call", () => {
    const figures = [figure({ id: "a", collectionCount: 99, lastPolledAt: NOW })];
    assert.equal(selectByPriority(figures, 10, NOW).length, 0);
  });

  it("returns everything it can when the limit exceeds the catalogue", () => {
    const figures = [figure({ id: "a" }), figure({ id: "b" })];
    assert.equal(selectByPriority(figures, 100, NOW).length, 2);
  });
});
