import { expect, test } from "bun:test";
import { ECOSYSTEMS, ordersVersions } from "./ecosystem.ts";

test("the prefix list is closed and three prefixes order versions", () => {
	expect([...ECOSYSTEMS].sort()).toEqual([
		"cargo",
		"go",
		"npm",
		"pypi",
		"tool",
	]);
	expect(ECOSYSTEMS.filter(ordersVersions).sort()).toEqual([
		"cargo",
		"go",
		"npm",
	]);
});
