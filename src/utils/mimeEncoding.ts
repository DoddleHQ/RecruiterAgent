
export function encodeEmailSubject(subject: string): string {
    if (!subject) return "";

    const isAscii = /^[\x00-\x7F]*$/.test(subject);

    if (isAscii) {
        return subject;
    }

    const encoded = Buffer.from(subject, 'utf-8').toString('base64');
    return `=?UTF-8?B?${encoded}?=`;
}

export function encodeEmailSubjectQ(subject: string): string {
    if (!subject) return "";

    const isAscii = /^[\x00-\x7F]*$/.test(subject);

    if (isAscii) {
        return subject;
    }

    let encoded = "";
    for (let i = 0; i < subject.length; i++) {
        const charCode = subject.charCodeAt(i);
        const char = subject[i];

        if (charCode >= 33 && charCode <= 126 && char !== '=' && char !== '?') {
            encoded += char;
        } else {
            const hex = charCode.toString(16).toUpperCase().padStart(2, '0');
            encoded += `=${hex}`;
        }
    }

    return `=?UTF-8?Q?${encoded}?=`;
}

export function decodeEmailSubject(encodedSubject: string): string {
    const mimePattern = /=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g;

    return encodedSubject.replace(mimePattern, (match: string, charset: string, encoding: string, encodedText: string) => {
        try {
            if (encoding.toUpperCase() === 'B') {
                return Buffer.from(encodedText, 'base64').toString('utf-8');
            } else if (encoding.toUpperCase() === 'Q') {
                return encodedText
                    .replace(/_/g, ' ')
                    .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
                        String.fromCharCode(parseInt(hex, 16))
                    );
            }
        } catch (error) {
            console.error('Error decoding MIME subject:', error);
        }
        return match;
    });
}

export function isMimeEncoded(subject: string): boolean {
    return /=\?[^?]+\?[BQbq]\?[^?]+\?=/g.test(subject);
}
