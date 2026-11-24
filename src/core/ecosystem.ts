export const ECOSYSTEMS = ["npm", "cargo", "go", "pypi", "tool"] as const;
export type Ecosystem = (typeof ECOSYSTEMS)[number];

export function ordersVersions(ecosystem: Ecosystem): boolean {
	return ecosystem === "npm" || ecosystem === "cargo" || ecosystem === "go";
}
