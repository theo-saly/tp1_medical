// Convertit un PDF en JSON hiérarchique (sections > titres, paragraphes, listes)
// à partir des tailles et graisses de police.
//
// CLI :    node convert.js <fichier.pdf | dossier>... [--html] [--min]
//          --html : ajoute le HTML de chaque page   --min : JSON compact
// Module : import { pdfToJson } from './convert.js'; await pdfToJson(buffer)
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const BULLET = /^\s*[•●▪◦‣∙·\-–—*]\s+/;
const BOLD_FONT = /bold|black|heavy|semibold/i;
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const round = (n) => Math.round(n * 2) / 2;
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

// 1. Extraction : regroupe les fragments de texte en lignes (même ordonnée).
async function extractLines(page) {
  await page.getOperatorList(); // charge les polices pour connaître leur vrai nom (ex. Helvetica-Bold)
  const { items } = await page.getTextContent();

  const boldCache = new Map();
  const isBold = (id) => {
    if (!boldCache.has(id)) boldCache.set(id, page.commonObjs.has(id) && BOLD_FONT.test(page.commonObjs.get(id).name || ''));
    return boldCache.get(id);
  };

  const lines = [];
  let last = null;
  for (const it of items) {
    const str = it.str;
    if (!str.trim()) continue;
    const [a, b, c, d, x, y] = it.transform;
    const size = round(Math.hypot(c, d) || Math.hypot(a, b));
    const boldLen = isBold(it.fontName) ? str.length : 0;

    if (last && Math.abs(last.y - y) < size * 0.5) {
      if (x - last.xEnd > size * 0.15 && !last.text.endsWith(' ')) last.text += ' ';
      last.text += str;
      last.xEnd = x + it.width;
      if (size > last.size) last.size = size;
      last.boldChars += boldLen;
      last.chars += str.length;
    } else {
      last = { text: str, y, xEnd: x + it.width, size, boldChars: boldLen, chars: str.length };
      lines.push(last);
    }
  }
  return lines.map((l) => ({ text: l.text.trim(), y: l.y, size: l.size, bold: l.boldChars / l.chars > 0.6 }));
}

// 2. Classification : taille du corps de texte = taille la plus utilisée (pondérée par nb de caractères).
function buildClassifier(allLines) {
  const weight = new Map();
  for (const l of allLines) weight.set(l.size, (weight.get(l.size) || 0) + l.text.length);
  let body = 10, max = -1;
  for (const [size, w] of weight) if (w > max) [body, max] = [size, w];

  const isHeading = (l) =>
    (l.size > body + 0.5 && (l.bold || l.size >= body * 1.4)) ||
    (l.bold && l.size >= body && l.text.length < 90 && !/[.:;,]$/.test(l.text));

  // Un "style" de titre = taille + gras. Les plus gros donnent h1, puis h2...
  const styles = [];
  for (const l of allLines) {
    if (isHeading(l) && !styles.some((s) => s.size === l.size && s.bold === l.bold)) styles.push({ size: l.size, bold: l.bold });
  }
  styles.sort((a, b) => b.size - a.size || b.bold - a.bold);
  const levelOf = (l) => Math.min(styles.findIndex((s) => s.size === l.size && s.bold === l.bold) + 1, 6);

  return (l) => {
    if (isHeading(l)) return { level: levelOf(l) };
    if (BULLET.test(l.text)) return { tag: 'li' };
    if (l.size > body + 0.5) return { tag: 'p', style: 'lead' };
    if (l.size < body - 0.5) return { tag: 'p', style: 'small' };
    return { tag: 'p' };
  };
}

// 3. Blocs : regroupe les <li> consécutifs en liste, fusionne les lignes d'un même paragraphe.
function toBlocks(lines, classify, page) {
  const blocks = [];
  for (const l of lines) {
    const { level, tag, style } = classify(l);
    const prev = blocks.at(-1);

    if (level) {
      blocks.push({ type: 'heading', level, text: l.text, page });
    } else if (tag === 'li') {
      const item = l.text.replace(BULLET, '');
      if (prev?.type === 'list') prev.items.push(item);
      else blocks.push({ type: 'list', items: [item] });
    } else if (prev?.type === 'paragraph' && prev.style === style && prev.y - l.y < l.size * 1.6) {
      prev.text += ' ' + l.text; // ligne suivante du même paragraphe
      prev.y = l.y;
    } else {
      blocks.push({ type: 'paragraph', style, text: l.text, y: l.y });
    }
  }
  return blocks;
}

const blockToHtml = (b) => {
  if (b.type === 'heading') return `<h${b.level}>${escapeHtml(b.text)}</h${b.level}>`;
  if (b.type === 'list') return `<ul>${b.items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
  return `<p${b.style ? ` class="${b.style}"` : ''}>${escapeHtml(b.text)}</p>`;
};

const blockToJson = (b) =>
  b.type === 'list' ? { type: 'list', items: b.items } : { type: 'paragraph', ...(b.style && { style: b.style }), text: b.text };

// 4. Arbre : chaque titre devient une section qui contient son texte et ses sous-sections.
function buildTree(blocks) {
  const root = { level: 0, content: [], sections: [] };
  const stack = [root];

  for (const b of blocks) {
    if (b.type === 'heading') {
      while (stack.at(-1).level >= b.level) stack.pop();
      const section = { level: b.level, title: b.text, page: b.page, content: [], sections: [] };
      stack.at(-1).sections.push(section);
      stack.push(section);
    } else {
      stack.at(-1).content.push(blockToJson(b));
    }
  }
  return root;
}

export async function pdfToJson(data, { html = false } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(data), verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise;
  try {
    const pagesLines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      pagesLines.push(await extractLines(page));
      page.cleanup();
    }

    // Classification calculée sur tout le document pour garder des niveaux cohérents entre pages.
    const classify = buildClassifier(pagesLines.flat());
    const pageBlocks = pagesLines.map((lines, i) => toBlocks(lines, classify, i + 1));
    const tree = buildTree(pageBlocks.flat());

    return {
      pageCount: pdf.numPages,
      content: tree.content, // texte éventuel avant le premier titre
      sections: tree.sections,
      ...(html && { pages: pageBlocks.map((blocks, i) => ({ page: i + 1, html: blocks.map(blockToHtml).join('\n') })) }),
    };
  } finally {
    await pdf.destroy(); // libère la mémoire : indispensable en traitement par lot ou dans un serveur
  }
}

async function collectPdfs(paths) {
  const files = [];
  for (const p of paths) {
    if ((await stat(p)).isDirectory()) {
      for (const f of await readdir(p)) if (/\.pdf$/i.test(f)) files.push(join(p, f));
    } else {
      files.push(p);
    }
  }
  return files;
}

async function cli(args) {
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const files = await collectPdfs(args.filter((a) => !a.startsWith('--')));
  if (!files.length) {
    console.error('Usage : node convert.js <fichier.pdf | dossier>... [--html] [--min]');
    process.exit(1);
  }

  let failed = 0;
  for (const file of files) {
    const out = file.replace(/\.pdf$/i, '') + '.json';
    try {
      const result = { source: basename(file), ...(await pdfToJson(await readFile(file), { html: flags.has('--html') })) };
      await writeFile(out, JSON.stringify(result, null, flags.has('--min') ? 0 : 2), 'utf8');
      console.log(`OK   ${basename(file)} (${result.pageCount} p.)`);
    } catch (err) {
      failed++;
      console.error(`ERR  ${basename(file)} : ${err.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) cli(process.argv.slice(2));
