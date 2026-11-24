export type Result<T, E extends string = string> =
	| { ok: true; value: T }
	| { ok: false; error: E };
export type ReadResult<T> =
	| { status: "ok"; value: T; cleaned: boolean } // cleaned: something was stripped or cut (7.1 notice)
	| { status: "unknown-format"; formatVersion: number; noteNumber?: number }
	| { status: "unparseable" };
