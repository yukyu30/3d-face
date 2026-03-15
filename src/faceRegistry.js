"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cosineSimilarity = cosineSimilarity;
exports.findMatchingPerson = findMatchingPerson;
const DEFAULT_THRESHOLD = 0.7;
function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0)
        return 0;
    return dotProduct / denominator;
}
function findMatchingPerson(descriptor, registry, threshold = DEFAULT_THRESHOLD) {
    let bestMatch = null;
    let bestSimilarity = -Infinity;
    for (const person of registry) {
        for (const registered of person.descriptors) {
            const similarity = cosineSimilarity(descriptor.embedding, registered.embedding);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = person;
            }
        }
    }
    if (bestSimilarity >= threshold) {
        return bestMatch;
    }
    return null;
}
//# sourceMappingURL=faceRegistry.js.map