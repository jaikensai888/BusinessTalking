/** 端到端测试 /api/v1/extract：txt 与构造的最小 PDF */
const BASE = "http://localhost:3001/api/v1";

function minimalPdf(text) {
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>";
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  objs[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

async function post(file, filename) {
  const fd = new FormData();
  fd.append("file", new Blob([file], { type: "application/octet-stream" }), filename);
  const res = await fetch(`${BASE}/extract`, { method: "POST", body: fd });
  const d = await res.json();
  return { status: res.status, data: d };
}

async function main() {
  // txt
  const txt = await post(Buffer.from("商业计划书：AI 定价分析工具，订阅制，月费 49 元。"), "plan.txt");
  console.log("TXT:", txt.status === 200 && txt.data.code === 0 && txt.data.data.text.includes("49"), `text="${txt.data.data?.text?.slice(0, 40)}..."`);

  // 最小 PDF
  const pdf = await post(minimalPdf("Hello Feasibility PDF"), "doc.pdf");
  const okPdf = pdf.status === 200 && pdf.data.code === 0;
  console.log("PDF:", okPdf && pdf.data.data.text.replace(/\s+/g, " ").includes("Hello Feasibility PDF"), pdf.status === 200 ? `charCount=${pdf.data.data.charCount} text="${pdf.data.data.text.replace(/\s+/g,' ').slice(0,40)}"` : JSON.stringify(pdf.data));

  // 非法格式
  const bad = await post(Buffer.from("not a pdf"), "x.exe");
  console.log("BAD_EXT:", bad.status === 400 && bad.data.code === 40001, JSON.stringify(bad.data));
}

main().catch((e) => { console.error(e); process.exit(1); });
