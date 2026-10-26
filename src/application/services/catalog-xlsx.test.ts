import { describe, it, expect } from "vitest";
import {
  MAX_XLSX_UNCOMPRESSED_BYTES,
  assertSafeXlsxArchive,
  looksLikeZip,
  normalizeCellValue,
  pickHeaderRow,
  rowsToCsv,
} from "./catalog-xlsx";

/** Construit un ZIP minimal (répertoire central seul) : suffit pour tester la garde, qui ne lit que lui. */
function fakeZip(entries: { name: string; uncompressed: number }[]): Uint8Array {
  const parts: number[][] = [];
  const central: number[] = [];
  for (const e of entries) {
    const name = [...new TextEncoder().encode(e.name)];
    const header = new Uint8Array(46);
    const v = new DataView(header.buffer);
    v.setUint32(0, 0x02014b50, true);
    v.setUint32(24, e.uncompressed, true);
    v.setUint16(28, name.length, true);
    central.push(...header, ...name);
  }
  const eocd = new Uint8Array(22);
  const v = new DataView(eocd.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(10, entries.length, true);
  v.setUint32(12, central.length, true);
  v.setUint32(16, 0, true); // le répertoire central commence à l'offset 0
  parts.push(central, [...eocd]);
  return new Uint8Array(parts.flat());
}

describe("assertSafeXlsxArchive", () => {
  it("accepte une archive raisonnable", () => {
    expect(() => assertSafeXlsxArchive(fakeZip([{ name: "xl/workbook.xml", uncompressed: 2_000 }, { name: "xl/worksheets/sheet1.xml", uncompressed: 3_000_000 }]))).not.toThrow();
  });

  it("refuse une taille décompressée déclarée excessive (bombe de décompression)", () => {
    const bomb = fakeZip([{ name: "xl/worksheets/sheet1.xml", uncompressed: MAX_XLSX_UNCOMPRESSED_BYTES }, { name: "b.xml", uncompressed: 10 }]);
    expect(() => assertSafeXlsxArchive(bomb)).toThrow(/volumineux/);
  });

  it("refuse trop d'entrées, du contenu non ZIP et un fichier tronqué", () => {
    expect(() => assertSafeXlsxArchive(fakeZip(Array.from({ length: 1001 }, (_, i) => ({ name: `f${i}`, uncompressed: 1 }))))).toThrow(/complexe/);
    expect(() => assertSafeXlsxArchive(new TextEncoder().encode("ceci n'est pas un zip du tout, juste du texte assez long"))).toThrow(/illisible/);
    expect(() => assertSafeXlsxArchive(new Uint8Array(10))).toThrow();
  });

  it("reconnaît la signature ZIP", () => {
    expect(looksLikeZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0]))).toBe(true);
    expect(looksLikeZip(new TextEncoder().encode("nom;prix\n"))).toBe(false);
  });
});

describe("normalizeCellValue", () => {
  it("lit nombres, texte, booléens, dates", () => {
    expect(normalizeCellValue("  Sac  ")).toBe("Sac");
    expect(normalizeCellValue(35000)).toBe("35000");
    expect(normalizeCellValue(12.5)).toBe("12.5");
    expect(normalizeCellValue(true)).toBe("true");
    expect(normalizeCellValue(new Date("2026-10-13T08:00:00Z"))).toBe("2026-10-13");
    expect(normalizeCellValue(null)).toBe("");
    expect(normalizeCellValue(Number.NaN)).toBe("");
  });

  it("formules : dernier résultat ; erreurs Excel : absent (jamais inventé)", () => {
    expect(normalizeCellValue({ formula: "A1*2", result: 600 })).toBe("600");
    expect(normalizeCellValue({ sharedFormula: "A1", result: "ok" })).toBe("ok");
    expect(normalizeCellValue({ error: "#N/A" })).toBe("");
    expect(normalizeCellValue({ formula: "1/0", result: { error: "#DIV/0!" } })).toBe("");
  });

  it("texte riche et liens : l'adresse du lien, jamais « [object Object] »", () => {
    expect(normalizeCellValue({ richText: [{ text: "Café " }, { text: "moulu" }] })).toBe("Café moulu");
    expect(normalizeCellValue({ text: "photo", hyperlink: "https://media.exemple.com/a.jpg" })).toBe("https://media.exemple.com/a.jpg");
    expect(normalizeCellValue({ n: 1 })).toBe("");
  });
});

describe("pickHeaderRow / rowsToCsv", () => {
  const rows = [
    ["Catalogue Chez Mado", "", ""],
    ["", "", ""],
    ["Désignation", "Prix de vente", "Qté"],
    ["Sac", "15000", "4"],
    ["", "", ""],
    ["Montre", "", "2"],
  ];

  it("saute titre et lignes vides au-dessus du tableau", () => {
    expect(pickHeaderRow(rows)).toBe(2);
    expect(pickHeaderRow([["a", "b"], ["1", "2"]])).toBe(0);
    expect(pickHeaderRow([["seul"]])).toBe(0);
  });

  it("produit un CSV sans lignes vides, colonnes alignées, guillemets échappés", () => {
    const { csv, skippedRowsAboveHeader, columns } = rowsToCsv(rows);
    expect(skippedRowsAboveHeader).toBe(2);
    expect(columns).toBe(3);
    expect(csv).toBe("Désignation,Prix de vente,Qté\nSac,15000,4\nMontre,,2");
    expect(rowsToCsv([["Nom", "Note"], ['Sac "XL"', "a, b"]]).csv).toBe('Nom,Note\n"Sac ""XL""","a, b"');
  });

  it("nomme les en-têtes vides et retire les colonnes vides de fin", () => {
    expect(rowsToCsv([["Nom", "", "Prix", "", ""], ["Sac", "x", "10", "", ""]]).csv).toBe("Nom,Colonne 2,Prix\nSac,x,10");
  });
});
