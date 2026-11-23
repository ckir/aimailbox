import { expect, test } from "bun:test";
import { name } from "./index.ts";

test("exports the project name", () => {
	expect(name).toBe("aimailbox");
});
