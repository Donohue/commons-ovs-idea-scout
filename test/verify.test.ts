import assert from "node:assert/strict";
import { test } from "node:test";
import { htmlToText } from "../src/http.js";
import { canonicalUrl, normalize, quoteFound } from "../src/verify.js";

const page = htmlToText(`<html><head><script>var x = "quote not here";</script></head><body>
<p>This results in a growing gap between the number of participants in open source projects and the number of maintainers with a sense of ownership.</p>
<p>It&#8217;s &ldquo;hard&rdquo; &mdash; really.</p></body></html>`);

test("exact quote matches across HTML, entities and whitespace", () => {
  assert.equal(quoteFound("a growing gap between the number of participants in open source projects", page), "exact");
  assert.equal(quoteFound("It's \"hard\" — really.", page), "exact");
});

test("script content is not treated as page text", () => {
  assert.equal(quoteFound("quote not here", page), null);
});

test("a paraphrase fails; a lightly altered long quote still matches fuzzily", () => {
  assert.equal(quoteFound("Open source has far fewer maintainers than contributors these days", page), null);
  assert.equal(
    quoteFound("This results in a growing gap between the number of participants in open source projects and the number of maintainers", page),
    "exact",
  );
  assert.equal(
    quoteFound("results in a growing gap between the number of participants in open-source projects and the number of maintainers with a sense of ownership", page),
    "fuzzy",
  );
});

test("normalize unifies quotes and dashes", () => {
  assert.equal(normalize("“A” – ‘b’"), '"a" - \'b\'');
});

test("canonicalUrl drops hash and trailing slash", () => {
  assert.equal(canonicalUrl("https://Example.com/a/#x"), "https://example.com/a");
});
