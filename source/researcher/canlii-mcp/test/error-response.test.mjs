import { test } from "node:test";
import assert from "node:assert/strict";
import { errorResponse } from "../build/index.js";

test("an error result is flagged as an error and redacts the API key", () => {
	const result = errorResponse("Error: fetch failed for https://api.canlii.org/v1/x?api_key=secret123");
	assert.equal(result.isError, true);
	assert.match(result.content[0].text, /api_key=REDACTED/);
	assert.doesNotMatch(result.content[0].text, /secret123/);
});
