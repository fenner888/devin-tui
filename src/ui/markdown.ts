import {seg, strWidth, type Seg} from './lines.js';

/**
 * Minimal markdown renderer → styled segments.
 * Supports: `code`, **bold**, # headings, ``` fences (flagged via `code`),
 * bullet lists (`- `, `* `, `+ `, `1. `) with hanging continuation indent.
 */
export interface MdLine {
	segs: Seg[];
	code?: boolean; // inside a fenced block
	indent?: number; // hanging indent for wrapped continuations (bullets)
}

export function renderMarkdown(text: string): MdLine[] {
	const src = text.split('\n');
	const out: MdLine[] = [];
	let fence = false;
	for (const line of src) {
		if (/^\s*```/.test(line)) {
			fence = !fence;
			continue;
		}
		if (fence) {
			out.push({segs: [seg(line, 'text')], code: true});
			continue;
		}
		const hm = /^(#{1,6})\s+(.*)$/.exec(line);
		if (hm) {
			out.push({segs: [seg(hm[2], 'title')]});
			continue;
		}
		// bullet / numbered list: `  • text` / `  1. text`, +2 per nesting level
		const bm = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
		if (bm && bm[3].length > 0) {
			const nest = Math.min(3, Math.floor(bm[1].length / 2));
			const marker = /^\d/.test(bm[2]) ? `${bm[2]} ` : '• ';
			const pad = '  ' + '  '.repeat(nest);
			out.push({
				segs: [seg(pad), seg(marker, 'muted'), ...inlineSegs(bm[3])],
				indent: strWidth(pad) + strWidth(marker),
			});
			continue;
		}
		out.push({segs: inlineSegs(line)});
	}
	return out;
}

/** Parse inline `code` and **bold** spans into segments. */
export function inlineSegs(text: string): Seg[] {
	const segs: Seg[] = [];
	const re = /(`[^`\n]*`|\*\*[^*\n]+\*\*)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	while ((m = re.exec(text))) {
		if (m.index > last) segs.push(seg(text.slice(last, m.index), 'text'));
		const tok = m[0];
		if (tok.startsWith('`')) segs.push(seg(tok.slice(1, -1), 'code'));
		else segs.push(seg(tok.slice(2, -2), 'strong'));
		last = m.index + tok.length;
	}
	if (last < text.length) segs.push(seg(text.slice(last), 'text'));
	return segs;
}
