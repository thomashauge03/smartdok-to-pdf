import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ColMeta, Row } from "./smartdok-parser";
import { fmtSumNum, sumCol } from "./smartdok-parser";
import logoAsset from "@/assets/hmLogo.png.asset.json";

export type PdfOrientation = "landscape" | "portrait";

const MARGIN = 14; // mm, left/right margin

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

/** Scale column widths proportionally so they fill exactly the printable width. */
function scaledWidths(cols: ColMeta[], printableWidth: number): number[] {
  const total = cols.reduce((s, c) => s + c.pdfWidth, 0);
  const scale = printableWidth / total;
  // Round to 2 decimals and distribute rounding error to last column
  const widths = cols.map((c) => Math.round(c.pdfWidth * scale * 100) / 100);
  const diff = printableWidth - widths.reduce((s, w) => s + w, 0);
  if (widths.length > 0) widths[widths.length - 1] = Math.round((widths[widths.length - 1] + diff) * 100) / 100;
  return widths;
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

  const head = [cols.map((c) => c.label)];
  const body: any[][] = rows.map((r) => cols.map((c) => r[c.key] ?? ""));

  // Sum row
  const firstSumIdx = cols.findIndex((c) => c.sum);
  if (firstSumIdx >= 0) {
    const sumRow: any[] = cols.map((c, i) => {
      if (c.sum) return { content: fmtSumNum(sumCol(rows, c.key)), styles: { fontStyle: "bold" } };
      if (i === firstSumIdx - 1) return { content: "Sum", styles: { fontStyle: "bold", halign: "right" } };
      return "";
    });
    body.push(sumRow);
  }

  // Scale all column widths to fill exactly one page width
  const widths = scaledWidths(cols, printableWidth);

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
    head,
    body,
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
      overflow: "linebreak",
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
    columnStyles,
    theme: "grid",
  });

  return doc;
}

export function pdfFilename(prosjekt: string, vedlegg: string): string {
  const safe = (s: string) => s.replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "_");
  return `${safe(prosjekt)}_-_${safe(vedlegg)}.pdf`;
}
