import { pipeline } from '@xenova/transformers';

let embedder: any;
let initPromise: Promise<void> | null = null;

async function initEmbedder() {
    if (embedder) return;

    if (!initPromise) {
        initPromise = (async () => {
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
        })();
    }

    await initPromise;
}

export async function getEmbedding(text: string): Promise<number[]> {
    await initEmbedder();

    const output = await embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
}

export async function getEmbeddings(texts: string[]): Promise<number[][]> {
    await initEmbedder();

    const embeddings: number[][] = [];
    for (const text of texts) {
        const output = await embedder(text, { pooling: 'mean', normalize: true });
        embeddings.push(Array.from(output.data));
    }
    return embeddings;
}
