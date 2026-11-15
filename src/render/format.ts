/** Pick the singular or plural word for a count. Chalk-free: terminal and markdown renderers share it. */
export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
