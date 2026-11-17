export function terminalText(text: string): string {
	return text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

export function terminalLink(url: string): string | undefined {
	return /^https?:\/\/[^\s<>"'`]+$/i.test(url) &&
		!/[\x00-\x1f\x7f-\x9f]/.test(url) ? url : undefined;
}
