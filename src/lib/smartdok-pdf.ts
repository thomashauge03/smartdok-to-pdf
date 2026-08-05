import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ColMeta, Row } from "./smartdok-parser";
import { fmtSumNum, sumCol } from "./smartdok-parser";
import { computeColumnWidths, type TextMeasurer } from "./pdf-layout";
import logoAsset from "@/assets/hmLogo.png.asset.json";

export type PdfOrientation = "landscape" | "portrait";

const MARGIN = 14; // mm, left/right margin
const FONT_SIZE = 8;
const CELL_PADDING = 1.5; // mm, per side

async function loadLogo(): Promise<string> {
  const res = await fetch(logoAsset.url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/**
 * Measure text the same way autoTable will render it. The font is only switched
 * when the style actually changes, since this runs once per word in the table.
 */
function makeMeasurer(doc: jsPDF): TextMeasurer {
  let current: "normal" | "bold" | null = null;
  const use = (style: "normal" | "bold") => {
    if (current === style) return;
    doc.setFont("helvetica", style);
    doc.setFontSize(FONT_SIZE);
    current = style;
  };
  return {
    body: (t) => {
      use("normal");
      return doc.getTextWidth(t);
    },
    head: (t) => {
      use("bold");
      return doc.getTextWidth(t);
    },
  };
}

export async function generatePdf(
  rows: Row[],
  cols: ColMeta[],
  prosjekt: string,
  vedlegg: string,
  orientation: PdfOrientation = "landscape",
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const printableWidth = pageW - MARGIN * 2;

  // Header text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Prosjekt : ${prosjekt}`, MARGIN, 14);
  doc.text(`Vedlegg : ${vedlegg}`, MARGIN, 20);

  // Logo
  try {
    const logo = await loadLogo();
    doc.addImage(logo, "PNG", pageW - 40 - MARGIN, 6, 40, 26);
  } catch {
    // ignore
  }

  const headText = cols.map((c) => c.label);
  const bodyText: string[][] = rows.map((r) => cols.map((c) => r[c.key] ?? ""));

  // Sum row
  const firstSumIdx = cols.findIndex((c) => c.sum);
  const sumText =
    firstSumIdx < 0
      ? null
      : cols.map((c, i) => {
          if (c.sum) return fmtSumNum(sumCol(rows, c.key));
          if (i === firstSumIdx - 1) return "Sum";
          return "";
        });

  // Widths follow what the columns actually contain, so long comments get the
  // space that Dato/Timer would otherwise leave empty.
  const widths = computeColumnWidths(
    headText,
    sumText ? [...bodyText, sumText] : bodyText,
    printableWidth,
    makeMeasurer(doc),
    { padding: CELL_PADDING * 2 },
  );

  const body: any[][] = [...bodyText];
  if (sumText) {
    // Pin the fill so the sum row looks the same whichever side of the row
    // banding it happens to land on.
    body.push(
      sumText.map((text, i) => ({
        content: text,
        styles: {
          fontStyle: "bold",
          fillColor: [230, 230, 230],
          ...(i === firstSumIdx - 1 ? { halign: "right" } : {}),
        },
      })),
    );
  }

  const columnStyles: Record<number, any> = {};
  cols.forEach((c, i) => {
    columnStyles[i] = {
      cellWidth: widths[i],
      ...(c.align === "right" ? { halign: "right" } : {}),
    };
  });

  autoTable(doc, {
    startY: 36,
    margin: { left: MARGIN, right: MARGIN },
    head: [headText],
    body,
    styles: {
      fontSize: FONT_SIZE,
      cellPadding: CELL_PADDING,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "top",
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
      overflow: "linebreak",
      minCellHeight: 0,
    },
    // Banding keeps a tall multi-line row readable across the full width.
    alternateRowStyles: { fillColor: [244, 244, 244] },
    // Never split a comment across two pages.
    rowPageBreak: "avoid",
    columnStyles,
    theme: "grid",
  });

  return doc;
}

export function pdfFilename(prosjekt: string, vedlegg: string): string {
  const safe = (s: string) => s.replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "_");
  return `${safe(prosjekt)}_-_${safe(vedlegg)}.pdf`;
}
