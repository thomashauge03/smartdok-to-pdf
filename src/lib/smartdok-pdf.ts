import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { ColKey, Row } from "./smartdok-parser";
import { COLUMNS, fmtSumNum, sumCol } from "./smartdok-parser";
import logoAsset from "@/assets/hmLogo.png.asset.json";

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

export async function generatePdf(
  rows: Row[],
  visibleCols: ColKey[],
  prosjekt: string,
  vedlegg: string,
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Prosjekt : ${prosjekt}`, 14, 14);
  doc.text(`Vedlegg : ${vedlegg}`, 14, 20);

  try {
    const logo = await loadLogo();
    const pageW = doc.internal.pageSize.getWidth();
    doc.addImage(logo, "PNG", pageW - 40 - 14, 6, 40, 26);
  } catch {
    // ignore
  }

  const cols = COLUMNS.filter((c) => visibleCols.includes(c.key));
  const head = [cols.map((c) => c.label)];
  const body: any[][] = rows.map((r) => cols.map((c) => r[c.key]));

  // Sum row: put "Sum" label in first cell (or before first sum), and each sum column shows its total
  const firstSumIdx = cols.findIndex((c) => c.sum);
  if (firstSumIdx >= 0) {
    const sumRow: any[] = cols.map((c, i) => {
      if (c.sum) return { content: fmtSumNum(sumCol(rows, c.key)), styles: { fontStyle: "bold" } };
      if (i === firstSumIdx - 1) return { content: "Sum", styles: { fontStyle: "bold", halign: "right" } };
      return "";
    });
    body.push(sumRow);
  }

  const columnStyles: Record<number, any> = {};
  cols.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.pdfWidth, ...(c.align === "right" ? { halign: "right" } : {}) };
  });

  autoTable(doc, {
    startY: 36,
    head,
    body,
    styles: { fontSize: 8, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", lineWidth: 0.1, lineColor: [0, 0, 0] },
    columnStyles,
    theme: "grid",
  });

  return doc;
}

export function pdfFilename(prosjekt: string, vedlegg: string): string {
  const safe = (s: string) => s.replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "_");
  return `${safe(prosjekt)}_-_${safe(vedlegg)}.pdf`;
}
