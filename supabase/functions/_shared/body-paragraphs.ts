// Crawler-HTML paragraphs for an episode description (pure; unit-tested).
// The visitor page renders the description with its line breaks (whitespace-pre-wrap),
// so the bot HTML must carry the same words: split on line breaks only, and break an
// over-long paragraph at sentence ends while MERGING short pieces (e.g. "Dr.") into the
// next one instead of dropping them. Nothing is ever filtered out.
export function bodyParagraphs(text: string, maxPara = 1200): string[] {
  const out: string[] = [];
  for (const raw of String(text || "").split(/\n+/)) {
    const para = raw.replace(/\s+/g, " ").trim();
    if (!para) continue;
    if (para.length <= maxPara) { out.push(para); continue; }
    let buf = "";
    for (const piece of para.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÖŐÚÜŰ])/)) {
      buf = buf ? `${buf} ${piece}` : piece;
      if (buf.length >= 200) { out.push(buf); buf = ""; }
    }
    if (buf) {
      if (out.length && buf.length < 200) out[out.length - 1] = `${out[out.length - 1]} ${buf}`;
      else out.push(buf);
    }
  }
  return out;
}
