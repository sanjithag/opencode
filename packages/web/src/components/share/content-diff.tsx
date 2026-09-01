import { parsePatch } from "diff"
import { createMemo, For } from "solid-js"
import { ContentCode } from "./content-code"
import styles from "./content-diff.module.css"

export type DiffRow = {
  left: string
  right: string
  type: "added" | "removed" | "unchanged" | "modified"
}

export type MobileBlock = {
  type: "removed" | "added" | "unchanged"
  lines: string[]
}

interface Props {
  diff: string
  lang?: string
}

export type LinePrefix = "-" | "+" | " "

// Collect a run of consecutive lines starting at `start` that share `prefix`.
// Returns the stripped content and the index just past the run.
export function collectConsecutive(
  lines: string[],
  start: number,
  prefix: LinePrefix
): { items: string[]; nextIndex: number } {
  const items: string[] = []
  let i = start
  while (i < lines.length && lines[i][0] === prefix) {
    items.push(lines[i].slice(1))
    i++
  }
  return { items, nextIndex: i }
}

// Zip a block of removed lines with a block of added lines into DiffRows.
// Extra removals become "removed" rows, extra additions become "added" rows.
export function pairRemovalsAndAdditions(removals: string[], additions: string[]): DiffRow[] {
  const rows: DiffRow[] = []
  const maxLength = Math.max(removals.length, additions.length)

  for (let k = 0; k < maxLength; k++) {
    const hasLeft = k < removals.length
    const hasRight = k < additions.length

    if (hasLeft && hasRight) {
      rows.push({ left: removals[k], right: additions[k], type: "modified" })
    } else if (hasLeft) {
      rows.push({ left: removals[k], right: "", type: "removed" })
    } else if (hasRight) {
      rows.push({ left: "", right: additions[k], type: "added" })
    }
  }

  return rows
}

export function unchangedRow(content: string): DiffRow {
  const value = content === "" ? " " : content
  return { left: value, right: value, type: "unchanged" }
}

// Walk one hunk's lines and produce all its DiffRows.
export function parseHunkLines(lines: string[]): DiffRow[] {
  const rows: DiffRow[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const prefix = line[0]

    if (prefix === "-") {
      const { items: removals, nextIndex: afterRemovals } = collectConsecutive(lines, i, "-")
      const { items: additions, nextIndex: afterAdditions } = collectConsecutive(
        lines,
        afterRemovals,
        "+"
      )
      rows.push(...pairRemovalsAndAdditions(removals, additions))
      i = afterAdditions
    } else if (prefix === "+") {
      rows.push({ left: "", right: line.slice(1), type: "added" })
      i++
    } else if (prefix === " ") {
      rows.push(unchangedRow(line.slice(1)))
      i++
    } else {
      i++
    }
  }

  return rows
}

// Starting at `start`, collect consecutive modified/removed/added rows into
// separate left/right line lists. Returns the index just past the run.
export function collectChangeBlock(
  rows: DiffRow[],
  start: number
): { removedLines: string[]; addedLines: string[]; nextIndex: number } {
  const removedLines: string[] = []
  const addedLines: string[] = []
  let i = start

  while (i < rows.length && (rows[i].type === "modified" || rows[i].type === "removed" || rows[i].type === "added")) {
    const row = rows[i]
    if (row.left && (row.type === "removed" || row.type === "modified")) {
      removedLines.push(row.left)
    }
    if (row.right && (row.type === "added" || row.type === "modified")) {
      addedLines.push(row.right)
    }
    i++
  }

  return { removedLines, addedLines, nextIndex: i }
}

