/**
 * Content-aware column widths for the PDF table.
 *
 * The previous approach scaled a hardcoded width per column so the table filled
 * the page. That meant Dato, Tid and Timer sat on space they never used while
 * Kommentar wrapped long text into a tall, hard-to-read ribbon. Here we measure
 * what each column actually contains and hand the leftover space to the columns
 * that are still wrapping.
 */

export type TextMeasurer = {
  /** Width of `text` in mm using the body font. */
  body: (text: string) => number;
  /** Width of `text` in mm using the (bold) header font. */
  head: (text: string) => number;
};

export type LayoutOptions = {
  /** Total horizontal cell padding in mm (autoTable cellPadding * 2). */
  padding: number;
  /** Absolute floor for any column, in mm. */
  minWidth: number;
  /** A column's natural width is capped at this share of the printable width. */
  maxShare: number;
  /** Share of rows that should fit on one line at the natural width (0-1). */
  fitRatio: number;
};

const DEFAULTS: LayoutOptions = {
  padding: 3,
  minWidth: 8,
  maxShare: 0.5,
  fitRatio: 0.9,
};

/** A single very long word must not drag the whole table's floor up with it. */
const MAX_WORD_FLOOR_SHARE = 0.2;

const WORD_SPLIT = /\s+/;

type Demand = {
  /** Width at which the widest single line fits without wrapping. */
  greedy: number;
  /** Width at which most rows fit without wrapping. */
  natural: number;
  /** Below this the longest word gets chopped mid-word — never go under it. */
  floor: number;
};

/** Value at `ratio` through an ascending list, e.g. 0.9 → the 90th percentile. */
function percentile(sortedAsc: number[], ratio: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil(ratio * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))];
}

function measureColumn(
  header: string,
  values: string[],
  measure: TextMeasurer,
  opts: LayoutOptions,
  printableWidth: number,
): Demand {
  const headWidth = measure.head(header) + opts.padding;

  let headWordWidth = 0;
  for (const word of header.split(WORD_SPLIT)) {
    if (word) headWordWidth = Math.max(headWordWidth, measure.head(word) + opts.padding);
  }

  // One entry per physical line, since embedded newlines already wrap the text.
  const lineWidths: number[] = [];
  let wordWidth = 0;
  for (const value of values) {
    if (!value) continue;
    for (const line of value.split("\n")) {
      lineWidths.push(measure.body(line) + opts.padding);
      for (const word of line.split(WORD_SPLIT)) {
        if (word) wordWidth = Math.max(wordWidth, measure.body(word) + opts.padding);
      }
    }
  }
  lineWidths.sort((a, b) => a - b);

  const floor = Math.max(
    opts.minWidth,
    headWordWidth,
    Math.min(wordWidth, printableWidth * MAX_WORD_FLOOR_SHARE),
  );
  const greedy = Math.max(headWidth, lineWidths[lineWidths.length - 1] ?? 0, floor);
  const natural = Math.min(
    Math.max(headWidth, percentile(lineWidths, opts.fitRatio), floor),
    Math.max(floor, printableWidth * opts.maxShare),
  );

  return { greedy, natural, floor };
}

/**
 * Distribute `printableWidth` across the columns based on their actual content.
 * The returned widths always sum to exactly `printableWidth`.
 */
export function computeColumnWidths(
  header: string[],
  body: string[][],
  printableWidth: number,
  measure: TextMeasurer,
  options: Partial<LayoutOptions> = {},
): number[] {
  const n = header.length;
  if (n === 0 || printableWidth <= 0) return new Array(n).fill(0);

  const opts = { ...DEFAULTS, ...options };
  const demands = header.map((label, i) =>
    measureColumn(
      label,
      body.map((row) => row[i] ?? ""),
      measure,
      opts,
      printableWidth,
    ),
  );

  const widths = demands.map((d) => d.natural);
  const total = widths.reduce((s, w) => s + w, 0);

  if (total < printableWidth) {
    // Surplus goes to the columns whose content still wraps, in proportion to
    // how much they are still missing. Nobody is pushed past its greedy width.
    let surplus = printableWidth - total;
    const hunger = widths.map((w, i) => Math.max(0, demands[i].greedy - w));
    const totalHunger = hunger.reduce((s, h) => s + h, 0);
    if (totalHunger > 0) {
      const share = Math.min(surplus, totalHunger);
      for (let i = 0; i < n; i++) widths[i] += (share * hunger[i]) / totalHunger;
      surplus -= share;
    }
    // Every column already fits on one line — stretch them all so the table
    // still ends flush with the right margin.
    if (surplus > 0) {
      const base = widths.reduce((s, w) => s + w, 0);
      for (let i = 0; i < n; i++) widths[i] += (surplus * widths[i]) / base;
    }
  } else if (total > printableWidth) {
    // Take the deficit from whoever has slack above its floor.
    const deficit = total - printableWidth;
    const slack = widths.map((w, i) => Math.max(0, w - demands[i].floor));
    const totalSlack = slack.reduce((s, v) => s + v, 0);
    if (totalSlack > 0) {
      const share = Math.min(deficit, totalSlack);
      for (let i = 0; i < n; i++) widths[i] -= (share * slack[i]) / totalSlack;
    }
    // Not even the floors fit — too many columns for the page. Scale everything
    // down proportionally so the table stays inside the margins.
    const shrunk = widths.reduce((s, w) => s + w, 0);
    if (shrunk > printableWidth) {
      const k = printableWidth / shrunk;
      for (let i = 0; i < n; i++) widths[i] *= k;
    }
  }

  // Round to 2 decimals and give the rounding drift to the widest column, so
  // the table ends exactly on the margin without visibly skewing a narrow one.
  const rounded = widths.map((w) => Math.round(w * 100) / 100);
  const drift = printableWidth - rounded.reduce((s, w) => s + w, 0);
  let widest = 0;
  for (let i = 1; i < n; i++) if (rounded[i] > rounded[widest]) widest = i;
  rounded[widest] = Math.round((rounded[widest] + drift) * 100) / 100;

  return rounded;
}
