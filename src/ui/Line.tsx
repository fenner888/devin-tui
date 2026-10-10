import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import {segStyle} from '../theme.js';
import type {Seg} from './lines.js';

/** Render one pre-wrapped styled line. Never wraps (we do our own layout).
 *  `rowBg` is this row's `screenBg` — the fill wherever a seg's resolved
 *  bg is 'bg' (gradient rows, transparent background). */
export function Line({
	segs,
	rowBg,
}: {
	segs: Seg[];
	rowBg?: string;
}): React.JSX.Element {
	if (segs.length === 0) return <Text wrap="truncate"> </Text>;
	return (
		<Text wrap="truncate">
			{segs.map((s, i) => (
				<Text key={i} {...segStyle(s.k, s.bg ?? 'bg', s.hex, rowBg)}>
					{s.link ? `\x1b]8;;${s.link}\x07${s.t}\x1b]8;;\x07` : s.t}
				</Text>
			))}
		</Text>
	);
}

/** Re-render tick at `ms` interval while `active`. */
export function useTick(ms: number, active = true): number {
	const [n, setN] = useState(0);
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setN(x => x + 1), ms);
		return () => clearInterval(t);
	}, [ms, active]);
	return n;
}
