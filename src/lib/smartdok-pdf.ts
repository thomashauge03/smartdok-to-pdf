import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Parsed } from "./smartdok-parser";
import { fmtSumNum } from "./smartdok-parser";
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

export async function generatePdf(parsed: Parsed, prosjekt: string, vedlegg: string): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Header text
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`Prosjekt : ${prosjekt}`, 14, 14);
  doc.text(`Vedlegg : ${vedlegg}`, 14, 20);

  // Logo top-right
  try {
    const logo = await loadLogo();
    const pageW = doc.internal.pageSize.getWidth();
    const w = 40;
    const h = 26;
    doc.addImage(logo, "PNG", pageW - w - 14, 6, w, h);
  } catch {
    // ignore
  }

  const body = parsed.rows.map((r) => [
    r.tid, r.navn, r.kommentar, r.dato, r.timer, r.aerTimer, r.maskin, r.maskinTimer,
  ]);

  body.push([
    "", "", "",
    { content: "Sum", styles: { fontStyle: "bold" } } as any,
    { content: fmtSumNum(parsed.sumTimer), styles: { fontStyle: "bold" } } as any,
    "", "",
    { content: fmtSumNum(parsed.sumMaskinTimer), styles: { fontStyle: "bold" } } as any,
  ]);

  autoTable(doc, {
    startY: 36,
    head: [["Tid", "Navn", "Kommentar", "Dato", "Timer", "AER timer", "Maskinnavn1", "Timer"]],
    body,
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      lineWidth: 0.1,
      lineColor: [0, 0, 0],
    },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 32 },
      2: { cellWidth: 82 },
      3: { cellWidth: 22 },
      4: { cellWidth: 14, halign: "right" },
      5: { cellWidth: 24 },
      6: { cellWidth: 40 },
      7: { cellWidth: 14, halign: "right" },
    },
    theme: "grid",
  });

  return doc;
}

export function pdfFilename(prosjekt: string, vedlegg: string): string {
  const safe = (s: string) => s.replace(/[^\w\s.-]/g, "").trim().replace(/\s+/g, "_");
  return `${safe(prosjekt)}_-_${safe(vedlegg)}.pdf`;
}