// Group flat DiffRows into mobile blocks: consecutive changes are merged into
// a "removed" block followed by an "added" block, unchanged rows pass through
// individually.
export function buildMobileBlocks(rows: DiffRow[]): MobileBlock[] {
  const blocks: MobileBlock[] = []
  let i = 0

  while (i < rows.length) {
    const { removedLines, addedLines, nextIndex } = collectChangeBlock(rows, i)
    i = nextIndex

    if (removedLines.length > 0) {
      blocks.push({ type: "removed", lines: removedLines })
    }
    if (addedLines.length > 0) {
      blocks.push({ type: "added", lines: addedLines })
    }

    if (i < rows.length && rows[i].type === "unchanged") {
      blocks.push({ type: "unchanged", lines: [rows[i].left] })
      i++
    }
  }

  return blocks
}

// --- Rendering helpers ---

function beforeDiffType(type: DiffRow["type"]): "removed" | "" {
  return type === "removed" || type === "modified" ? "removed" : ""
}

function afterDiffType(type: DiffRow["type"]): "added" | "" {
  return type === "added" || type === "modified" ? "added" : ""
}

function mobileLineDiffType(blockType: MobileBlock["type"]): "removed" | "added" | "" {
  if (blockType === "removed") return "removed"
  if (blockType === "added") return "added"
  return ""
}

function DesktopDiffRow(props: { row: DiffRow; lang?: string }) {
  return (
    <div data-component="diff-row" data-type={props.row.type}>
      <div data-slot="before" data-diff-type={beforeDiffType(props.row.type)}>
        <ContentCode code={props.row.left} flush lang={props.lang} />
      </div>
      <div data-slot="after" data-diff-type={afterDiffType(props.row.type)}>
        <ContentCode code={props.row.right} lang={props.lang} flush />
      </div>
    </div>
  )
}

function MobileDiffBlock(props: { block: MobileBlock; lang?: string }) {
  return (
    <div data-component="diff-block" data-type={props.block.type}>
      <For each={props.block.lines}>
        {(line) => (
          <div data-diff-type={mobileLineDiffType(props.block.type)}>
            <ContentCode code={line} lang={props.lang} flush />
          </div>
        )}
      </For>
    </div>
  )
}

export function ContentDiff(props: Props) {
  const rows = createMemo(() => {
    try {
      const patches = parsePatch(props.diff)
      const diffRows: DiffRow[] = []

      for (const patch of patches) {
        for (const hunk of patch.hunks) {
          diffRows.push(...parseHunkLines(hunk.lines))
        }
      }

      return diffRows
    } catch (error) {
      console.error("Failed to parse patch:", error)
      return []
    }
  })

  const mobileRows = createMemo(() => buildMobileBlocks(rows()))

  return (
    <div class={styles.root}>
      <div data-component="desktop">
        <For each={rows()}>{(row) => <DesktopDiffRow row={row} lang={props.lang} />}</For>
      </div>

      <div data-component="mobile">
        <For each={mobileRows()}>{(block) => <MobileDiffBlock block={block} lang={props.lang} />}</For>
      </div>
    </div>
  )
}

// const testDiff = `--- combined_before.txt	2025-06-24 16:38:08
// +++ combined_after.txt	2025-06-24 16:38:12
// @@ -1,21 +1,25 @@
//  unchanged line
// -deleted line
// -old content
// +added line
// +new content
//
// -removed empty line below
// +added empty line above
//
// -	tab indented
// -trailing spaces
// -very long line that will definitely wrap in most editors and cause potential alignment issues when displayed in a two column diff view
// -unicode content: 🚀 ✨ 中文
// -mixed	content with	tabs and spaces
// +    space indented
// +no trailing spaces
// +short line
// +very long replacement line that will also wrap and test how the diff viewer handles long line additions after short line removals
// +different unicode: 🎉 💻 日本語
// +normalized content with consistent spacing
// +newline to content
//
// -content to remove
// -whitespace only:
// -multiple
// -consecutive
// -deletions
// -single deletion
// +
// +single addition
// +first addition
// +second addition
// +third addition
//  line before addition
// +first added line
// +
// +third added line
//  line after addition
//  final unchanged line`
