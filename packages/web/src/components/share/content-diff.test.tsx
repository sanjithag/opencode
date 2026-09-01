import { describe, expect, test } from "bun:test"
import {
  collectConsecutive,
  pairRemovalsAndAdditions,
  unchangedRow,
  parseHunkLines,
  collectChangeBlock,
  buildMobileBlocks,
  type DiffRow,
} from "./content-diff"

describe("collectConsecutive", () => {
  test("collects a run of matching-prefix lines", () => {
    const lines = ["-a", "-b", "+c", " d"]
    const result = collectConsecutive(lines, 0, "-")
    expect(result.items).toEqual(["a", "b"])
    expect(result.nextIndex).toBe(2)
  })

  test("returns empty items when the prefix doesn't match at start", () => {
    const lines = ["+a", "-b"]
    const result = collectConsecutive(lines, 0, "-")
    expect(result.items).toEqual([])
    expect(result.nextIndex).toBe(0)
  })
})

describe("pairRemovalsAndAdditions", () => {
  test("pairs equal-length removals and additions as modified", () => {
    const rows = pairRemovalsAndAdditions(["old1", "old2"], ["new1", "new2"])
    expect(rows).toEqual([
      { left: "old1", right: "new1", type: "modified" },
      { left: "old2", right: "new2", type: "modified" },
    ])
  })

  test("extra removals become pure removed rows", () => {
    const rows = pairRemovalsAndAdditions(["old1", "old2", "old3"], ["new1"])
    expect(rows).toEqual([
      { left: "old1", right: "new1", type: "modified" },
      { left: "old2", right: "", type: "removed" },
      { left: "old3", right: "", type: "removed" },
    ])
  })

  test("extra additions become pure added rows", () => {
    const rows = pairRemovalsAndAdditions(["old1"], ["new1", "new2", "new3"])
    expect(rows).toEqual([
      { left: "old1", right: "new1", type: "modified" },
      { left: "", right: "new2", type: "added" },
      { left: "", right: "new3", type: "added" },
    ])
  })

  test("handles empty removals (pure additions)", () => {
    const rows = pairRemovalsAndAdditions([], ["new1"])
    expect(rows).toEqual([{ left: "", right: "new1", type: "added" }])
  })

  test("handles empty additions (pure removals)", () => {
    const rows = pairRemovalsAndAdditions(["old1"], [])
    expect(rows).toEqual([{ left: "old1", right: "", type: "removed" }])
  })
})

describe("unchangedRow", () => {
  test("uses content directly when non-empty", () => {
    expect(unchangedRow("hello")).toEqual({ left: "hello", right: "hello", type: "unchanged" })
  })

  test("substitutes a single space for empty content", () => {
    expect(unchangedRow("")).toEqual({ left: " ", right: " ", type: "unchanged" })
  })
})

describe("parseHunkLines", () => {
  test("parses a simple modification", () => {
    const lines = [" unchanged", "-old", "+new", " unchanged2"]
    const rows = parseHunkLines(lines)
    expect(rows).toEqual([
      { left: "unchanged", right: "unchanged", type: "unchanged" },
      { left: "old", right: "new", type: "modified" },
      { left: "unchanged2", right: "unchanged2", type: "unchanged" },
    ])
  })

  test("parses a standalone addition (no preceding removal)", () => {
    const lines = ["+added"]
    const rows = parseHunkLines(lines)
    expect(rows).toEqual([{ left: "", right: "added", type: "added" }])
  })

  test("parses consecutive removals with no following additions", () => {
    const lines = ["-a", "-b"]
    const rows = parseHunkLines(lines)
    expect(rows).toEqual([
      { left: "a", right: "", type: "removed" },
      { left: "b", right: "", type: "removed" },
    ])
  })

  test("handles mismatched removal/addition block lengths", () => {
    const lines = ["-a", "-b", "-c", "+x"]
    const rows = parseHunkLines(lines)
    expect(rows).toEqual([
      { left: "a", right: "x", type: "modified" },
      { left: "b", right: "", type: "removed" },
      { left: "c", right: "", type: "removed" },
    ])
  })

  test("skips unrecognized line prefixes without crashing", () => {
    const lines = ["\\ No newline at end of file", " ok"]
    const rows = parseHunkLines(lines)
    expect(rows).toEqual([{ left: "ok", right: "ok", type: "unchanged" }])
  })

  test("returns empty array for empty input", () => {
    expect(parseHunkLines([])).toEqual([])
  })
})

describe("collectChangeBlock", () => {
  test("collects consecutive modified/removed/added rows", () => {
    const rows: DiffRow[] = [
      { left: "a", right: "b", type: "modified" },
      { left: "c", right: "", type: "removed" },
      { left: "", right: "d", type: "added" },
      { left: "e", right: "e", type: "unchanged" },
    ]
    const result = collectChangeBlock(rows, 0)
    expect(result.removedLines).toEqual(["a", "c"])
    expect(result.addedLines).toEqual(["b", "d"])
    expect(result.nextIndex).toBe(3)
  })

  test("stops immediately at an unchanged row", () => {
    const rows: DiffRow[] = [{ left: "e", right: "e", type: "unchanged" }]
    const result = collectChangeBlock(rows, 0)
    expect(result.removedLines).toEqual([])
    expect(result.addedLines).toEqual([])
    expect(result.nextIndex).toBe(0)
  })
})

describe("buildMobileBlocks", () => {
  test("groups a modified row into separate removed/added blocks", () => {
    const rows: DiffRow[] = [{ left: "old", right: "new", type: "modified" }]
    const blocks = buildMobileBlocks(rows)
    expect(blocks).toEqual([
      { type: "removed", lines: ["old"] },
      { type: "added", lines: ["new"] },
    ])
  })

  test("passes unchanged rows through individually", () => {
    const rows: DiffRow[] = [
      { left: "a", right: "a", type: "unchanged" },
      { left: "b", right: "b", type: "unchanged" },
    ]
    const blocks = buildMobileBlocks(rows)
    expect(blocks).toEqual([
      { type: "unchanged", lines: ["a"] },
      { type: "unchanged", lines: ["b"] },
    ])
  })

  test("interleaves change blocks and unchanged rows correctly", () => {
    const rows: DiffRow[] = [
      { left: "x", right: "x", type: "unchanged" },
      { left: "old", right: "new", type: "modified" },
      { left: "y", right: "y", type: "unchanged" },
    ]
    const blocks = buildMobileBlocks(rows)
    expect(blocks).toEqual([
      { type: "unchanged", lines: ["x"] },
      { type: "removed", lines: ["old"] },
      { type: "added", lines: ["new"] },
      { type: "unchanged", lines: ["y"] },
    ])
  })

  test("returns empty array for empty input", () => {
    expect(buildMobileBlocks([])).toEqual([])
  })
})